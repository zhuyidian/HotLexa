export async function polishArticleWithOpenAI({ query, research, draft, config }) {
  const apiKey = config.secrets.openai?.apiKey;
  if (!apiKey) {
    return {
      ...draft,
      generationMode: "local-template"
    };
  }

  const model = config.secrets.openai?.model || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: buildPrompt({ query, research, draft })
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI article polishing failed: ${response.status} ${detail}`);
  }

  const data = await response.json();
  const markdown = extractResponseText(data).trim();

  if (!markdown.startsWith("# ")) {
    return {
      ...draft,
      markdown: `${draft.markdown}\n\n## AI 润色结果\n\n${markdown}`,
      generationMode: "openai"
    };
  }

  return {
    ...draft,
    markdown,
    generationMode: "openai"
  };
}

function buildPrompt({ query, research, draft }) {
  const evidence = (research.items || [])
    .slice(0, 10)
    .map((item, index) => {
      return `${index + 1}. ${item.title}\n来源：${item.source}\n链接：${item.url}\n摘要：${item.summary}`;
    })
    .join("\n\n");

  return [
    "你是一个严谨的中文公众号编辑。",
    "请基于给定证据，把草稿润色成一篇可读、克制、有来源意识的公众号文章。",
    "要求：保留 Markdown；不要编造未给出的事实；社媒和视频只作为线索，不能当作事实定论；结尾列出来源。",
    `选题：${query}`,
    "",
    "证据：",
    evidence || "当前只有检索计划，尚无实时证据。请写成计划型草稿，不要假装已经采集到事实。",
    "",
    "原始草稿：",
    draft.markdown
  ].join("\n");
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n");
}
