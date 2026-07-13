import { compactText, fetchJson } from "../../utils.js";

export async function collectBilibili({ query, config, registry = {} }) {
  if (!config.sources?.bilibili?.enabled) return { items: [], planned: [] };

  const tasks = buildBilibiliTierTasks({ query, config, registry });
  const serperApiKey = config.web?.serperApiKey || process.env.SERPER_API_KEY;
  if (!serperApiKey) {
    return {
      items: [],
      planned: tasks.map((task) => plannedBilibiliTaskFromTier(task, "missing SERPER_API_KEY or web.serperApiKey for Bilibili Serper search"))
    };
  }

  const timeoutMs = config.collection?.requestTimeoutMs || 15000;
  const limit = config.collection?.bilibiliMaxItemsPerTier || 5;
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
      planned.push(plannedBilibiliTaskFromTier(task, `Serper Bilibili search failed: ${error.message}`));
      continue;
    }

    const rows = [...(Array.isArray(data.videos) ? data.videos : []), ...(Array.isArray(data.organic) ? data.organic : [])]
      .map((row) => ({ row, url: normalizeBilibiliVideoUrl(row.link || "") }))
      .filter((entry) => entry.url)
      .slice(0, limit);

    if (!rows.length) {
      planned.push(plannedBilibiliTaskFromTier(task, "Serper returned no Bilibili video results for this tier"));
      continue;
    }

    items.push(...rows.map((entry) => mapSerperBilibiliRowToEvidence({ row: entry.row, url: entry.url, task })));
  }

  return { items: dedupeItems(items), planned };
}

function mapSerperBilibiliRowToEvidence({ row, url, task }) {
  return {
    platform: "bilibili",
    evidenceType: task.tier === "high-signal" ? "creator-video" : "video",
    sourceName: row.source || "",
    author: row.source || "",
    title: row.title || "",
    url,
    publishedAt: row.date || "",
    summary: compactText(row.snippet || "", 700),
    rawText: "",
    metrics: {
      provider: "serper",
      searchTier: task.tier,
      searchLabel: task.label,
      candidateChannels: task.channels
    },
    assets: buildSerperAssets(row)
  };
}

function buildSerperAssets(row) {
  const imageUrl = row.imageUrl || row.thumbnailUrl || row.thumbnail || "";
  return imageUrl
    ? [
        {
          type: "image",
          status: "remote",
          purpose: "bilibili search thumbnail",
          url: imageUrl
        }
      ]
    : [];
}

function plannedBilibiliTaskFromTier(task, reason) {
  return {
    platform: "bilibili",
    status: "planned",
    reason,
    tier: task.tier,
    label: task.label,
    channels: task.channels,
    action: task.action,
    query: task.query,
    serperQuery: task.serperQuery,
    searchUrl: `https://search.bilibili.com/all?keyword=${encodeURIComponent(task.searchQuery)}`,
    expectedAssets: task.expectedAssets
  };
}

function buildBilibiliTierTasks({ query, config, registry }) {
  const maxChannels = config.searchStrategy?.bilibiliMaxChannelsPerTier || 5;
  const bilibili = registry.bilibili || {};
  const tiers = [
    {
      tier: "official",
      label: "Official Bilibili channels",
      channels: (bilibili.officialChannels || []).slice(0, maxChannels),
      action: "Search official Bilibili channels for primary-source or product videos.",
      expectedAssets: ["official Bilibili video", "thumbnail", "official account screenshot"]
    },
    {
      tier: "authoritative",
      label: "Authoritative Bilibili channels",
      channels: (bilibili.authoritativeChannels || []).slice(0, maxChannels),
      action: "Search authoritative Bilibili channels for Chinese context and confirmation.",
      expectedAssets: ["authoritative Bilibili video", "thumbnail", "channel screenshot"]
    },
    {
      tier: "high-signal",
      label: "High-signal Bilibili creators",
      channels: (bilibili.highSignalCreators || []).slice(0, maxChannels),
      action: "Search high-signal Bilibili creators only as discussion and review signals.",
      expectedAssets: ["creator video", "thumbnail", "screenshot for review"]
    }
  ];

  return tiers
    .filter((tier) => tier.channels.length > 0)
    .map((tier) => {
      const channelQuery = tier.channels.map((channel) => `"${channel.name}"`).join(" OR ");
      const searchQuery = `${query} (${channelQuery})`;
      return {
        ...tier,
        query,
        channels: tier.channels.map((channel) => channel.name),
        searchQuery,
        serperQuery: `site:bilibili.com/video ${searchQuery}`
      };
    });
}

function normalizeBilibiliVideoUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!["bilibili.com", "m.bilibili.com"].includes(host)) return "";

    const match = parsed.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    return match ? `https://www.bilibili.com/video/${match[1]}` : "";
  } catch {
    return "";
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
