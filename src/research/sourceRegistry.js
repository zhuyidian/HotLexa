import fs from "node:fs/promises";
import path from "node:path";

export async function loadSourceRegistry(config) {
  const registryPath = config.defaults.sources?.registryPath || "config/source-registry.json";
  const absolutePath = path.join(config.root, registryPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

export function getSourcesByPlatform(registry, platform) {
  return registry.filter((source) => source.platform === platform);
}

export function getSourceByDomain(registry, url) {
  if (!url) return null;

  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }

  return registry.find((source) => host === source.domain || host.endsWith(`.${source.domain}`)) || null;
}
