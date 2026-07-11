import fs from "node:fs/promises";
import path from "node:path";

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function loadConfig() {
  const root = process.cwd();
  const defaults = await readJsonIfExists(path.join(root, "config/defaults.json"), {});
  const secrets = await readJsonIfExists(path.join(root, "config/local.secrets.json"), {});

  return {
    root,
    defaults,
    secrets
  };
}
