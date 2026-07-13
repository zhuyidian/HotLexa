import { compactText, fetchJson, normalizeHandle } from "../../utils.js";

export async function collectX({ query, config, registry = {} }) {
  if (!config.sources?.x?.enabled) return { items: [], planned: [] };

  const tasks = buildXTierTasks({ query, config, registry });
  const serperResult = await collectXWithSerper({ tasks, config });
  if (serperResult.items.length > 0) return serperResult;

  const apiResult = await collectXWithApi({ tasks, config });
  if (apiResult.items.length > 0) return apiResult;

  return {
    items: [],
    planned: apiResult.planned.length > 0 ? apiResult.planned : serperResult.planned
  };
}

async function collectXWithSerper({ tasks, config }) {
  const serperApiKey = config.web?.serperApiKey || process.env.SERPER_API_KEY;
  if (!serperApiKey) {
    return {
      items: [],
      planned: tasks.map((task) => plannedXTaskFromTier(task, "missing SERPER_API_KEY or web.serperApiKey for X Serper search"))
    };
  }

  const timeoutMs = config.collection?.requestTimeoutMs || 15000;
  const limit = config.collection?.maxItemsPerChannel || 8;
  const items = [];
  const planned = [];

  for (const task of tasks) {
    let data;
    try {
      data = await fetchJson("https://google.serper.dev/search", {
        method: "POST",
        timeoutMs,
        headers: {
          "X-API-KEY": serperApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ q: task.serperQuery, num: limit })
      });
    } catch (error) {
      planned.push(plannedXTaskFromTier(task, `Serper X search failed: ${error.message}`));
      continue;
    }

    const allowedHandles = new Set(task.accounts.map((account) => normalizeHandle(account)));
    const rows = [...(Array.isArray(data.news) ? data.news : []), ...(Array.isArray(data.organic) ? data.organic : [])]
      .map((row) => ({ row, status: parseXStatusUrl(row.link || "") }))
      .filter((entry) => entry.status)
      .filter((entry) => allowedHandles.has(normalizeHandle(entry.status.handle)))
      .slice(0, limit);

    if (!rows.length) {
      planned.push(plannedXTaskFromTier(task, "Serper returned no X status results authored by this tier's configured accounts"));
      continue;
    }

    items.push(...rows.map((entry) => mapSerperXRowToEvidence({ row: entry.row, status: entry.status, task })));
  }

  return { items: dedupeItems(items), planned };
}

async function collectXWithApi({ tasks, config }) {
  const bearerToken = config.x?.bearerToken || process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    return {
      items: [],
      planned: tasks.map((task) => plannedXTaskFromTier(task, "missing X_BEARER_TOKEN or x.bearerToken fallback"))
    };
  }

  const limit = Math.min(config.collection?.maxItemsPerChannel || 8, 100);
  const timeoutMs = config.collection?.requestTimeoutMs || 15000;
  const items = [];
  const planned = [];

  for (const task of tasks) {
    const url = buildXRecentSearchUrl(task.apiQuery, Math.max(10, Math.min(limit, 100)));
    let data;
    try {
      data = await fetchJson(url, {
        timeoutMs,
        headers: { Authorization: `Bearer ${bearerToken}` }
      });
    } catch (error) {
      planned.push(plannedXTaskFromTier(task, normalizeXApiError(error.message)));
      continue;
    }

    const users = new Map((data.includes?.users || []).map((user) => [user.id, user]));
    const media = new Map((data.includes?.media || []).map((item) => [item.media_key, item]));
    const tweets = Array.isArray(data.data) ? data.data.slice(0, limit) : [];
    items.push(...tweets.map((tweet) => mapTweetToEvidence({ tweet, users, media, task })));
  }

  return { items, planned };
}

function mapSerperXRowToEvidence({ row, status, task }) {
  return {
    platform: "x",
    evidenceType: task.tier === "high-signal" ? "social-signal" : "official-social",
    sourceName: status.handle ? `@${status.handle}` : row.source || "",
    author: row.source || status.handle || "",
    handle: status.handle || "",
    title: row.title || "",
    url: status.url,
    publishedAt: row.date || "",
    summary: compactText(row.snippet || "", 700),
    rawText: "",
    metrics: {
      provider: "serper",
      searchTier: task.tier,
      searchLabel: task.label
    },
    assets: []
  };
}

function mapTweetToEvidence({ tweet, users, media, task }) {
  const user = users.get(tweet.author_id) || {};
  return {
    platform: "x",
    evidenceType: task.tier === "high-signal" ? "social-signal" : "official-social",
    sourceName: user.username ? `@${user.username}` : "",
    author: user.name || user.username || "",
    handle: user.username || "",
    title: compactText(tweet.text || "", 120),
    url: user.username && tweet.id ? `https://x.com/${user.username}/status/${tweet.id}` : "",
    publishedAt: tweet.created_at || "",
    summary: compactText(tweet.text || "", 700),
    rawText: tweet.text || "",
    metrics: {
      ...(tweet.public_metrics || {}),
      searchTier: task.tier,
      searchLabel: task.label
    },
    assets: buildMediaAssets(tweet, media)
  };
}

function buildMediaAssets(tweet, media) {
  const keys = tweet.attachments?.media_keys || [];
  return keys
    .map((key) => media.get(key))
    .filter(Boolean)
    .map((item) => ({
      type: item.type || "image",
      status: "remote",
      purpose: "tweet media",
      url: item.url || item.preview_image_url || ""
    }))
    .filter((asset) => asset.url);
}

function plannedXTaskFromTier(task, reason) {
  return {
    platform: "x",
    status: "planned",
    reason,
    tier: task.tier,
    label: task.label,
    accounts: task.accounts,
    action: task.action,
    query: task.query,
    apiQuery: task.apiQuery,
    serperQuery: task.serperQuery,
    searchUrl: task.searchUrl,
    expectedAssets: task.expectedAssets
  };
}

function buildXTierTasks({ query, config, registry }) {
  const maxAccounts = config.searchStrategy?.xMaxAccountsPerTier || 6;
  const x = registry.x || {};
  const tiers = [
    {
      tier: "official",
      label: "Official X accounts",
      accounts: (x.officialAccounts || []).slice(0, maxAccounts),
      action: "Search official X accounts first and capture primary-source posts.",
      expectedAssets: ["official post text", "public metrics", "official account screenshot"]
    },
    {
      tier: "authoritative",
      label: "Authoritative X accounts",
      accounts: (x.authoritativeAccounts || []).slice(0, maxAccounts),
      action: "Search authoritative X accounts for independent confirmation.",
      expectedAssets: ["authoritative post text", "public metrics", "authoritative account screenshot"]
    },
    {
      tier: "high-signal",
      label: "High-signal individual accounts",
      accounts: (x.highSignalAccounts || []).slice(0, maxAccounts),
      action: "Search high-signal individual accounts only as social-signal context.",
      expectedAssets: ["post text", "public metrics", "screenshot for review"]
    }
  ];

  return tiers
    .filter((tier) => tier.accounts.length > 0)
    .map((tier) => {
      const accountQuery = tier.accounts.map((account) => `from:${account.handle}`).join(" OR ");
      const apiQuery = `(${accountQuery}) (${query})`;
      const serperAccountQuery = tier.accounts.map((account) => `"${account.handle}"`).join(" OR ");
      const serperQuery = `site:x.com ${query} (${serperAccountQuery})`;
      return {
        ...tier,
        query,
        accounts: tier.accounts.map((account) => account.handle),
        apiQuery,
        serperQuery,
        searchUrl: `https://x.com/search?q=${encodeURIComponent(apiQuery)}&src=typed_query&f=live`
      };
    });
}

function buildXRecentSearchUrl(query, maxResults) {
  const url = new URL("https://api.twitter.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("tweet.fields", "created_at,public_metrics,entities");
  url.searchParams.set("expansions", "author_id,attachments.media_keys");
  url.searchParams.set("user.fields", "name,username,verified,verified_type");
  url.searchParams.set("media.fields", "url,preview_image_url,type");
  return url;
}

function normalizeXApiError(message) {
  if (message.includes("HTTP 402")) {
    return "X API returned HTTP 402. The bearer token is present, but the account/plan likely lacks recent search access or quota.";
  }
  if (message.includes("HTTP 401")) {
    return "X API returned HTTP 401. Check whether x.bearerToken is valid.";
  }
  if (message.includes("HTTP 403")) {
    return "X API returned HTTP 403. The token is valid but this endpoint may not be allowed for the app.";
  }
  if (message.includes("HTTP 429")) {
    return "X API returned HTTP 429. Rate limit reached; retry later.";
  }
  return message;
}

function parseXStatusUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!["x.com", "twitter.com"].includes(host)) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const statusIndex = parts.findIndex((part) => part.toLowerCase() === "status");
    if (statusIndex !== 1 || !parts[0] || !parts[2]) return null;

    return {
      handle: parts[0],
      id: parts[2],
      url: `https://x.com/${parts[0]}/status/${parts[2]}`
    };
  } catch {
    return null;
  }
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
