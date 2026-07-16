import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildBunCommand, formatSpawnError } from "../bunRunner.js";
import { projectRoot } from "../config.js";
import { compactText, ensureDir, pathExists, readJson, slugify, writeJson, writeText } from "../utils.js";
import { refreshEvidenceSummary } from "./evidence.js";

export async function enrichEvidenceFile({ evidencePath, config, dryRun = false, limit = Infinity, force = false } = {}) {
  const absoluteEvidencePath = path.resolve(projectRoot, evidencePath);
  const evidence = await readJson(absoluteEvidencePath);
  if (!evidence) throw new Error(`Evidence file not found: ${absoluteEvidencePath}`);

  const runDir = path.dirname(absoluteEvidencePath);
  const skillPath = path.resolve(projectRoot, config.enrich?.skillPath || ".agents/skills/baoyu-url-to-markdown");
  const cliPath = path.join(skillPath, "scripts", "vendor", "baoyu-fetch", "src", "cli.ts");
  const outputRoot = path.join(runDir, config.enrich?.outputDir || "enriched");
  await ensureDir(outputRoot);

  if (!(await pathExists(cliPath))) {
    throw new Error(`baoyu-url-to-markdown CLI not found: ${cliPath}`);
  }

  const itemsWithUrls = (evidence.items || []).filter((item) => item.url);
  const selectionEnabled = config.enrich?.selectedOnly !== false && itemsWithUrls.some((item) => item.selected);
  const enrichScope = selectionEnabled ? itemsWithUrls.filter((item) => item.selected) : itemsWithUrls;
  const candidates = enrichScope
    .filter((item) => force || item.enrichment?.status !== "ok")
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  const planPath = path.join(runDir, "enrich-plan.json");
  await writeJson(planPath, {
    evidencePath: absoluteEvidencePath,
    outputRoot,
    dryRun,
    count: candidates.length,
    selectedOnly: selectionEnabled,
    items: candidates.map((item) => ({ id: item.id, platform: item.platform, url: item.url }))
  });

  if (dryRun) {
    return { ok: true, dryRun: true, planPath, plannedCount: candidates.length };
  }

  const results = [];
  for (const item of candidates) {
    const result = await enrichItem({ item, cliPath, outputRoot, config });
    item.enrichment = result.enrichment;
    if (result.patch) Object.assign(item, result.patch);
    results.push({ id: item.id, ...result.enrichment });
  }

  refreshEvidenceSummary(evidence, config);
  await writeJson(absoluteEvidencePath, evidence);
  const resultsPath = path.join(runDir, "enrich-results.json");
  await writeJson(resultsPath, { evidencePath: absoluteEvidencePath, results });

  return {
    ok: results.every((result) => ["ok", "needs_interaction"].includes(result.status)),
    dryRun: false,
    enrichedCount: results.filter((result) => result.status === "ok").length,
    resultsPath,
    evidencePath: absoluteEvidencePath
  };
}

async function enrichItem({ item, cliPath, outputRoot, config }) {
  const itemDir = path.join(outputRoot, `${item.id}-${slugify(item.title || item.platform, "item")}`);
  await ensureDir(itemDir);
  if (item.platform === "youtube") {
    const transcriptResult = await enrichYoutubeTranscript({ item, itemDir, config });
    if (transcriptResult) return transcriptResult;
  }

  const outputPath = path.join(itemDir, "document.json");
  const runtimeArgs = [
    cliPath,
    item.url,
    "--format",
    "json",
    "--output",
    outputPath,
    "--timeout",
    String(config.enrich?.timeoutMs || 45000)
  ];

  const adapter = adapterForPlatform(item.platform);
  if (adapter) runtimeArgs.push("--adapter", adapter);
  runtimeArgs.push("--chrome-profile-dir", resolveEnrichChromeProfileDir({ item, config }));
  if (config.enrich?.downloadMedia) runtimeArgs.push("--download-media");
  if (config.enrich?.waitForInteraction) runtimeArgs.push("--wait-for", "interaction");
  const command = buildBunCommand(runtimeArgs);

  const env = { ...process.env };
  if (config.enrich?.chromeProfileDir) {
    env.BAOYU_CHROME_PROFILE_DIR = path.resolve(projectRoot, config.enrich.chromeProfileDir);
  }

  const startedAt = new Date().toISOString();
  const result = spawnSync(command.bin, command.args, {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    timeout: (config.enrich?.timeoutMs || 45000) + 15000
  });

  if (result.status !== 0) {
    return {
      enrichment: {
        status: "failed",
        provider: "baoyu-url-to-markdown",
        outputPath,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: compactText(formatSpawnError(result), 1000)
      }
    };
  }

  const parsed = await readJson(outputPath, null);
  if (!parsed) {
    return {
      enrichment: {
        status: "failed",
        provider: "baoyu-url-to-markdown",
        outputPath,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: compactText(`No JSON output was written. ${formatSpawnError(result)}`, 1000)
      }
    };
  }

  const status = parsed?.status || "ok";
  const markdown = parsed?.markdown || "";
  const document = parsed?.document || {};
  const markdownPath = markdown ? path.join(itemDir, "document.md") : "";
  if (markdown) await writeText(markdownPath, markdown);

  return {
    enrichment: {
      status,
      provider: "baoyu-url-to-markdown",
      outputPath,
      markdownPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      adapter: parsed?.adapter || adapter || "",
      mediaCount: Array.isArray(parsed?.media) ? parsed.media.length : 0
    },
    patch: {
      title: document.title || item.title,
      author: document.author || item.author,
      publishedAt: document.publishedAt || item.publishedAt,
      summary: compactText(document.description || item.summary || markdown, 700),
      rawText: compactText(markdown || item.rawText || "", 5000)
    }
  };
}

async function enrichYoutubeTranscript({ item, itemDir, config }) {
  const skillPath = path.resolve(projectRoot, config.enrich?.youtubeTranscriptSkillPath || ".agents/skills/baoyu-youtube-transcript");
  const scriptPath = path.join(skillPath, "scripts", "main.ts");
  if (!(await pathExists(scriptPath))) return null;

  const outputPath = path.join(itemDir, "youtube-transcript.md");
  const cacheDir = path.join(itemDir, "youtube-transcript-cache");
  const command = buildBunCommand([
    scriptPath,
    item.url,
    "--languages",
    config.enrich?.youtubeTranscriptLanguages || "zh,en",
    "--chapters",
    "--output",
    outputPath,
    "--output-dir",
    cacheDir
  ]);

  const startedAt = new Date().toISOString();
  const result = spawnSync(command.bin, command.args, {
    cwd: projectRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: (config.enrich?.timeoutMs || 45000) + 15000
  });

  if (result.status !== 0 || !(await pathExists(outputPath))) {
    return null;
  }

  const markdown = await readTextFile(outputPath);
  return {
    enrichment: {
      status: "ok",
      provider: "baoyu-youtube-transcript",
      outputPath,
      markdownPath: outputPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      adapter: "youtube",
      mediaCount: 0,
      note: compactText(result.stdout || "", 500)
    },
    patch: {
      summary: compactText(markdown, 700),
      rawText: compactText(markdown, 5000)
    }
  };
}

async function readTextFile(filePath) {
  const fs = await import("node:fs/promises");
  return fs.readFile(filePath, "utf8");
}

function adapterForPlatform(platform) {
  if (platform === "x") return "x";
  if (platform === "youtube") return "youtube";
  return "generic";
}

function resolveEnrichChromeProfileDir({ item, config }) {
  if (config.enrich?.chromeProfileDir) {
    return path.resolve(projectRoot, config.enrich.chromeProfileDir);
  }
  return path.join(projectRoot, ".cache", "chrome", "enrich", `${item.id}-${process.pid}-${Date.now()}`);
}
