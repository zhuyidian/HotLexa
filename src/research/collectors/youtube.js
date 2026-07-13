import { compactText, fetchJson } from "../../utils.js";

export async function collectYoutube({ query, config, registry = {} }) {
  if (!config.sources?.youtube?.enabled) return { items: [], planned: [] };

  const tasks = buildYoutubeTierTasks({ query, config, registry });
  const serperResult = await collectYoutubeWithSerper({ tasks, config });
  if (serperResult.items.length > 0) return serperResult;

  const transcriptApiResult = await collectYoutubeWithTranscriptApi({ tasks, config });
  if (transcriptApiResult.items.length > 0) return transcriptApiResult;

  return {
    items: [],
    planned: transcriptApiResult.planned.length > 0 ? transcriptApiResult.planned : serperResult.planned
  };
}

async function collectYoutubeWithSerper({ tasks, config }) {
  const serperApiKey = config.web?.serperApiKey || process.env.SERPER_API_KEY;
  if (!serperApiKey) {
    return {
      items: [],
      planned: tasks.map((task) => plannedYoutubeTaskFromTier(task, "missing SERPER_API_KEY or web.serperApiKey for YouTube Serper search"))
    };
  }

  const timeoutMs = config.collection?.requestTimeoutMs || 15000;
  const limit = config.collection?.maxItemsPerChannel || 8;
  const items = [];
  const planned = [];

  for (const task of tasks) {
    const serperQuery = `site:youtube.com/watch ${task.searchQuery}`;
    let data;
    try {
      data = await fetchJson("https://google.serper.dev/search", {
        method: "POST",
        timeoutMs,
        headers: {
          "X-API-KEY": serperApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ q: serperQuery, num: limit })
      });
    } catch (error) {
      planned.push(plannedYoutubeTaskFromTier(task, `Serper YouTube search failed: ${error.message}`));
      continue;
    }

    const rows = [...(Array.isArray(data.videos) ? data.videos : []), ...(Array.isArray(data.organic) ? data.organic : [])]
      .filter((row) => isYoutubeWatchUrl(row.link))
      .slice(0, limit);

    if (!rows.length) {
      planned.push(plannedYoutubeTaskFromTier(task, "Serper returned no YouTube watch results for this tier"));
      continue;
    }

    items.push(...rows.map((row) => mapSerperYoutubeRowToEvidence({ row, task })));
  }

  return { items: dedupeItems(items), planned };
}

async function collectYoutubeWithTranscriptApi({ tasks, config }) {
  const apiKey = config.youtube?.transcriptApiKey || process.env.TRANSCRIPT_API_KEY;
  if (!apiKey) {
    return {
      items: [],
      planned: tasks.map((task) => plannedYoutubeTaskFromTier(task, "missing TRANSCRIPT_API_KEY or youtube.transcriptApiKey fallback"))
    };
  }

  const limit = config.collection?.maxItemsPerChannel || 8;
  const timeoutMs = config.collection?.requestTimeoutMs || 15000;
  const transcriptTopN = config.collection?.youtubeTranscriptTopN || 0;
  const items = [];
  const planned = [];

  for (const task of tasks) {
    const searchUrl = new URL("https://transcriptapi.com/api/v2/youtube/search");
    searchUrl.searchParams.set("q", task.searchQuery);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("limit", String(limit));

    let data;
    try {
      data = await fetchJson(searchUrl, {
        timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` }
      });
    } catch (error) {
      planned.push(plannedYoutubeTaskFromTier(task, normalizeTranscriptApiError(error.message)));
      continue;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    for (const [index, video] of results.entries()) {
      let rawText = "";
      if (index < transcriptTopN && video.videoId) {
        rawText = await fetchTranscript(video.videoId, apiKey, timeoutMs).catch(() => "");
      }
      items.push(mapTranscriptApiVideoToEvidence({ video, rawText, task }));
    }
  }

  return { items: dedupeItems(items), planned };
}

function mapSerperYoutubeRowToEvidence({ row, task }) {
  const url = normalizeYoutubeUrl(row.link || "");
  return {
    platform: "youtube",
    evidenceType: task.tier === "high-signal" ? "creator-video" : "video",
    sourceName: row.channel || row.source || "",
    author: row.channel || row.source || "",
    handle: "",
    channelId: "",
    title: row.title || "",
    url,
    publishedAt: row.date || "",
    summary: compactText(row.snippet || "", 700),
    rawText: "",
    metrics: {
      provider: "serper",
      searchTier: task.tier,
      searchLabel: task.label
    },
    assets: buildSerperAssets(row)
  };
}

function mapTranscriptApiVideoToEvidence({ video, rawText, task }) {
  return {
    platform: "youtube",
    evidenceType: task.tier === "high-signal" ? "creator-video" : "video",
    sourceName: video.channelTitle || "",
    author: video.channelTitle || "",
    handle: video.channelHandle || "",
    channelId: video.channelId || "",
    title: video.title || "",
    url: video.videoId ? `https://www.youtube.com/watch?v=${video.videoId}` : "",
    publishedAt: video.publishedTimeText || "",
    summary: compactText(video.description || "", 700),
    rawText,
    metrics: {
      provider: "transcriptapi",
      viewCountText: video.viewCountText || "",
      lengthText: video.lengthText || "",
      channelVerified: Boolean(video.channelVerified),
      searchTier: task.tier,
      searchLabel: task.label
    },
    assets: buildThumbnailAssets(video)
  };
}

async function fetchTranscript(videoId, apiKey, timeoutMs) {
  const url = new URL("https://transcriptapi.com/api/v2/youtube/transcript");
  url.searchParams.set("video_url", videoId);
  url.searchParams.set("format", "text");
  url.searchParams.set("include_timestamp", "true");
  url.searchParams.set("send_metadata", "true");
  const data = await fetchJson(url, {
    timeoutMs,
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  return typeof data === "string" ? data : JSON.stringify(data);
}

function buildThumbnailAssets(video) {
  const thumbs = Array.isArray(video.thumbnails) ? video.thumbnails : [];
  return thumbs.slice(0, 1).map((thumb) => ({
    type: "image",
    status: "remote",
    purpose: "youtube thumbnail",
    url: thumb.url || ""
  }));
}

function buildSerperAssets(row) {
  const imageUrl = row.imageUrl || row.thumbnailUrl || row.thumbnail || "";
  return imageUrl
    ? [
        {
          type: "image",
          status: "remote",
          purpose: "youtube search thumbnail",
          url: imageUrl
        }
      ]
    : [];
}

function plannedYoutubeTaskFromTier(task, reason) {
  return {
    platform: "youtube",
    status: "planned",
    reason,
    tier: task.tier,
    label: task.label,
    channels: task.channels,
    action: task.action,
    query: task.query,
    searchQuery: task.searchQuery,
    searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(task.searchQuery)}`,
    expectedAssets: task.expectedAssets
  };
}

function buildYoutubeTierTasks({ query, config, registry }) {
  const maxChannels = config.searchStrategy?.youtubeMaxChannelsPerTier || 5;
  const youtube = registry.youtube || {};
  const tiers = [
    {
      tier: "official",
      label: "Official YouTube channels",
      channels: (youtube.officialChannels || []).slice(0, maxChannels),
      action: "Search official YouTube channels first and fetch transcripts.",
      expectedAssets: ["official video transcript", "thumbnail", "official channel screenshot"]
    },
    {
      tier: "authoritative",
      label: "Authoritative YouTube channels",
      channels: (youtube.authoritativeChannels || []).slice(0, maxChannels),
      action: "Search authoritative YouTube channels for independent context.",
      expectedAssets: ["authoritative video transcript", "thumbnail", "channel screenshot"]
    },
    {
      tier: "high-signal",
      label: "High-signal YouTube creators",
      channels: (youtube.highSignalCreators || []).slice(0, maxChannels),
      action: "Search high-signal creators only as social-signal context.",
      expectedAssets: ["creator video transcript", "thumbnail", "screenshot for review"]
    }
  ];

  return tiers
    .filter((tier) => tier.channels.length > 0)
    .map((tier) => {
      const channelQuery = tier.channels.map((channel) => `"${channel.name}"`).join(" OR ");
      return {
        ...tier,
        query,
        channels: tier.channels.map((channel) => channel.handle || channel.name),
        searchQuery: `${query} (${channelQuery})`
      };
    });
}

function normalizeTranscriptApiError(message) {
  if (message.includes("HTTP 402")) {
    return "TranscriptAPI fallback returned HTTP 402. The key is missing quota or the account plan cannot search YouTube right now.";
  }
  if (message.includes("HTTP 401")) {
    return "TranscriptAPI fallback returned HTTP 401. Check youtube.transcriptApiKey.";
  }
  if (message.includes("HTTP 429")) {
    return "TranscriptAPI fallback returned HTTP 429. Rate limit reached; retry later.";
  }
  return message;
}

function isYoutubeWatchUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("youtube.com") && parsed.pathname === "/watch" && parsed.searchParams.get("v");
  } catch {
    return false;
  }
}

function normalizeYoutubeUrl(url) {
  try {
    const parsed = new URL(url);
    const videoId = parsed.searchParams.get("v");
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
  } catch {
    return url;
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
