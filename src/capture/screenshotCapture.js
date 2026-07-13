import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../config.js";
import { ensureDir, pathExists, readJson, slugify, writeJson } from "../utils.js";
import { refreshEvidenceSummary } from "../research/evidence.js";

export async function captureEvidenceScreenshots({ evidencePath, config, dryRun = false, limit = Infinity, force = false } = {}) {
  const absoluteEvidencePath = path.resolve(projectRoot, evidencePath);
  const evidence = await readJson(absoluteEvidencePath);
  if (!evidence) throw new Error(`Evidence file not found: ${absoluteEvidencePath}`);

  const runDir = path.dirname(absoluteEvidencePath);
  const outputRoot = path.join(runDir, config.capture?.outputDir || "assets/screenshots");
  await ensureDir(outputRoot);
  ensureScreenshotAssets(evidence);

  const tasks = buildCaptureTasks(evidence, outputRoot, force).slice(0, Number.isFinite(limit) ? limit : undefined);
  const planPath = path.join(runDir, "capture-plan.json");
  await writeJson(planPath, {
    evidencePath: absoluteEvidencePath,
    outputRoot,
    dryRun,
    count: tasks.length,
    tasks: tasks.map((task) => ({
      itemId: task.item.id,
      platform: task.item.platform,
      url: task.asset.targetUrl || task.item.url,
      outputPath: task.outputPath
    }))
  });

  if (dryRun) {
    return { ok: true, dryRun: true, planPath, plannedCount: tasks.length };
  }

  const chromePath = await resolveChromePath(config);
  if (!chromePath) {
    return {
      ok: false,
      dryRun: false,
      planPath,
      error: "Chrome executable not found. Set capture.chromePath in config/local.secrets.json or config/defaults.json."
    };
  }

  const results = [];
  for (const task of tasks) {
    const result = await captureOne({ task, chromePath, config });
    Object.assign(task.asset, result.assetPatch);
    results.push({ itemId: task.item.id, ...result.assetPatch });
  }

  refreshEvidenceSummary(evidence, config);
  await writeJson(absoluteEvidencePath, evidence);
  const resultsPath = path.join(runDir, "capture-results.json");
  await writeJson(resultsPath, { evidencePath: absoluteEvidencePath, results });

  return {
    ok: results.every((result) => result.status === "captured"),
    dryRun: false,
    capturedCount: results.filter((result) => result.status === "captured").length,
    resultsPath,
    evidencePath: absoluteEvidencePath
  };
}

function ensureScreenshotAssets(evidence) {
  for (const item of evidence.items || []) {
    if (!["youtube", "x"].includes(item.platform) || !item.url) continue;
    const hasScreenshot = (item.assets || []).some((asset) => asset.type === "screenshot");
    if (!hasScreenshot && ["official", "authoritative"].includes(item.authority?.level)) {
      item.assets = item.assets || [];
      item.assets.push({
        type: "screenshot",
        status: "planned",
        purpose: "capture official or authoritative account context",
        targetUrl: item.url
      });
    }
  }
}

function buildCaptureTasks(evidence, outputRoot, force) {
  const tasks = [];
  for (const item of evidence.items || []) {
    for (const [index, asset] of (item.assets || []).entries()) {
      if (asset.type !== "screenshot") continue;
      if (!force && asset.status === "captured") continue;
      const url = asset.targetUrl || item.url;
      if (!url) continue;
      const fileName = `${item.id}-${index + 1}-${slugify(item.sourceName || item.title || item.platform, "screenshot")}.png`;
      tasks.push({ item, asset, outputPath: path.join(outputRoot, fileName) });
    }
  }
  return tasks;
}

async function captureOne({ task, chromePath, config }) {
  await ensureDir(path.dirname(task.outputPath));
  const url = task.asset.targetUrl || task.item.url;
  const args = [
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${config.capture?.windowWidth || 1365},${config.capture?.windowHeight || 1600}`,
    `--screenshot=${task.outputPath}`
  ];

  if (config.capture?.headless !== false) args.unshift("--headless=new");
  if (config.capture?.chromeProfileDir) {
    args.push(`--user-data-dir=${path.resolve(projectRoot, config.capture.chromeProfileDir)}`);
  }
  args.push(url);

  const result = spawnSync(chromePath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: config.capture?.timeoutMs || 45000
  });

  if (result.status === 0 && (await pathExists(task.outputPath))) {
    return {
      assetPatch: {
        status: "captured",
        localPath: task.outputPath,
        capturedAt: new Date().toISOString(),
        tool: "chrome-cli",
        width: config.capture?.windowWidth || 1365,
        height: config.capture?.windowHeight || 1600
      }
    };
  }

  return {
    assetPatch: {
      status: "failed",
      attemptedAt: new Date().toISOString(),
      tool: "chrome-cli",
      error: result.stderr || result.stdout || `Chrome exited with ${result.status}`
    }
  };
}

async function resolveChromePath(config) {
  const configured = config.capture?.chromePath || process.env.CHROME_PATH || process.env.WECHAT_BROWSER_CHROME_PATH;
  const candidates = [
    configured,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "",
    process.platform !== "win32" ? "/usr/bin/google-chrome" : "",
    process.platform !== "win32" ? "/usr/bin/chromium-browser" : "",
    process.platform !== "win32" ? "/usr/bin/chromium" : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return "";
}
