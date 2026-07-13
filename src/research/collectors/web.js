import { compactText, fetchJson } from "../../utils.js";

export async function collectWeb({ query, config, registry }) {
  if (!config.sources?.web?.enabled) return { items: [], planned: [] };
  const serperApiKey = config.web?.serperApiKey || process.env.SERPER_API_KEY;
  if (!serperApiKey) {
    return {
      items: [],
      planned: plannedWebTasks(query, registry, "missing SERPER_API_KEY or web.serperApiKey")
    };
  }

  const timeoutMs = config.collection?.requestTimeoutMs || 15000;
  const maxItems = config.collection?.webMaxItems || 8;
  const communityMaxItems = config.collection?.webCommunityMaxItemsPerSource || 3;
  const communitySources = registry.web?.communitySources || [];
  const items = [];
  const planned = [];

  try {
    const data = await searchSerper({ q: query, num: maxItems, serperApiKey, timeoutMs });
    const rows = getSearchRows(data).slice(0, maxItems);
    items.push(...rows.map((row) => mapWebRow(row)));
  } catch (error) {
    planned.push(...plannedWebTasks(query, registry, `Serper web search failed: ${error.message}`));
  }

  for (const source of communitySources) {
    const siteQuery = source.siteQuery || (source.domain ? `site:${source.domain}` : "");
    if (!siteQuery) continue;

    try {
      const data = await searchSerper({
        q: `${siteQuery} ${query}`,
        num: communityMaxItems,
        serperApiKey,
        timeoutMs
      });
      const rows = getSearchRows(data).slice(0, communityMaxItems);
      if (!rows.length) {
        planned.push(plannedCommunityTask({ query, source, reason: "Serper returned no community results for this source" }));
        continue;
      }
      items.push(...rows.map((row) => mapCommunityRow({ row, source })));
    } catch (error) {
      planned.push(plannedCommunityTask({ query, source, reason: `Serper community search failed: ${error.message}` }));
    }
  }

  return { items: dedupeItems(items), planned };
}

async function searchSerper({ q, num, serperApiKey, timeoutMs }) {
  return fetchJson("https://google.serper.dev/search", {
    method: "POST",
    timeoutMs,
    headers: {
      "X-API-KEY": serperApiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ q, num })
  });
}

function getSearchRows(data) {
  const organic = Array.isArray(data.organic) ? data.organic : [];
  const news = Array.isArray(data.news) ? data.news : [];
  return [...news, ...organic];
}

function mapWebRow(row) {
  return {
    platform: "web",
    evidenceType: row.source ? "report" : "webpage",
    sourceName: row.source || "",
    title: row.title || "",
    url: row.link || "",
    publishedAt: row.date || "",
    summary: compactText(row.snippet || "", 700),
    rawText: "",
    metrics: {
      provider: "serper",
      searchTier: "general"
    }
  };
}

function mapCommunityRow({ row, source }) {
  return {
    platform: "web",
    evidenceType: "community-signal",
    sourceName: source.name || row.source || "",
    title: row.title || "",
    url: row.link || "",
    publishedAt: row.date || "",
    summary: compactText(row.snippet || "", 700),
    rawText: "",
    metrics: {
      provider: "serper",
      searchTier: "community",
      communitySource: source.name || "",
      category: source.category || ""
    }
  };
}

function plannedWebTasks(query, registry, reason) {
  const officialDomains = registry.web?.officialDomains || [];
  const authoritativeDomains = registry.web?.authoritativeDomains || [];
  const communitySources = registry.web?.communitySources || [];
  return [
    {
      platform: "web",
      status: "planned",
      reason,
      action: "Search official domains for primary announcements.",
      query,
      domains: officialDomains
    },
    {
      platform: "web",
      status: "planned",
      reason,
      action: "Search authoritative publications for independent confirmation.",
      query,
      domains: authoritativeDomains
    },
    {
      platform: "web",
      status: "planned",
      reason,
      action: "Search community and trend channels for discussion signals.",
      query,
      sources: communitySources.map((source) => source.name || source.url || source.domain).filter(Boolean)
    }
  ];
}

function plannedCommunityTask({ query, source, reason }) {
  return {
    platform: "web",
    status: "planned",
    reason,
    tier: "community",
    label: source.name || source.domain || "Community source",
    action: "Search this community or trend source for discussion signals.",
    query,
    sourceUrl: source.url || "",
    siteQuery: source.siteQuery || ""
  };
}

function dedupeItems(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = item.url || item.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}
