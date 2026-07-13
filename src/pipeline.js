import path from "node:path";
import { loadConfig, projectRoot } from "./config.js";
import { ensureDir, slugify, timestampId, writeJson, writeText } from "./utils.js";
import { collectEvidence } from "./research/collector.js";
import { buildArticleDraft, buildHumanizerRequest } from "./writer/articleWriter.js";
import { renderWechatHtml } from "./wechat/renderer.js";
import { publishArticle } from "./wechat/publisher.js";

export async function runPipeline({ query, publish = false, dryRun = true }) {
  const config = await loadConfig();
  const runDir = path.resolve(projectRoot, config.runDir || ".runs", `${timestampId()}-${slugify(query)}`);
  await ensureDir(runDir);

  const evidence = await collectEvidence({ query, config });
  const evidencePath = path.join(runDir, "evidence.json");
  await writeJson(evidencePath, evidence);

  const draft = buildArticleDraft({ evidence, config });
  const draftPath = path.join(runDir, "article.draft.md");
  await writeText(draftPath, draft);

  const humanizedPath = path.join(runDir, "article.humanized.md");
  const humanizerRequestPath = path.join(runDir, "humanizer-request.md");
  await writeText(
    humanizerRequestPath,
    buildHumanizerRequest({
      evidencePath,
      draftPath,
      outputPath: humanizedPath
    })
  );

  const polishRequestPath = path.join(runDir, "codex-polish-request.md");
  await writeText(polishRequestPath, buildPolishRequest(query, evidencePath, draftPath, humanizerRequestPath));

  const renderResult = await renderWechatHtml({ markdownPath: draftPath, config, dryRun });

  let publishResult = null;
  if (publish) {
    publishResult = await publishArticle({ articlePath: draftPath, config, dryRun });
  }

  const summary = {
    query,
    runDir,
    mode: evidence.mode,
    files: {
      evidence: evidencePath,
      draft: draftPath,
      humanizerRequest: humanizerRequestPath,
      humanized: humanizedPath,
      polishRequest: polishRequestPath,
      html: renderResult.htmlPath || draftPath.replace(/\.md$/i, ".html")
    },
    evidenceSummary: evidence.summary,
    errors: evidence.errors,
    renderResult,
    publishResult
  };
  await writeJson(path.join(runDir, "run-summary.json"), summary);
  return summary;
}

function buildPolishRequest(query, evidencePath, draftPath, humanizerRequestPath) {
  return [
    `请基于下面文件，把「${query}」整理润色成一篇公众号草稿：`,
    "",
    `- 证据包：${evidencePath}`,
    `- 初稿：${draftPath}`,
    `- Humanizer 规则请求：${humanizerRequestPath}`,
    "",
    "要求：",
    "",
    "1. 只使用证据包里能追溯到来源的信息，不要编造。",
    "2. 保留官方/权威来源的优先级。",
    "3. 高流量个人账号只作为讨论信号，不作为事实主证据。",
    "4. 按 `.agents/skills/humanizer` 的规则去掉明显 AI 腔。",
    "5. 如证据不足，明确标注需要补采的来源或截图。",
    "6. 输出可直接交给公众号发布流程的 Markdown。",
    ""
  ].join("\n");
}
