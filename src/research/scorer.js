const AUTHORITY_SCORES = {
  official: 100,
  authoritative: 80,
  "high-signal": 55,
  "community-signal": 35,
  "known-source": 30,
  unverified: 10
};

const DEFAULT_RANKING = {
  enabled: true,
  selectedLimit: 24,
  minScore: 35,
  minRelevanceScore: 20,
  platformMax: {
    youtube: 6,
    x: 4,
    bilibili: 5,
    web: 9
  },
  authorityMax: {
    official: 8,
    authoritative: 8,
    "high-signal": 6,
    "community-signal": 8,
    "known-source": 5,
    unverified: 3
  }
};

export function scoreAndSelectEvidence({ items, query, config = {} }) {
  const rankingConfig = mergeRankingConfig(config.ranking);
  if (rankingConfig.enabled === false) {
    return items.map((item, index) => ({
      ...item,
      selected: true,
      ranking: {
        score: 0,
        sourceOrder: index + 1,
        reasons: ["ranking disabled"]
      }
    }));
  }

  const scored = items.map((item, index) => {
    const ranking = scoreEvidenceItem({ item, query, sourceOrder: index + 1 });
    return {
      ...item,
      ranking,
      selected: false
    };
  });

  return selectEvidence(scored, rankingConfig);
}

function scoreEvidenceItem({ item, query, sourceOrder }) {
  const authority = scoreAuthority(item);
  const relevance = scoreRelevance(item, query);
  const freshness = scoreFreshness(item);
  const engagement = scoreEngagement(item);
  const usability = scoreUsability(item);

  const score = Math.round(
    authority.score * 0.45 +
      relevance.score * 0.2 +
      freshness.score * 0.15 +
      engagement.score * 0.1 +
      usability.score * 0.1
  );

  return {
    score,
    authorityScore: authority.score,
    relevanceScore: relevance.score,
    freshnessScore: freshness.score,
    engagementScore: engagement.score,
    usabilityScore: usability.score,
    sourceOrder,
    reasons: [
      authority.reason,
      relevance.reason,
      freshness.reason,
      engagement.reason,
      usability.reason
    ].filter(Boolean)
  };
}

function scoreAuthority(item) {
  const level = item.authority?.level || "unverified";
  const score = AUTHORITY_SCORES[level] ?? item.authority?.score ?? 10;
  return {
    score,
    reason: `authority:${level}`
  };
}

function scoreRelevance(item, query) {
  const queryParts = buildQueryParts(query);
  if (!queryParts.full) return { score: 0, reason: "empty query" };

  const title = normalizeText(item.title);
  const summary = normalizeText(item.summary);
  const rawText = normalizeText(item.rawText);
  const titleCompact = compactSearchText(item.title);
  const summaryCompact = compactSearchText(item.summary);
  const rawCompact = compactSearchText(item.rawText);

  if (title.includes(queryParts.full) || titleCompact.includes(queryParts.compact)) {
    return { score: 100, reason: "title exact match" };
  }
  if (summary.includes(queryParts.full) || summaryCompact.includes(queryParts.compact)) {
    return { score: 65, reason: "summary exact match" };
  }
  if (rawText.includes(queryParts.full) || rawCompact.includes(queryParts.compact)) {
    return { score: 50, reason: "body exact match" };
  }

  const titleMatches = countTokenMatches(title, titleCompact, queryParts.tokens);
  if (titleMatches === queryParts.tokens.length && titleMatches > 0) {
    return { score: 75, reason: "title token match" };
  }
  const importantTitleMatches = countTokenMatches(title, titleCompact, queryParts.importantTokens);
  if (importantTitleMatches > 0) {
    return { score: 55, reason: "title key token match" };
  }

  const summaryMatches = countTokenMatches(summary, summaryCompact, queryParts.tokens);
  if (summaryMatches === queryParts.tokens.length && summaryMatches > 0) {
    return { score: 50, reason: "summary token match" };
  }
  const importantSummaryMatches = countTokenMatches(summary, summaryCompact, queryParts.importantTokens);
  if (importantSummaryMatches > 0) {
    return { score: 35, reason: "summary key token match" };
  }
  if (titleMatches > 0 || summaryMatches > 0) {
    return { score: queryParts.tokens.length > 1 ? 10 : 45, reason: "generic token match" };
  }
  const rawMatches = countTokenMatches(rawText, rawCompact, queryParts.importantTokens);
  if (rawMatches > 0) {
    return { score: 25, reason: "body key token match" };
  }
  if (summaryMatches > 0) {
    return { score: 30, reason: "summary partial match" };
  }

  return { score: 0, reason: "weak keyword match" };
}

function scoreFreshness(item) {
  const date = parsePublishedAt(item.publishedAt);
  if (!date) return { score: 25, reason: "unknown publish time" };

  const ageDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (ageDays <= 7) return { score: 100, reason: "published within 7 days" };
  if (ageDays <= 30) return { score: 75, reason: "published within 30 days" };
  if (ageDays <= 90) return { score: 45, reason: "published within 90 days" };
  if (ageDays <= 365) return { score: 20, reason: "published within 1 year" };
  return { score: 5, reason: "older source" };
}

function scoreEngagement(item) {
  const metrics = item.metrics || {};
  const structured =
    numberValue(metrics.like_count) +
    numberValue(metrics.retweet_count) * 2 +
    numberValue(metrics.reply_count) +
    numberValue(metrics.quote_count) * 2 +
    numberValue(metrics.impression_count) * 0.02 +
    parseCountText(metrics.viewCountText) +
    parseCountText(metrics.viewCount) +
    parseCountText(item.summary) +
    parseCountText(item.title);

  if (structured > 0) {
    return {
      score: Math.min(100, Math.round(Math.log10(structured + 1) * 20)),
      reason: "has engagement signal"
    };
  }

  if (item.authority?.level === "high-signal") return { score: 55, reason: "high-signal source baseline" };
  if (item.authority?.level === "community-signal") return { score: 35, reason: "community signal baseline" };
  if (["youtube", "x", "bilibili"].includes(item.platform)) return { score: 30, reason: "social/video platform baseline" };
  return { score: 20, reason: "no engagement metric" };
}

function scoreUsability(item) {
  let score = 0;
  const reasons = [];

  if (item.url) {
    score += 15;
    reasons.push("has url");
  }
  if (item.summary) {
    score += 30;
    reasons.push("has summary");
  }
  if (item.rawText || item.enrichment?.status === "ok") {
    score += 35;
    reasons.push("has body or transcript");
  }
  if ((item.assets || []).some((asset) => asset.type === "image")) {
    score += 10;
    reasons.push("has thumbnail");
  }
  if ((item.assets || []).some((asset) => asset.type === "screenshot")) {
    score += 10;
    reasons.push("has screenshot task");
  }

  return {
    score: Math.min(100, score),
    reason: reasons.length ? reasons.join(", ") : "low extraction depth"
  };
}

function selectEvidence(items, rankingConfig) {
  const sorted = [...items].sort(compareRankedItems);
  const selectedIds = new Set();
  const platformCounts = {};
  const authorityCounts = {};
  const limit = rankingConfig.selectedLimit || sorted.length;
  const minScore = rankingConfig.minScore ?? 0;

  for (const item of sorted) {
    if (selectedIds.size >= limit) break;
    if (item.ranking.score < minScore) continue;
    if (item.ranking.relevanceScore < (rankingConfig.minRelevanceScore ?? 0)) continue;
    if (exceedsQuota(item.platform, platformCounts, rankingConfig.platformMax)) continue;
    if (exceedsQuota(item.authority?.level, authorityCounts, rankingConfig.authorityMax)) continue;

    selectedIds.add(item.id);
    platformCounts[item.platform] = (platformCounts[item.platform] || 0) + 1;
    const level = item.authority?.level || "unverified";
    authorityCounts[level] = (authorityCounts[level] || 0) + 1;
  }

  if (!selectedIds.size && sorted.length) {
    for (const item of sorted.slice(0, Math.min(limit, 8))) {
      selectedIds.add(item.id);
    }
  }

  return items.map((item) => {
    const selected = selectedIds.has(item.id);
    return {
      ...item,
      selected,
      ranking: {
        ...item.ranking,
        selectionReason: selected ? "selected by score and quota" : nonSelectionReason(item, rankingConfig)
      }
    };
  });
}

function compareRankedItems(a, b) {
  return (
    b.ranking.score - a.ranking.score ||
    b.ranking.authorityScore - a.ranking.authorityScore ||
    a.ranking.sourceOrder - b.ranking.sourceOrder
  );
}

function nonSelectionReason(item, rankingConfig) {
  if (item.ranking.score < (rankingConfig.minScore ?? 0)) return "below minimum score";
  if (item.ranking.relevanceScore < (rankingConfig.minRelevanceScore ?? 0)) return "below minimum relevance";
  return "lower ranked after platform and authority quotas";
}

function exceedsQuota(key, counts, quotas = {}) {
  if (!key || quotas[key] === undefined) return false;
  return (counts[key] || 0) >= quotas[key];
}

function buildQueryParts(query) {
  const full = normalizeText(query);
  const compact = compactSearchText(query);
  const tokens = String(query || "")
    .split(/[\s,，、|/]+/g)
    .map((token) => normalizeText(token))
    .filter(Boolean);
  if (!tokens.length && full) tokens.push(full);
  const importantTokens = tokens.filter((token) => !isGenericToken(token));
  return { full, compact, tokens, importantTokens: importantTokens.length ? importantTokens : tokens };
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function compactSearchText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function countTokenMatches(text, compact, tokens) {
  return tokens.filter((token) => text.includes(token) || compact.includes(token.replace(/\s+/g, ""))).length;
}

function isGenericToken(token) {
  return ["ai", "人工智能", "智能"].includes(token);
}

function parsePublishedAt(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const ago = text.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i);
  if (ago) {
    const amount = Number(ago[1]);
    const unit = ago[2].toLowerCase();
    const days =
      unit === "minute" ? amount / 1440 :
      unit === "hour" ? amount / 24 :
      unit === "day" ? amount :
      unit === "week" ? amount * 7 :
      unit === "month" ? amount * 30 :
      amount * 365;
    return new Date(Date.now() - days * 86400000);
  }

  const zhAgo = text.match(/(\d+)\s*(分钟|小时|天|周|个月|年)前/);
  if (zhAgo) {
    const amount = Number(zhAgo[1]);
    const unit = zhAgo[2];
    const days =
      unit === "分钟" ? amount / 1440 :
      unit === "小时" ? amount / 24 :
      unit === "天" ? amount :
      unit === "周" ? amount * 7 :
      unit === "个月" ? amount * 30 :
      amount * 365;
    return new Date(Date.now() - days * 86400000);
  }

  const dateMatch = text.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/);
  const normalized = dateMatch ? dateMatch[0].replace("年", "-").replace("月", "-").replace("日", "") : text;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function parseCountText(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value || "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*(万|亿|k|m)?\s*(次观看|播放|浏览|views?|likes?|comments?)/i);
  if (!match) return 0;
  let count = Number(match[1]);
  const unit = String(match[2] || "").toLowerCase();
  if (unit === "万") count *= 10000;
  if (unit === "亿") count *= 100000000;
  if (unit === "k") count *= 1000;
  if (unit === "m") count *= 1000000;
  return Number.isFinite(count) ? count : 0;
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function mergeRankingConfig(override = {}) {
  return {
    ...DEFAULT_RANKING,
    ...override,
    platformMax: {
      ...DEFAULT_RANKING.platformMax,
      ...(override.platformMax || {})
    },
    authorityMax: {
      ...DEFAULT_RANKING.authorityMax,
      ...(override.authorityMax || {})
    }
  };
}
