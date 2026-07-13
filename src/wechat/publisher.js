import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../config.js";
import { pathExists } from "../utils.js";

export async function publishArticle({ articlePath, config, dryRun = true }) {
  const skillPath = path.resolve(projectRoot, config.wechat?.skillPath || ".agents/skills/baoyu-post-to-wechat");
  const scriptPath = path.join(skillPath, "scripts", "wechat-api.ts");
  if (!(await pathExists(scriptPath))) {
    return {
      ok: false,
      provider: "baoyu-post-to-wechat",
      dryRun,
      error: `Missing WeChat skill script: ${scriptPath}`
    };
  }

  const command = resolveBunCommand();
  const args = [
    ...command.args,
    scriptPath,
    articlePath,
    "--theme",
    config.wechat?.theme || "default"
  ];
  if (config.wechat?.color) args.push("--color", config.wechat.color);
  if (config.wechat?.author) args.push("--author", config.wechat.author);

  const env = {
    ...process.env,
    WECHAT_APP_ID: config.wechat?.appId || process.env.WECHAT_APP_ID || "",
    WECHAT_APP_SECRET: config.wechat?.appSecret || process.env.WECHAT_APP_SECRET || ""
  };

  if (dryRun) {
    return {
      ok: true,
      provider: "baoyu-post-to-wechat",
      dryRun: true,
      input: articlePath,
      command: [command.bin, ...args].join(" "),
      note: "Dry run only. The command is prepared but not executed."
    };
  }

  const result = spawnSync(command.bin, args, {
    cwd: projectRoot,
    env,
    encoding: "utf8"
  });

  return {
    ok: result.status === 0,
    provider: "baoyu-post-to-wechat",
    dryRun: false,
    input: articlePath,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function resolveBunCommand() {
  return {
    bin: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "bun"]
  };
}
