import { getSourcesByPlatform } from "./sourceRegistry.js";

export function buildQueryPlan({ query, registry, config }) {
  const maxTasksPerCategory = config.defaults.sources?.maxTasksPerCategory || 6;
  const tasks = [
    ...siteTasks({ query, registry, platform: "official", maxTasksPerCategory }),
    ...siteTasks({ query, registry, platform: "cn-authority", maxTasksPerCategory }),
    ...siteTasks({ query, registry, platform: "cn-media", maxTasksPerCategory }),
    ...siteTasks({ query, registry, platform: "web", maxTasksPerCategory }),
    ...generalWebTasks(query),
    xTask(query),
    youtubeTask(query)
  ];

  return {
    query,
    createdAt: new Date().toISOString(),
    tasks
  };
}

function generalWebTasks(query) {
  return [
    {
      collector: "web",
      platform: "web",
      evidenceType: "report",
      sourceId: "bing-general",
      sourceName: "Bing Web",
      domain: "",
      query,
      authorityScore: 50,
      assetPolicy: "needs-review"
    },
    {
      collector: "web",
      platform: "web",
      evidenceType: "report",
      sourceId: "bing-latest-cn",
      sourceName: "Bing Web",
      domain: "",
      query: `${query} 最新`,
      authorityScore: 50,
      assetPolicy: "needs-review"
    }
  ];
}

function siteTasks({ query, registry, platform, maxTasksPerCategory }) {
  return getSourcesByPlatform(registry, platform)
    .slice(0, maxTasksPerCategory)
    .map((source) => ({
      collector: platform === "web" || platform === "cn-media" ? "web" : platform,
      platform,
      evidenceType: source.platform === "official" ? "official" : "report",
      sourceId: source.id,
      sourceName: source.name,
      domain: source.domain,
      query: `${query} site:${source.domain}`,
      authorityScore: source.authorityScore,
      assetPolicy: source.assetPolicy
    }));
}

function xTask(query) {
  return {
    collector: "x",
    platform: "x",
    evidenceType: "social-signal",
    sourceId: "x-platform",
    sourceName: "X",
    domain: "x.com",
    query: `${query} -is:retweet lang:en`,
    authorityScore: 45,
    assetPolicy: "social-needs-review"
  };
}

function youtubeTask(query) {
  return {
    collector: "youtube",
    platform: "youtube",
    evidenceType: "video",
    sourceId: "youtube",
    sourceName: "YouTube",
    domain: "youtube.com",
    query,
    authorityScore: 52,
    assetPolicy: "thumbnail-needs-review"
  };
}
