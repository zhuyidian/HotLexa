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
    "请使用项目内 `.agents/skills/humanizer` 的规则，把初稿重写成一篇可直接发布的公众号正文。",
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
    "2. 最终稿必须是一篇完整、连续、面向读者的文章，不要写成渠道采集报告、证据清单、内部分析备忘录或写作建议。",
    "3. 正文不要出现渠道相关名称、站点名、账号名、频道名、抓取工具名或“采集到/证据包/评分器/初稿/润色”这类内部流程词。",
    "4. 可以在内部使用官方/权威/外部解读/用户反馈的证据分层，但正文要自然表达为读者能理解的判断。",
    "5. 高流量个人账号和用户讨论只作为传播或情绪信号，不作为事实主证据。",
    "6. 从证据中抽取可用图片或截图，并插入到相关段落附近；图片说明要解释图片与该段内容的关系，不要暴露渠道名。",
    "7. 删掉明显 AI 腔、空泛判断、过度排比和不必要的连接词。",
    "8. 中文表达自然、直接，适合公众号阅读。",
    "",
    "最终稿自检：",
    "",
    "- 读者不需要知道信息来自哪些渠道，也能顺畅读完。",
    "- 每张图都放在它最相关的段落附近。",
    "- 参考来源可以保留必要的官方链接；非官方渠道链接不要作为正文重点展示。",
    "- 如果图片不足，正文里不要抱怨缺图；只插入已经能确认相关的图片。",
    ""
  ].join("\n");
}

function buildLead(evidence) {
  if (evidence.items.length === 0) {
    return [
      "当前还没有拿到足够事实材料，系统已经生成待补充任务。",
      "下一步应先补齐官方材料、可信解读和可用图片，再进入成稿。"
    ].join("\n\n");
  }

  const officialCount = evidence.summary.selectedByAuthority?.official || 0;
  const authoritativeCount = evidence.summary.selectedByAuthority?.authoritative || 0;
  const selectedCount = evidence.summary.selectedCount || getSelectedItems(evidence).length;
  const highSignalCount = getSelectedItems(evidence).filter((item) => item.authority.level === "high-signal" || item.metrics?.searchTier === "high-signal").length;
  return `本次围绕「${evidence.query}」共整理 ${evidence.items.length} 条材料，其中 ${selectedCount} 条适合进入成稿参考。官方材料 ${officialCount} 条，权威材料 ${authoritativeCount} 条，高热度讨论信号 ${highSignalCount} 条。下面先保留事实骨架，最终成稿时需要改写成连续的读者视角文章。`;
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
