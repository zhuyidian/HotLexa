#!/usr/bin/env node
import { runPipeline } from "./pipeline.js";
import { loadConfig } from "./config.js";
import { publishArticle } from "./wechat/publisher.js";
import { enrichEvidenceFile } from "./research/enricher.js";
import { captureEvidenceScreenshots } from "./capture/screenshotCapture.js";
import { collectXWithBrowserFallback } from "./research/xBrowserFallback.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "run";
  const options = parseOptions(args);

  if (command === "help" || options.help) {
    printHelp();
    return;
  }

  if (command === "publish") {
    const articlePath = options._[0];
    if (!articlePath) throw new Error("Missing article path. Example: node ./src/cli.js publish .runs/.../article.draft.md --dry-run");
    const config = await loadConfig();
    const result = await publishArticle({ articlePath, config, dryRun: options.dryRun !== false });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "enrich") {
    const evidencePath = options._[0];
    if (!evidencePath) throw new Error("Missing evidence path. Example: node ./src/cli.js enrich .runs/.../evidence.json");
    const config = await loadConfig();
    const result = await enrichEvidenceFile({
      evidencePath,
      config,
      dryRun: options.dryRun === true,
      limit: options.limit ?? Infinity,
      force: Boolean(options.force)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "capture") {
    const evidencePath = options._[0];
    if (!evidencePath) throw new Error("Missing evidence path. Example: node ./src/cli.js capture .runs/.../evidence.json --dry-run");
    const config = await loadConfig();
    const result = await captureEvidenceScreenshots({
      evidencePath,
      config,
      dryRun: options.dryRun === true,
      limit: options.limit ?? Infinity,
      force: Boolean(options.force)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "x-fallback") {
    const evidencePath = options._[0];
    if (!evidencePath) throw new Error("Missing evidence path. Example: node ./src/cli.js x-fallback .runs/.../evidence.json --dry-run");
    const config = await loadConfig();
    const result = await collectXWithBrowserFallback({
      evidencePath,
      config,
      dryRun: options.dryRun === true,
      limit: options.limit ?? Infinity,
      force: Boolean(options.force)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command !== "run" && command !== "collect") {
    throw new Error(`Unknown command: ${command}`);
  }

  const query = options._.join(" ").trim();
  if (!query) throw new Error("Missing query. Example: node ./src/cli.js run \"AI phone\"");
  const summary = await runPipeline({
    query,
    publish: Boolean(options.publish),
    dryRun: options.dryRun !== false
  });
  console.log(JSON.stringify(summary, null, 2));
}

function parseOptions(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--live") options.dryRun = false;
    else if (arg === "--force") options.force = true;
    else if (arg === "--limit" && args[index + 1]) options.limit = Number(args[++index]);
    else options._.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`HotLexa

Usage:
  node ./src/cli.js run "AI phone"
  node ./src/cli.js run "AI phone" --publish --dry-run
  node ./src/cli.js enrich .runs/<run>/evidence.json
  node ./src/cli.js enrich .runs/<run>/evidence.json --dry-run
  node ./src/cli.js x-fallback .runs/<run>/evidence.json --dry-run
  node ./src/cli.js capture .runs/<run>/evidence.json --dry-run
  node ./src/cli.js capture .runs/<run>/evidence.json
  node ./src/cli.js publish .runs/<run>/article.draft.md --dry-run

Flow:
  run      Collect evidence, write article.draft.md, and create a Codex polish request.
  enrich   Fetch full markdown/json for collected evidence URLs through baoyu-url-to-markdown.
  x-fallback
           Try X search capture through baoyu-url-to-markdown with Chrome login context.
  capture  Capture planned YouTube/X screenshot assets with local Chrome.
  publish  Prepare or execute WeChat draft publishing through baoyu-post-to-wechat.

Options:
  --dry-run       Write a plan without running enrich/capture, or avoid real WeChat publish.
  --force         Re-run enrich/capture for items already completed.
  --limit <n>     Process only the first n candidates.
  --live          For publish only: execute the WeChat publishing command.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
