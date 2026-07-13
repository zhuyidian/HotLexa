import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../config.js";
import { compactText, ensureDir, pathExists, readJson, slugify, writeJson, writeText } from "../utils.js";
import { refreshEvidenceSummary } from "./evidence.js";

export async function collectXWithBrowserFallback({ evidencePath, config, dryRun = false, limit = Infinity, force = false } = {}) {
  const absoluteEvidencePath = path.resolve(projectRoot, evidencePath);
  const evidence = await readJson(absoluteEvidencePath);
  if (!evidence) throw new Error(`Evidence file not found: ${absoluteEvidencePath}`);

  const runDir = path.dirname(absoluteEvidencePath);
  const outputRoot = path.join(runDir, config.xBrowserFallback?.outputDir || "x-browser");
  await ensureDir(outputRoot);

  const tasks = (evidence.plannedItems || [])
    .filter((item) => item.platform === "x" && item.searchUrl)
    .filter((item) => force || !hasBrowserFallbackItem(evidence, item.searchUrl))
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  const planPath = path.join(runDir, "x-browser-fallback-plan.json");
  await writeJson(planPath, {
    evidencePath: absoluteEvidencePath,
    outputRoot,
    dryRun,
    count: tasks.length,
    tasks: tasks.map((task) => ({
      query: task.query,
      searchUrl: task.searchUrl,
      reason: task.reason
    }))
  });

  if (dryRun) {
    return { ok: true, dryRun: true, planPath, plannedCount: tasks.length };
  }

  const results = [];
  for (const task of tasks) {
    const result = await runXSearchCapture({ task, outputRoot, config });
    const item = buildEvidenceItemFromFallback({ task, result, evidence });
    evidence.items = evidence.items || [];
    evidence.items.push(item);
    task.status = result.status === "ok" ? "browser-fallback-collected" : "browser-fallback-needs-review";
    task.browserFallbackItemId = item.id;
    results.push({ itemId: item.id, ...result });
  }

  refreshEvidenceSummary(evidence, config);
  await writeJson(absoluteEvidencePath, evidence);
  const resultsPath = path.join(runDir, "x-browser-fallback-results.json");
  await writeJson(resultsPath, { evidencePath: absoluteEvidencePath, results });

  return {
    ok: results.every((result) => ["ok", "needs_interaction", "failed"].includes(result.status)),
    dryRun: false,
    createdCount: results.length,
    resultsPath,
    evidencePath: absoluteEvidencePath
  };
}

function hasBrowserFallbackItem(evidence, searchUrl) {
  return (evidence.items || []).some((item) => item.collector === "x-browser-fallback" && item.url === searchUrl);
}

async function runXSearchCapture({ task, outputRoot, config }) {
  const skillPath = path.resolve(projectRoot, config.xBrowserFallback?.skillPath || ".agents/skills/baoyu-url-to-markdown");
  const cliPath = path.join(skillPath, "scripts", "vendor", "baoyu-fetch", "src", "cli.ts");
  if (!(await pathExists(cliPath))) {
    return {
      status: "failed",
      provider: "baoyu-url-to-markdown",
      error: `baoyu-url-to-markdown CLI not found: ${cliPath}`
    };
  }

  const taskDir = path.join(outputRoot, slugify(task.query || "x-search", "x-search"));
  await ensureDir(taskDir);
  const outputPath = path.join(taskDir, "document.json");
  const debugDir = path.join(taskDir, "debug");
  const command = resolveBunCommand();
  const args = [
    ...command.args,
    cliPath,
    task.searchUrl,
    "--format",
    "json",
    "--output",
    outputPath,
    "--adapter",
    "x",
    "--debug-dir",
    debugDir,
    "--timeout",
    String(config.xBrowserFallback?.timeoutMs || 60000)
  ];

  if (config.xBrowserFallback?.downloadMedia) args.push("--download-media");
  if (config.xBrowserFallback?.waitForInteraction !== false) args.push("--wait-for", "interaction");

  const env = { ...process.env };
  if (config.xBrowserFallback?.chromeProfileDir) {
    env.BAOYU_CHROME_PROFILE_DIR = path.resolve(projectRoot, config.xBrowserFallback.chromeProfileDir);
  }

  const startedAt = new Date().toISOString();
  const run = spawnSync(command.bin, args, {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    timeout: (config.xBrowserFallback?.timeoutMs || 60000) + 30000
  });

  if (run.status !== 0) {
    return {
      status: "failed",
      provider: "baoyu-url-to-markdown",
      outputPath,
      debugDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: compactText(run.stderr || run.stdout || `exit ${run.status}`, 1000)
    };
  }

  const parsed = await readJson(outputPath, null);
  const markdown = parsed?.markdown || "";
  const markdownPath = markdown ? path.join(taskDir, "document.md") : "";
  if (markdown) await writeText(markdownPath, markdown);

  return {
    status: parsed?.status || "ok",
    provider: "baoyu-url-to-markdown",
    outputPath,
    markdownPath,
    debugDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    adapter: parsed?.adapter || "x",
    title: parsed?.document?.title || `X search: ${task.query}`,
    author: parsed?.document?.author || "",
    summary: compactText(parsed?.document?.description || markdown || task.reason, 700),
    rawText: compactText(markdown, 5000),
    mediaCount: Array.isArray(parsed?.media) ? parsed.media.length : 0
  };
}

function buildEvidenceItemFromFallback({ task, result, evidence }) {
  const nextIndex = (evidence.items || []).length + 1;
  const id = `x-browser-${String(nextIndex).padStart(3, "0")}`;
  const authority = authorityForTaskTier(task);
  return {
    id,
    status: result.status === "ok" ? "collected" : "needs-review",
    platform: "x",
    sourceName: "X search",
    author: result.author || "",
    handle: "",
    channelId: "",
    url: task.searchUrl,
    title: result.title || `X search: ${task.query}`,
    publishedAt: "",
    summary: result.summary || task.reason || "",
    rawText: result.rawText || "",
    evidenceType: task.tier === "high-signal" ? "social-signal" : "browser-search",
    collector: "x-browser-fallback",
    metrics: {
      query: task.query,
      tier: task.tier || "general",
      label: task.label || "",
      accounts: task.accounts || [],
      extractionStatus: result.status,
      mediaCount: result.mediaCount || 0
    },
    authority,
    enrichment: {
      status: result.status,
      provider: result.provider,
      outputPath: result.outputPath || "",
      markdownPath: result.markdownPath || "",
      debugDir: result.debugDir || ""
    },
    assets: [
      {
        type: "screenshot",
        status: "planned",
        purpose: "capture X search results with logged-in Chrome context",
        targetUrl: task.searchUrl
      }
    ]
  };
}

function authorityForTaskTier(task) {
  if (task.tier === "official") {
    return {
      level: "official",
      score: 70,
      matchedBy: "planned-official-x-search",
      requiresReview: true
    };
  }
  if (task.tier === "authoritative") {
    return {
      level: "authoritative",
      score: 60,
      matchedBy: "planned-authoritative-x-search",
      requiresReview: true
    };
  }
  return {
    level: "unverified",
    score: 25,
    matchedBy: "x-browser-search-fallback",
    requiresReview: true
  };
}

function resolveBunCommand() {
  return {
    bin: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "bun"]
  };
}
