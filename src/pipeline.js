import fs from "node:fs/promises";
import path from "node:path";
import { buildDiagnostics } from "./diagnostics.js";
import { loadConfig } from "./config.js";
import { collectResearch } from "./research/collector.js";
import { buildArticleDraft } from "./writer/articleWriter.js";
import { polishArticleWithOpenAI } from "./writer/openaiWriter.js";
import { renderWechatHtml } from "./wechat/formatter.js";
import { prepareDraftPayload, publishDraft } from "./wechat/draftPublisher.js";
import { dateStamp, slugify } from "./utils.js";

export async function runPipeline({ query, publish = false, dryRun = true }) {
  const config = await loadConfig();
  const diagnostics = buildDiagnostics(config);
  const today = dateStamp();
  const runDir = path.join(config.root, config.defaults.runRoot || ".runs/hotlexa", today, slugify(query));
  await fs.mkdir(runDir, { recursive: true });

  const research = await collectResearch({ query, config });
  const researchPath = path.join(runDir, "research.json");
  await fs.writeFile(researchPath, JSON.stringify(research, null, 2), "utf8");

  const draftArticle = await buildArticleDraft({ query, research, config });
  const article = await polishArticleWithOpenAI({ query, research, draft: draftArticle, config });
  const articlePath = path.join(runDir, "article.md");
  await fs.writeFile(articlePath, article.markdown, "utf8");

  const html = renderWechatHtml(article);
  const htmlPath = path.join(runDir, "wechat-article.html");
  await fs.writeFile(htmlPath, html, "utf8");

  const payload = prepareDraftPayload({ article, html, config, dryRun });
  const payloadPath = path.join(runDir, "wechat-draft-payload.json");
  await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");

  let publishResult = { mode: "skipped" };
  if (publish) {
    publishResult = await publishDraft({ payload, config, dryRun });
  }

  const summary = {
    query,
    runDir,
    createdAt: new Date().toISOString(),
    dryRun,
    publish,
    files: {
      research: researchPath,
      article: articlePath,
      html: htmlPath,
      payload: payloadPath
    },
    diagnostics,
    researchMode: research.mode,
    articleGenerationMode: article.generationMode || "local-template",
    publishResult
  };

  await fs.writeFile(path.join(runDir, "run-summary.json"), JSON.stringify(summary, null, 2), "utf8");

  return {
    runDir,
    articlePath,
    htmlPath,
    payloadPath
  };
}
