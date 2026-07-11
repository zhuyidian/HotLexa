import { getSourceByDomain } from "../sourceRegistry.js";

export async function collectWithSerper({ tasks, registry, maxItems, apiKey }) {
  const items = [];

  for (const task of tasks) {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({ q: task.query, num: 3 })
    });

    if (!response.ok) {
      throw new Error(`Serper search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    for (const result of data.organic || []) {
      const source = getSourceByDomain(registry, result.link) || task;
      items.push({
        title: result.title,
        url: result.link,
        source: source.name || task.sourceName,
        platform: source.platform || task.platform,
        publishedAt: result.date || "",
        author: "",
        summary: result.snippet || "",
        evidenceType: task.evidenceType,
        authorityScore: source.authorityScore || task.authorityScore || 0,
        collector: "serper",
        assets: []
      });
    }
  }

  return dedupeByUrl(items).slice(0, maxItems);
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
