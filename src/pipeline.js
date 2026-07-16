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
    `请基于下面文件，把「${query}」整理重写成一篇可直接发布的公众号文章：`,
    "",
    `- 证据包：${evidencePath}`,
    `- 初稿：${draftPath}`,
    `- Humanizer 规则请求：${humanizerRequestPath}`,
    "",
    "要求：",
    "",
    "1. 只使用证据包里能追溯到来源的信息，不要编造。",
    "2. 最终稿必须是完整、连续、读者视角的文章，不要写成渠道采集报告、证据清单或内部分析备忘录。",
    "3. 正文不要出现渠道相关名称、站点名、账号名、频道名、抓取工具名或“采集到/证据包/评分器/初稿/润色”这类内部流程词。",
    "4. 保留官方/权威来源的优先级；高流量个人账号和用户讨论只作为传播或情绪信号，不作为事实主证据。",
    "5. 从证据中抽取可用图片或截图，并插入到最相关的正文位置；图片说明解释内容关系，不要暴露渠道名。",
    "6. 按 `.agents/skills/humanizer` 的规则去掉明显 AI 腔、空泛判断、过度排比和不必要的连接词。",
    "7. 如证据不足，可以在判断上保守，但不要在正文里写内部待办。",
    "8. 输出可直接交给公众号发布流程的 Markdown。",
    ""
  ].join("\n");
}
