import { matchAuthority } from "./authorityRegistry.js";
import { scoreAndSelectEvidence } from "./scorer.js";
import { compactText } from "../utils.js";

export function buildEvidencePackage({ query, registry, collected, planned, config = {} }) {
  const normalizedItems = collected.map((item, index) => {
    const normalized = normalizeEvidenceItem(item, index + 1);
    const authority = matchAuthority(normalized, registry);
    return {
      ...normalized,
      authority,
      assets: addPlannedScreenshotAssets(normalized, authority)
    };
  });
  const items = scoreAndSelectEvidence({ items: normalizedItems, query, config });

  return {
    version: 1,
    query,
    createdAt: new Date().toISOString(),
    mode: items.length > 0 ? "collected" : "planned",
    summary: summarize(items, planned),
    items,
    plannedItems: planned
  };
}

export function refreshEvidenceSummary(evidence, config = {}) {
  if (Array.isArray(evidence.items) && evidence.items.length > 0) {
    evidence.items = scoreAndSelectEvidence({ items: evidence.items, query: evidence.query || "", config });
  }
  evidence.summary = summarize(evidence.items || [], evidence.plannedItems || []);
  return evidence;
}

function normalizeEvidenceItem(item, index) {
  return {
    id: item.id || `ev-${String(index).padStart(3, "0")}`,
    status: item.status || "collected",
    platform: item.platform || "web",
    sourceName: item.sourceName || item.source || "",
    author: item.author || "",
    handle: item.handle || "",
    channelId: item.channelId || "",
    url: item.url || "",
    title: compactText(item.title || "", 180),
    publishedAt: item.publishedAt || "",
    summary: compactText(item.summary || item.description || "", 700),
    rawText: compactText(item.rawText || "", 2500),
    evidenceType: item.evidenceType || "report",
    metrics: item.metrics || {},
    assets: item.assets || []
  };
}

function addPlannedScreenshotAssets(item, authority) {
  const assets = [...(item.assets || [])];
  const needsScreenshot = ["youtube", "x", "bilibili"].includes(item.platform) && ["official", "authoritative", "high-signal"].includes(authority.level);
  if (needsScreenshot && item.url) {
    assets.push({
      type: "screenshot",
      status: "planned",
      purpose: authority.level === "high-signal" ? "capture high-signal account context for review" : "capture official or authoritative account context",
      targetUrl: item.url
    });
  }
  return assets;
}

function summarize(items, plannedItems) {
  const byPlatform = {};
  const byAuthority = {};
  const selectedByPlatform = {};
  const selectedByAuthority = {};
  for (const item of items) {
    byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
    byAuthority[item.authority.level] = (byAuthority[item.authority.level] || 0) + 1;
    if (item.selected) {
      selectedByPlatform[item.platform] = (selectedByPlatform[item.platform] || 0) + 1;
      selectedByAuthority[item.authority.level] = (selectedByAuthority[item.authority.level] || 0) + 1;
    }
  }
  return {
    collectedCount: items.length,
    selectedCount: items.filter((item) => item.selected).length,
    plannedCount: plannedItems.length,
    byPlatform,
    byAuthority,
    selectedByPlatform,
    selectedByAuthority,
    enrichedCount: items.filter((item) => item.enrichment?.status === "ok").length,
    screenshotTodoCount: items.reduce(
      (count, item) => count + item.assets.filter((asset) => asset.type === "screenshot" && asset.status === "planned").length,
      0
    ),
    capturedScreenshotCount: items.reduce(
      (count, item) => count + item.assets.filter((asset) => asset.type === "screenshot" && asset.status === "captured").length,
      0
    )
  };
}
