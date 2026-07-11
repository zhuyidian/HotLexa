#!/usr/bin/env node
import { runPipeline } from "./pipeline.js";

function parseArgs(argv) {
  const [command = "dryrun", ...rest] = argv;
  const flags = new Set(rest.filter((item) => item.startsWith("--")));
  const query = rest.filter((item) => !item.startsWith("--")).join(" ").trim();

  return {
    command,
    query,
    dryRun: command === "dryrun" || flags.has("--dry-run")
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!["generate", "dryrun", "publish"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}`);
  }

  if (!args.query) {
    throw new Error('Please provide a topic, for example: node ./src/cli.js dryrun "AI 手机"');
  }

  const result = await runPipeline({
    query: args.query || "Untitled topic",
    publish: args.command === "publish",
    dryRun: args.dryRun
  });

  console.log(`HotLexa ${args.command} complete`);
  console.log(`Run directory: ${result.runDir}`);
  console.log(`Article: ${result.articlePath}`);
  console.log(`WeChat HTML: ${result.htmlPath}`);
  console.log(`Draft payload: ${result.payloadPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
