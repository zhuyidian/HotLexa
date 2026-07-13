import path from "node:path";
import { fileURLToPath } from "node:url";
import { deepMerge, readJson } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, "..");

export async function loadConfig() {
  const defaultsPath = path.join(projectRoot, "config", "defaults.json");
  const localSecretsPath = path.join(projectRoot, "config", "local.secrets.json");
  const defaults = await readJson(defaultsPath, {});
  const localSecrets = await readJson(localSecretsPath, {});
  return deepMerge(defaults, localSecrets);
}

export function resolveProjectPath(...parts) {
  return path.resolve(projectRoot, ...parts);
}
