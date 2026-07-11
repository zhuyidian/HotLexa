export async function collectFromYouTube({ task, apiKey }) {
  if (!apiKey) return [];

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("q", task.query);
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("maxResults", "5");
  searchUrl.searchParams.set("key", apiKey);

  const response = await fetch(searchUrl);
  if (!response.ok) {
    throw new Error(`YouTube search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.items || []).map((item) => {
    const videoId = item.id?.videoId;
    const snippet = item.snippet || {};
    const thumbnail = snippet.thumbnails?.high || snippet.thumbnails?.medium || snippet.thumbnails?.default;

    return {
      title: snippet.title || "",
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
      source: snippet.channelTitle || "YouTube",
      platform: "youtube",
      publishedAt: snippet.publishedAt || "",
      author: snippet.channelTitle || "",
      summary: snippet.description || "",
      evidenceType: "video",
      authorityScore: task.authorityScore,
      collector: "youtube",
      assets: thumbnail?.url
        ? [
            {
              url: thumbnail.url,
              source: "YouTube thumbnail",
              licenseStatus: "thumbnail-needs-review",
              caption: snippet.title || "",
              credit: snippet.channelTitle || ""
            }
          ]
        : []
    };
  });
}
