import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildBunCommand, formatCommand, formatSpawnError } from "../bunRunner.js";
import { projectRoot } from "../config.js";
import { pathExists, readJson, writeText } from "../utils.js";

export async function publishArticle({ articlePath, config, dryRun = true }) {
  const skillPath = path.resolve(projectRoot, config.wechat?.skillPath || ".agents/skills/baoyu-post-to-wechat");
  const scriptPath = path.join(skillPath, "scripts", "wechat-api.ts");
  if (!(await pathExists(scriptPath))) {
    return {
      ok: false,
      provider: "baoyu-post-to-wechat",
      dryRun,
      error: `Missing WeChat skill script: ${scriptPath}`
    };
  }

  const preferencesPath = await syncWechatSkillPreferences(config);

  const runtimeArgs = [
    scriptPath,
    articlePath,
    "--theme",
    config.wechat?.theme || "default"
  ];
  if (config.wechat?.color) runtimeArgs.push("--color", config.wechat.color);
  if (config.wechat?.author) runtimeArgs.push("--author", config.wechat.author);
  if (config.wechat?.alias) runtimeArgs.push("--account", config.wechat.alias);

  const autoCover = await resolveAutoCover(articlePath);
  if (autoCover?.cover) runtimeArgs.push("--cover", autoCover.cover);

  const command = buildBunCommand(runtimeArgs);

  const env = {
    ...process.env,
    WECHAT_APP_ID: config.wechat?.appId || process.env.WECHAT_APP_ID || "",
    WECHAT_APP_SECRET: config.wechat?.appSecret || process.env.WECHAT_APP_SECRET || ""
  };

  if (dryRun) {
    return {
      ok: true,
      provider: "baoyu-post-to-wechat",
      dryRun: true,
      input: articlePath,
      autoCover,
      preferencesPath,
      account: config.wechat?.alias || "",
      command: formatCommand(command),
      note: "Dry run only. The command is prepared but not executed."
    };
  }

  const result = spawnSync(command.bin, command.args, {
    cwd: projectRoot,
    env,
    encoding: "utf8"
  });

  return {
    ok: result.status === 0,
    provider: "baoyu-post-to-wechat",
    dryRun: false,
    input: articlePath,
    autoCover,
    preferencesPath,
    account: config.wechat?.alias || "",
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.status === 0 ? "" : formatSpawnError(result)
  };
}

async function syncWechatSkillPreferences(config) {
  const settings = config.wechat || {};
  const preferencesPath = path.join(projectRoot, ".baoyu-skills", "baoyu-post-to-wechat", "EXTEND.md");
  const accountName = settings.name || settings.author || "";
  const alias = settings.alias || "default";
  const needOpenComment = normalizeCommentFlag(settings.needOpenComment, 1);
  const onlyFansCanComment = normalizeCommentFlag(settings.onlyFansCanComment, 0);

  const lines = [
    "# Managed by HotLexa from config/local.secrets.json.",
    `default_theme: ${yamlString(settings.theme || "default")}`,
    `default_color: ${yamlString(settings.color || "")}`,
    "",
    "accounts:",
    `  - name: ${yamlString(accountName)}`,
    `    alias: ${yamlString(alias)}`,
    "    default: true",
    `    default_publish_method: ${yamlString(settings.publishMethod || "api")}`,
    `    default_author: ${yamlString(settings.author || accountName)}`,
    `    need_open_comment: ${needOpenComment}`,
    `    only_fans_can_comment: ${onlyFansCanComment}`
  ];

  if (settings.chromeProfilePath) {
    lines.push(`    chrome_profile_path: ${yamlString(settings.chromeProfilePath)}`);
  }

  await writeText(preferencesPath, `${lines.join("\n")}\n`);
  return preferencesPath;
}

function normalizeCommentFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

async function resolveAutoCover(articlePath) {
  const articleAbs = path.resolve(projectRoot, articlePath);
  const articleDir = path.dirname(articleAbs);
  const articleText = await readTextIfExists(articleAbs);

  if (hasFrontmatterCover(articleText)) return null;
  if (extractFirstMarkdownImage(articleText)) return null;

  const localCover = await findLocalCover(articleDir);
  if (localCover) {
    return {
      cover: localCover,
      source: "local cover file"
    };
  }

  const evidencePath = path.join(articleDir, "evidence.json");
  const evidence = await readJson(evidencePath, null);
  const evidenceCover = await findEvidenceCover(evidence);
  if (evidenceCover) return evidenceCover;

  return null;
}

async function findLocalCover(articleDir) {
  const candidates = [
    path.join(articleDir, "cover.png"),
    path.join(articleDir, "cover.jpg"),
    path.join(articleDir, "cover.jpeg"),
    path.join(articleDir, "cover.webp"),
    path.join(articleDir, "imgs", "cover.png"),
    path.join(articleDir, "imgs", "cover.jpg"),
    path.join(articleDir, "imgs", "cover.jpeg"),
    path.join(articleDir, "imgs", "cover.webp")
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return "";
}

async function findEvidenceCover(evidence) {
  const items = Array.isArray(evidence?.items) ? evidence.items : [];
  const selectedItems = items.filter((item) => item.selected);
  const candidates = selectedItems.length ? selectedItems : items;

  for (const item of [...candidates].sort(compareCoverPriority)) {
    const assetCover = findAssetCover(item);
    if (assetCover) {
      return {
        cover: assetCover,
        source: `evidence asset: ${item.id || item.title || item.url || "unknown"}`
      };
    }

    const markdownCover = await findEnrichedMarkdownCover(item);
    if (markdownCover) {
      return {
        cover: markdownCover,
        source: `enriched markdown cover: ${item.id || item.title || item.url || "unknown"}`
      };
    }

    const rawCover = extractFrontmatterField(item.rawText || "", ["coverImage", "featureImage", "cover", "image"]);
    if (rawCover) {
      return {
        cover: rawCover,
        source: `evidence raw cover: ${item.id || item.title || item.url || "unknown"}`
      };
    }

    const youtubeCover = buildYoutubeCoverUrl(item.url || "");
    if (youtubeCover) {
      return {
        cover: youtubeCover,
        source: `youtube thumbnail: ${item.id || item.title || item.url || "unknown"}`
      };
    }
  }

  return null;
}

function findAssetCover(item) {
  const assets = Array.isArray(item?.assets) ? item.assets : [];
  const image = assets.find((asset) => asset.type === "image" && asset.url);
  return image?.url || "";
}

async function findEnrichedMarkdownCover(item) {
  const markdownPath = item?.enrichment?.markdownPath;
  if (!markdownPath) return "";

  const resolvedPath = path.isAbsolute(markdownPath)
    ? markdownPath
    : path.resolve(projectRoot, markdownPath);
  const text = await readTextIfExists(resolvedPath);
  return extractFrontmatterField(text, ["coverImage", "featureImage", "cover", "image"]);
}

function compareCoverPriority(a, b) {
  return coverPriority(b) - coverPriority(a);
}

function coverPriority(item) {
  const authority = item?.authority?.level || "";
  const authorityScore = {
    official: 500,
    authoritative: 400,
    "known-source": 300,
    "high-signal": 250,
    "community-signal": 200,
    unverified: 100
  }[authority] || 0;

  const platformScore = item?.platform === "youtube" ? 20 : 0;
  const rankingScore = item?.ranking?.score || 0;
  const title = String(item?.title || "");
  const clickbaitPenalty = /\b(insane|killer|leaked|woah|crazy|shocking)\b/i.test(title) ? 80 : 0;

  return authorityScore + platformScore + rankingScore - clickbaitPenalty;
}

function hasFrontmatterCover(text) {
  return Boolean(extractFrontmatterField(text, ["coverImage", "featureImage", "cover", "image"]));
}

function extractFrontmatterField(text, fields) {
  if (!text) return "";
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) return "";

  for (const field of fields) {
    const regex = new RegExp(`^\\s*${escapeRegExp(field)}\\s*:\\s*(.+?)\\s*$`, "mi");
    const match = frontmatter.match(regex);
    const value = cleanYamlValue(match?.[1] || "");
    if (value) return value;
  }
  return "";
}

function extractFrontmatter(text) {
  const match = String(text || "").match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1] || "";
}

function extractFirstMarkdownImage(text) {
  const body = String(text || "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const match = body.match(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  return cleanYamlValue(match?.[1] || "");
}

function cleanYamlValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^<|>$/g, "")
    .trim();
}

function buildYoutubeCoverUrl(url) {
  const videoId = extractYoutubeVideoId(url);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";
}

function extractYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (host.endsWith("youtube.com")) return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
  return "";
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
