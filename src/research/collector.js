import { extractAssetCandidates, plannedAssetRules } from "./assetExtractor.js";
import { collectWithBingRss } from "./collectors/bingRssCollector.js";
import { collectWithSerper } from "./collectors/serperCollector.js";
import { collectFromX } from "./collectors/xCollector.js";
import { collectFromYouTube } from "./collectors/youtubeCollector.js";
import { buildQueryPlan } from "./queryPlanner.js";
import { rankItems } from "./ranker.js";
import { loadSourceRegistry } from "./sourceRegistry.js";

export async function collectResearch({ query, config }) {
  const registry = await loadSourceRegistry(config);
  const queryPlan = buildQueryPlan({ query, registry, config });
  const maxItems = config.defaults.sources?.maxItems || 20;
  const enabledCollectors = new Set(config.defaults.sources?.enabledCollectors || []);
  const items = [];

  const siteSearchTasks = queryPlan.tasks.filter((task) => !["x", "youtube"].includes(task.collector));
  if (enabledCollectors.has("web") && config.secrets.search?.serperApiKey) {
    items.push(
      ...(await collectWithSerper({
        tasks: siteSearchTasks,
        registry,
        maxItems,
        apiKey: config.secrets.search.serperApiKey
      }))
    );
  } else if (enabledCollectors.has("web")) {
    items.push(
      ...(await collectWithBingRss({
        tasks: siteSearchTasks,
        registry,
        maxItems
      }))
    );
  }

  const youtubeTask = queryPlan.tasks.find((task) => task.collector === "youtube");
  if (enabledCollectors.has("youtube") && youtubeTask) {
    items.push(
      ...(await collectFromYouTube({
        task: youtubeTask,
        apiKey: config.secrets.search?.youtubeApiKey
      }))
    );
  }

  const xTask = queryPlan.tasks.find((task) => task.collector === "x");
  if (enabledCollectors.has("x") && xTask) {
    items.push(
      ...(await collectFromX({
        task: xTask,
        bearerToken: config.secrets.search?.xBearerToken
      }))
    );
  }

  const rankedItems = rankItems(items).slice(0, maxItems);
  const assetCandidates = extractAssetCandidates(rankedItems);

  return {
    mode: rankedItems.length ? "multi-source" : "multi-source-planned",
    query,
    note: rankedItems.length
      ? "Collected live items from available providers and ranked them by authority, freshness, and evidence type."
      : "No live provider returned results. The query plan records what HotLexa will collect from official, domestic authority, X, YouTube, and web sources.",
    queryPlan,
    sourceCoverage: buildSourceCoverage({ queryPlan, rankedItems }),
    items: rankedItems,
    assetCandidates,
    plannedAssetRules: plannedAssetRules(queryPlan)
  };
}

function buildSourceCoverage({ queryPlan, rankedItems }) {
  const planned = countBy(queryPlan.tasks, "platform");
  const collected = countBy(rankedItems, "platform");

  return Object.fromEntries(
    Object.keys(planned)
      .sort()
      .map((platform) => [
        platform,
        {
          planned: planned[platform] || 0,
          collected: collected[platform] || 0
        }
      ])
  );
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}
