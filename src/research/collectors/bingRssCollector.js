import { getSourceByDomain } from "../sourceRegistry.js";

export async function collectWithBingRss({ tasks, registry, maxItems }) {
  const items = [];
  const perTaskLimit = Math.max(1, Math.ceil(maxItems / Math.max(1, tasks.length)));

  for (const task of tasks) {
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", task.query);
    url.searchParams.set("format", "rss");

    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 HotLexa/0.1"
        },
        timeoutMs: 10000
      });

      if (!response.ok) continue;

      const xml = await response.text();
      const parsedItems = parseRssItems(xml).slice(0, perTaskLimit);

      for (const result of parsedItems) {
        if (task.domain && !urlMatchesDomain(result.link, task.domain)) {
          continue;
        }

        if (!isRelevantResult(result, task.query)) {
          continue;
        }

        const source = getSourceByDomain(registry, result.link) || task;
        const assets = await extractPageImageCandidates(result.link);

        items.push({
          title: result.title,
          url: result.link,
          source: source.name || task.sourceName,
          platform: source.platform || task.platform,
          publishedAt: result.pubDate,
          author: "",
          summary: result.description,
          evidenceType: task.evidenceType,
          authorityScore: source.authorityScore || task.authorityScore || 0,
          collector: "bing-rss",
          assets
        });
      }
    } catch {
      // Search fallbacks should be best-effort so one unreachable source does not break the run.
    }
  }

  return dedupeByUrl(items).slice(0, maxItems);
}

async function extractPageImageCandidates(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 HotLexa/0.1"
      },
      timeoutMs: 6000
    });

    if (!response.ok) return [];

    const html = await response.text();
    const imageUrl = firstMetaContent(html, ["og:image", "twitter:image", "twitter:image:src"]);
    if (!imageUrl) return [];

    return [
      {
        url: absolutizeUrl(imageUrl, url),
        source: "page metadata image",
        licenseStatus: "needs-review",
        caption: "",
        credit: new URL(url).hostname
      }
    ];
  } catch {
    return [];
  }
}

function firstMetaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, "i")
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeXml(match[1]);
    }
  }

  return "";
}

function absolutizeUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function isRelevantResult(result, query) {
  const terms = queryTerms(query);
  if (!terms.length) return true;

  const haystack = `${result.title} ${result.description}`.toLowerCase().replace(/\s+/g, "");
  const compactQuery = terms.join("");

  if (compactQuery.length > 2 && haystack.includes(compactQuery)) {
    return true;
  }

  return terms.every((term) => haystack.includes(term));
}

function queryTerms(query) {
  const cleaned = query
    .replace(/site:[^\s]+/gi, " ")
    .replace(/\b(latest|today|news)\b/gi, " ")
    .replace(/[最新今日今天新闻]/g, " ");

  return [...cleaned.toLowerCase().matchAll(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g)]
    .map((match) => match[0])
    .filter((term) => term.length > 1);
}

function urlMatchesDomain(value, domain) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, { timeoutMs, ...options }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssItems(xml) {
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return itemBlocks.map((item) => ({
    title: decodeXml(extractTag(item, "title")),
    link: decodeXml(extractTag(item, "link")),
    description: stripHtml(decodeXml(extractTag(item, "description"))),
    pubDate: normalizeDate(decodeXml(extractTag(item, "pubDate")))
  }));
}

function extractTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() || "";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
