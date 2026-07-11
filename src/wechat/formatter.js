export function renderWechatHtml(article) {
  const lines = article.markdown.split(/\r?\n/);
  const body = lines.map(renderLine).join("\n");

  return [
    '<section style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; color: #1f2933; line-height: 1.75; font-size: 16px;">',
    body,
    "</section>"
  ].join("\n");
}

function renderLine(line) {
  if (!line.trim()) return '<p style="margin: 12px 0;"></p>';

  if (line.startsWith("# ")) {
    return `<h1 style="font-size: 24px; line-height: 1.35; margin: 0 0 20px; color: #101828;">${inline(line.slice(2))}</h1>`;
  }

  if (line.startsWith("## ")) {
    return `<h2 style="font-size: 19px; margin: 28px 0 12px; padding-left: 10px; border-left: 4px solid #0f766e; color: #102a43;">${inline(line.slice(3))}</h2>`;
  }

  if (line.startsWith("### ")) {
    return `<h3 style="font-size: 17px; margin: 22px 0 8px; color: #334e68;">${inline(line.slice(4))}</h3>`;
  }

  if (line.startsWith("> ")) {
    return `<blockquote style="margin: 16px 0; padding: 10px 14px; background: #f3f7f7; border-left: 4px solid #2f9e8f; color: #486581;">${inline(line.slice(2))}</blockquote>`;
  }

  if (/^\d+\.\s/.test(line)) {
    return `<p style="margin: 10px 0;">${inline(line)}</p>`;
  }

  return `<p style="margin: 14px 0;">${inline(line)}</p>`;
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #0f766e; text-decoration: none;">$1</a>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
