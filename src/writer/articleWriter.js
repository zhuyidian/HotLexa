export async function buildArticleDraft({ query, research, config }) {
  const title = buildTitle(query);
  const evidenceItems = research.items || [];
  const sourceRows = evidenceItems.length
    ? evidenceItems.map(formatEvidenceLine)
    : research.queryPlan.tasks.slice(0, 12).map(formatPlanLine);

  const markdown = [
    `# ${title}`,
    "",
    `> 选题：${query}`,
    "",
    "## 先说结论",
    "",
    buildLead({ query, research }),
    "",
    "## 信息源策略",
    "",
    ...formatCoverage(research.sourceCoverage),
    "",
    "## 文章主线",
    "",
    ...buildBodySections({ query, evidenceItems }),
    "",
    "## 证据与线索",
    "",
    ...sourceRows,
    "",
    "## 图片素材规则",
    "",
    ...formatAssetRules(research),
    "",
    "## 下一步",
    "",
    "接入真实搜索、X、YouTube 和 AI 写作适配器后，这里会替换为基于实时来源的完整公众号正文。正式创建公众号草稿前，仍然先跑 DryRun。"
  ].join("\n");

  return {
    title,
    author: config.defaults.article?.defaultAuthor || "HotLexa",
    digest: `${query} 的多源信息汇总与公众号文章草稿。`,
    contentSourceUrl: evidenceItems[0]?.url || "",
    markdown
  };
}

function buildTitle(query) {
  return `${query}：发生了什么，为什么值得关注`;
}

function buildLead({ query, research }) {
  if (research.mode === "multi-source-planned") {
    return `HotLexa 已经为“${query}”生成多源检索计划，覆盖官方原始源、国内权威媒体、国外主流媒体、X 平台和 YouTube。当前还没有配置真实 API 密钥，所以这次先输出可审核的采集计划和公众号格式化草稿。`;
  }

  return `HotLexa 已经围绕“${query}”采集到 ${research.items.length} 条候选证据，并按权威性、时效性和证据类型完成初步排序。`;
}

function formatCoverage(sourceCoverage = {}) {
  const rows = Object.entries(sourceCoverage).map(([platform, coverage]) => {
    return `- ${platform}：计划 ${coverage.planned} 条，已采集 ${coverage.collected} 条`;
  });

  return rows.length ? rows : ["- 尚未生成来源覆盖统计"];
}

function buildBodySections({ query, evidenceItems }) {
  if (!evidenceItems.length) {
    return [
      `围绕“${query}”，正文会先判断它是政策、产品、公司、行业还是社会议题，再把信息拆成“发生了什么、谁在推动、影响是什么、哪些仍待确认”四个部分。`
    ];
  }

  const topItems = evidenceItems.slice(0, 4);
  const summaries = topItems.map((item) => item.summary).filter(Boolean);

  return [
    "### 发生了什么",
    "",
    `从当前抓取到的候选来源看，“${query}”相关讨论主要集中在产品能力、系统级 AI 功能、厂商生态和用户体验差异上。`,
    "",
    ...summaries.slice(0, 2).map((summary) => `${compress(summary)}`),
    "",
    "### 为什么值得关注",
    "",
    "这类选题的价值不只在于单个产品参数，而在于 AI 能力是否开始进入手机系统的默认工作流：拍照、搜索、语音助手、内容生成、跨应用操作和隐私保护都会被重新定义。",
    "",
    "### 还需要确认什么",
    "",
    "目前本地闭环优先保证采集和排版可运行。正式发稿前，应继续补充官方发布页、厂商新闻稿、权威媒体报道，以及 X/YouTube 上来自官方账号或核心从业者的一手信号。社媒和视频素材只作为线索，不能单独作为事实结论。",
    "",
    "### 编辑判断",
    "",
    `如果“${query}”最终要写成公众号文章，建议把主线放在“AI 功能是否真正改变手机使用方式”，而不是只做型号或功能清单。这样读者能同时看到事实、变化和判断。`
  ];
}

function compress(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 220) return cleaned;
  return `${cleaned.slice(0, 219)}…`;
}

function formatEvidenceLine(item, index) {
  return `${index + 1}. [${item.title}](${item.url})｜${item.source}｜${item.evidenceType}｜评分 ${item.score}`;
}

function formatPlanLine(task, index) {
  return `${index + 1}. ${task.sourceName}｜${task.evidenceType}｜${task.query}`;
}

function formatAssetRules(research) {
  if (research.assetCandidates?.length) {
    return research.assetCandidates.slice(0, 8).map((asset, index) => {
      return `${index + 1}. ${asset.sourceTitle || asset.sourceName}｜${asset.licenseStatus}｜${asset.canAutoUse ? "可自动使用" : "需人工确认"}`;
    });
  }

  return research.plannedAssetRules.slice(0, 8).map((rule, index) => {
    return `${index + 1}. ${rule.sourceName}｜${rule.platform}｜${rule.licenseStatus}｜默认需人工确认`;
  });
}
