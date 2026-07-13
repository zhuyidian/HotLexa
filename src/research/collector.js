import { loadAuthorityRegistry } from "./authorityRegistry.js";
import { buildEvidencePackage } from "./evidence.js";
import { collectYoutube } from "./collectors/youtube.js";
import { collectX } from "./collectors/x.js";
import { collectBilibili } from "./collectors/bilibili.js";
import { collectWeb } from "./collectors/web.js";

export async function collectEvidence({ query, config }) {
  const registry = await loadAuthorityRegistry(config);
  const collected = [];
  const planned = [];
  const errors = [];

  for (const collector of [collectYoutube, collectX, collectBilibili, collectWeb]) {
    try {
      const result = await collector({ query, config, registry });
      collected.push(...(result.items || []));
      planned.push(...(result.planned || []));
    } catch (error) {
      errors.push({
        collector: collector.name,
        message: error.message
      });
      planned.push(plannedFromError(query, collector.name, error));
    }
  }

  const evidence = buildEvidencePackage({ query, registry, collected, planned, config });
  return {
    ...evidence,
    errors
  };
}

function plannedFromError(query, collectorName, error) {
  const platform = collectorName.replace(/^collect/, "").toLowerCase();
  return {
    platform,
    status: "planned",
    reason: error.message,
    action: `Fix ${platform} collector credentials, quota, or network access, then rerun collection.`,
    query
  };
}
