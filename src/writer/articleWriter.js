import { compactText } from "../utils.js";

export function buildArticleDraft({ evidence, config }) {
  const title = `${config.writer?.defaultTitlePrefix || ""}${evidence.query}`;
  const selectedItems = getSelectedItems(evidence);
  const officialItems = selectedItems.filter((item) => item.authority.level === "official");
  const authoritativeItems = selectedItems.filter((item) => item.authority.level === "authoritative");
  const highSignalItems = selectedItems.filter(
    (item) => item.authority.level === "high-signal" || item.metrics?.searchTier === "high-signal" || item.evidenceType === "social-signal"
  );
  const otherItems = selectedItems.filter(
    (item) => !["official", "authoritative"].includes(item.authority.level) && !highSignalItems.includes(item)
  );

  return [
    "---",
    `title: "${escapeYaml(title)}"`,
    `author: "${escapeYaml(config.writer?.author || config.wechat?.author || "HotLexa")}"`,
    `description: "${escapeYaml(`围绕 ${evidence.query} 的权威信息整理`)}"`,
    "---",
    "",
    `# ${title}`,
    "",
    "## 核心判断",
    "",
    buildLead(evidence),
    "",
    "## 官方与权威证据",
    "",
    renderItems([...officialItems, ...authoritativeItems], "暂无已采集的官方或权威证据。"),
    "",
    "## 高热度讨论信号",
    "",
    renderItems(highSignalItems, "暂无已采集的高热度个人账号或创作者信号。"),
    "",
    "## 其它可参考信息",
    "",
    renderItems(otherItems, "暂无其它已采集信息。"),
    "",
    "## 截图与素材待办",
    "",
    renderAssetTodos(evidence),
    "",
    "## 参考链接",
    "",
    renderReferences(selectedItems),
    ""
  ].join("\n");
}

export function buildHumanizerRequest({ evidencePath, draftPath, outputPath }) {
  return [
    "# Humanizer Request",
    "",
    "请使用项目内 `.agents/skills/humanizer` 的规则，对公众号初稿进行人味化润色。",
    "",
    "输入文件：",
    "",
    `- 证据包：${evidencePath}`,
    `- 初稿：${draftPath}`,
    "",
    "输出建议：",
    "",
    `- 润色后的 Markdown 保存为：${outputPath}`,
    "",
    "要求：",
    "",
    "1. 不新增证据包之外的事实。",
    "2. 保留官方/权威来源优先级。",
    "3. 高流量个人账号只作为讨论信号，不作为事实主证据。",
    "4. 删掉明显 AI 腔、空泛判断、过度排比和不必要的连接词。",
    "5. 中文表达自然、直接，适合公众号阅读。",
    ""
  ].join("\n");
}

function buildLead(evidence) {
  if (evidence.items.length === 0) {
    return [
      "当前还没有拿到实时证据，系统已经生成待采集任务。",
      "下一步应先补齐 YouTube、X 和官网/权威媒体来源，再进入润色。"
    ].join("\n\n");
  }

  const officialCount = evidence.summary.selectedByAuthority?.official || 0;
  const authoritativeCount = evidence.summary.selectedByAuthority?.authoritative || 0;
  const selectedCount = evidence.summary.selectedCount || getSelectedItems(evidence).length;
  const highSignalCount = getSelectedItems(evidence).filter((item) => item.authority.level === "high-signal" || item.metrics?.searchTier === "high-signal").length;
  return `本次围绕「${evidence.query}」共整理 ${evidence.items.length} 条证据，评分器精选 ${selectedCount} 条进入初稿。其中官方来源 ${officialCount} 条，权威来源 ${authoritativeCount} 条，高热度讨论信号 ${highSignalCount} 条。下面先保留事实骨架，后续可在 Codex 会话中直接基于证据包和初稿润色成公众号文章。`;
}

function renderItems(items, emptyText) {
  if (!items.length) return emptyText;
  return items
    .map((item) => {
      const source = [item.sourceName || item.author, item.publishedAt].filter(Boolean).join(" · ");
      const tier = item.metrics?.searchTier ? `搜索层级：${item.metrics.searchTier}` : "";
      const ranking = item.ranking ? `推荐分：${item.ranking.score}（${item.ranking.reasons?.slice(0, 3).join("；")}）` : "";
      return [
        `### ${item.title || item.url || item.id}`,
        "",
        source ? `来源：${source}` : "",
        `可信度：${item.authority.level} (${item.authority.score})`,
        ranking,
        tier,
        item.summary ? `要点：${compactText(item.summary, 400)}` : "",
        item.rawText ? `摘录：${compactText(item.rawText, 500)}` : "",
        item.url ? `链接：${item.url}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function renderAssetTodos(evidence) {
  const todos = [];
  for (const item of evidence.items) {
    for (const asset of item.assets || []) {
      if (asset.type === "screenshot" && asset.status === "planned") {
        todos.push(`- ${item.platform}: ${item.sourceName || item.author || item.title} -> ${asset.targetUrl}`);
      }
    }
  }
  if (todos.length) return todos.join("\n");
  if (evidence.plannedItems.length) {
    return evidence.plannedItems
      .map((item) => `- ${item.platform}/${item.tier || "general"}: ${item.action} (${item.reason})`)
      .join("\n");
  }
  return "暂无截图待办。";
}

function renderReferences(items) {
  const refs = items
    .filter((item) => item.url)
    .map((item, index) => `${index + 1}. ${item.title || item.sourceName || item.platform}: ${item.url}`);
  return refs.length ? refs.join("\n") : "暂无参考链接。";
}

function getSelectedItems(evidence) {
  const items = evidence.items || [];
  const hasSelection = items.some((item) => typeof item.selected === "boolean");
  const selected = hasSelection ? items.filter((item) => item.selected) : items;
  return [...selected].sort(
    (a, b) => (b.ranking?.score || 0) - (a.ranking?.score || 0) || (a.ranking?.sourceOrder || 0) - (b.ranking?.sourceOrder || 0)
  );
}

function escapeYaml(value) {
  return String(value || "").replace(/"/g, '\\"');
}
