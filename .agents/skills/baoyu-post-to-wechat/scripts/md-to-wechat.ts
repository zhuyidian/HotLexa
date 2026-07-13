import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  cleanSummaryText,
  extractSummaryFromBody,
  extractTitleFromMarkdown,
  parseFrontmatter,
  preprocessMermaidInMarkdown,
  renderMarkdownDocument,
  replaceMarkdownImagesWithPlaceholders,
  resolveColorToken,
  resolveContentImages,
  serializeFrontmatter,
  stripWrappingQuotes,
} from "baoyu-md";
import { closeRenderer, renderMermaidToPng } from "baoyu-chrome-cdp/mermaid";

interface ImageInfo {
  placeholder: string;
  localPath: string;
  originalPath: string;
  alt?: string;
}

interface ParsedResult {
  title: string;
  author: string;
  summary: string;
  htmlPath: string;
  contentImages: ImageInfo[];
}

function getInlineStyleValue(style: string, property: string): string {
  const target = property.toLowerCase();
  for (const part of style.split(";")) {
    const colonIndex = part.indexOf(":");
    if (colonIndex < 0) continue;
    const key = part.slice(0, colonIndex).trim().toLowerCase();
    if (key === target) return part.slice(colonIndex + 1).trim();
  }
  return "";
}

function flattenContainerStyle(style: string): string {
  const removedProperties = new Set([
    "background",
    "background-color",
    "border",
    "border-radius",
    "box-shadow",
  ]);
  const parts: string[] = [];

  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex < 0) continue;

    const property = trimmed.slice(0, colonIndex).trim().toLowerCase();
    if (removedProperties.has(property)) continue;
    parts.push(trimmed);
  }

  parts.push(
    "background: transparent",
    "background-color: transparent",
    "border: none",
    "border-radius: 0",
    "box-shadow: none",
  );

  return parts.join("; ");
}

function flattenArticleContainer(html: string): string {
  return html.replace(/<section\b([^>]*)>/gi, (match, attrs: string) => {
    const classMatch = attrs.match(/\bclass\s*=\s*(["'])(.*?)\1/i);
    if (!classMatch) return match;

    const classes = classMatch[2]!.split(/\s+/).filter(Boolean);
    if (!classes.includes("container")) return match;

    const styleMatch = attrs.match(/\bstyle\s*=\s*(["'])(.*?)\1/i);
    const style = flattenContainerStyle(styleMatch?.[2] ?? "");
    if (styleMatch) {
      return `<section${attrs.replace(styleMatch[0], `style="${style}"`)}>`;
    }

    return `<section${attrs} style="${style}">`;
  });
}

function enhanceMajorHeadings(html: string): string {
  return html.replace(
    /<h2\b([^>]*)style="([^"]*)"([^>]*)>([\s\S]*?)<\/h2>/gi,
    (_match, beforeStyle, style, afterStyle, content) => {
      const color = getInlineStyleValue(style, "color") || "#0F4C81";
      const border = getInlineStyleValue(style, "border-bottom") || `3px solid ${color}`;
      const fontSize = getInlineStyleValue(style, "font-size") || "20px";

      const headingStyle = [
        "display: block",
        "width: 100%",
        "margin: 32px auto 24px",
        "padding: 0",
        "text-align: center",
        "line-height: 1.7",
        "border-bottom: none",
      ].join("; ");
      const labelStyle = [
        "display: inline-block",
        "max-width: 100%",
        "box-sizing: border-box",
        "padding: 0 0.85em 0.18em",
        `color: ${color}`,
        `font-size: ${fontSize}`,
        "font-weight: bold",
        "line-height: 1.6",
        "letter-spacing: 0.04em",
        `border-bottom: ${border}`,
      ].join("; ");

      return `<h2${beforeStyle}style="${headingStyle}"${afterStyle}><span style="${labelStyle}">${content}</span></h2>`;
    },
  );
}

export async function convertMarkdown(
  markdownPath: string,
  options?: { title?: string; theme?: string; color?: string; citeStatus?: boolean },
): Promise<ParsedResult> {
  const baseDir = path.dirname(markdownPath);
  const content = fs.readFileSync(markdownPath, "utf-8");
  const citeStatus = options?.citeStatus ?? true;

  const { frontmatter, body } = parseFrontmatter(content);

  let title = stripWrappingQuotes(options?.title ?? "")
    || stripWrappingQuotes(frontmatter.title ?? "")
    || extractTitleFromMarkdown(body);
  if (!title) {
    title = path.basename(markdownPath, path.extname(markdownPath));
  }

  const author = stripWrappingQuotes(frontmatter.author ?? "");
  const frontmatterSummary = stripWrappingQuotes(frontmatter.description ?? "")
    || stripWrappingQuotes(frontmatter.summary ?? "");
  let summary = cleanSummaryText(frontmatterSummary);
  if (!summary) {
    summary = extractSummaryFromBody(body, 120);
  }

  const { markdown: mermaidProcessedBody, images: mermaidImages } =
    await preprocessMermaidInMarkdown(body, {
      baseDir,
      renderFn: renderMermaidToPng,
      onError: (error, block) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[md-to-wechat] mermaid render failed (${block.code.slice(0, 40).replace(/\s+/g, " ")}…): ${message}`,
        );
      },
    });

  if (mermaidImages.length > 0) {
    const fresh = mermaidImages.filter((image) => !image.cached).length;
    console.error(
      `[md-to-wechat] mermaid: ${mermaidImages.length} block(s), ${fresh} rendered, ${mermaidImages.length - fresh} cached`,
    );
  }

  const { images, markdown: rewrittenBody } = replaceMarkdownImagesWithPlaceholders(
    mermaidProcessedBody,
    "WECHATIMGPH_",
  );
  const rewrittenMarkdown = `${serializeFrontmatter(frontmatter)}${rewrittenBody}`;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-article-images-"));
  const htmlPath = path.join(tempDir, "temp-article.html");

  console.error(
    `[md-to-wechat] Rendering markdown with theme: ${options?.theme ?? "default"}${options?.color ? `, color: ${options.color}` : ""}, citeStatus: ${citeStatus}`,
  );

  const { html } = await renderMarkdownDocument(rewrittenMarkdown, {
    citeStatus,
    defaultTitle: title,
    keepTitle: false,
    primaryColor: resolveColorToken(options?.color),
    theme: options?.theme,
  });
  fs.writeFileSync(htmlPath, flattenArticleContainer(enhanceMajorHeadings(html)), "utf-8");

  const contentImages = await resolveContentImages(images, baseDir, tempDir, "md-to-wechat");

  return {
    title,
    author,
    summary,
    htmlPath,
    contentImages,
  };
}

function printUsage(): never {
  console.log(`Convert Markdown to WeChat-ready HTML with image placeholders

Usage:
  npx -y bun md-to-wechat.ts <markdown_file> [options]

Options:
  --title <title>     Override title
  --theme <name>      Theme name (default, grace, simple, modern)
  --color <name|hex>  Primary color (blue, green, vermilion, etc. or hex)
  --no-cite           Disable bottom citations for ordinary external links
  --help              Show this help

Output JSON format:
{
  "title": "Article Title",
  "htmlPath": "/tmp/wechat-article-images/temp-article.html",
  "contentImages": [
    {
      "placeholder": "WECHATIMGPH_1",
      "localPath": "/tmp/wechat-image/img.png",
      "originalPath": "imgs/image.png"
    }
  ]
}

Example:
  npx -y bun md-to-wechat.ts article.md
  npx -y bun md-to-wechat.ts article.md --theme grace
  npx -y bun md-to-wechat.ts article.md --theme modern --color blue
  npx -y bun md-to-wechat.ts article.md --no-cite
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
  }

  let markdownPath: string | undefined;
  let title: string | undefined;
  let theme: string | undefined;
  let color: string | undefined;
  let citeStatus = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--title" && args[i + 1]) {
      title = args[++i];
    } else if (arg === "--theme" && args[i + 1]) {
      theme = args[++i];
    } else if (arg === "--color" && args[i + 1]) {
      color = args[++i];
    } else if (arg === "--cite") {
      citeStatus = true;
    } else if (arg === "--no-cite") {
      citeStatus = false;
    } else if (!arg.startsWith("-")) {
      markdownPath = arg;
    }
  }

  if (!markdownPath) {
    console.error("Error: Markdown file path is required");
    process.exit(1);
  }

  if (!fs.existsSync(markdownPath)) {
    console.error(`Error: File not found: ${markdownPath}`);
    process.exit(1);
  }

  const result = await convertMarkdown(markdownPath, { title, theme, color, citeStatus });
  console.log(JSON.stringify(result, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closeRenderer();
}
