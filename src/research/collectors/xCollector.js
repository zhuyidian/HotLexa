export async function collectFromX({ task, bearerToken }) {
  if (!bearerToken) return [];

  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", task.query);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "created_at,author_id,public_metrics,attachments");
  url.searchParams.set("expansions", "attachments.media_keys,author_id");
  url.searchParams.set("media.fields", "url,preview_image_url,type,alt_text");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`X search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const users = new Map((data.includes?.users || []).map((user) => [user.id, user]));
  const media = new Map((data.includes?.media || []).map((item) => [item.media_key, item]));

  return (data.data || []).map((post) => {
    const author = users.get(post.author_id);
    const postMedia = (post.attachments?.media_keys || []).map((key) => media.get(key)).filter(Boolean);

    return {
      title: truncate(post.text, 90),
      url: author?.username ? `https://x.com/${author.username}/status/${post.id}` : `https://x.com/i/web/status/${post.id}`,
      source: author?.username ? `@${author.username}` : "X",
      platform: "x",
      publishedAt: post.created_at || "",
      author: author?.username || post.author_id || "",
      summary: post.text || "",
      evidenceType: "social-signal",
      authorityScore: task.authorityScore,
      collector: "x",
      assets: postMedia.map((item) => ({
        url: item.url || item.preview_image_url || "",
        source: "X media",
        licenseStatus: "social-needs-review",
        caption: item.alt_text || post.text || "",
        credit: author?.username ? `@${author.username}` : ""
      }))
    };
  });
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text || "";
  return `${text.slice(0, maxLength - 1)}...`;
}
