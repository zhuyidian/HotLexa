import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../config.js";
import { pathExists } from "../utils.js";

export async function renderWechatHtml({ markdownPath, config, dryRun = false }) {
  if (!config.wechatRenderer?.enabled) {
    return { ok: true, skipped: true, reason: "wechatRenderer disabled" };
  }

  const skillPath = path.resolve(projectRoot, config.wechatRenderer?.skillPath || ".agents/skills/baoyu-markdown-to-html");
  const scriptPath = path.join(skillPath, "scripts", "main.ts");
  if (!(await pathExists(scriptPath))) {
    return {
      ok: false,
      provider: "baoyu-markdown-to-html",
      error: `Missing markdown-to-html skill script: ${scriptPath}`
    };
  }

  const command = resolveBunCommand();
  const args = [
    ...command.args,
    scriptPath,
    markdownPath,
    "--theme",
    config.wechatRenderer?.theme || "default"
  ];
  if (config.wechatRenderer?.color) args.push("--color", config.wechatRenderer.color);
  if (config.wechatRenderer?.cite) args.push("--cite");

  if (dryRun) {
    return {
      ok: true,
      provider: "baoyu-markdown-to-html",
      dryRun: true,
      command: [command.bin, ...args].join(" ")
    };
  }

  const result = spawnSync(command.bin, args, {
    cwd: projectRoot,
    env: { ...process.env },
    encoding: "utf8"
  });

  return {
    ok: result.status === 0,
    provider: "baoyu-markdown-to-html",
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    htmlPath: inferHtmlPath(markdownPath)
  };
}

function inferHtmlPath(markdownPath) {
  return markdownPath.replace(/\.md$/i, ".html");
}

function resolveBunCommand() {
  return {
    bin: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "bun"]
  };
}
