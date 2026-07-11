const EVIDENCE_WEIGHT = {
  official: 30,
  report: 18,
  video: 10,
  "social-signal": 6
};

export function rankItems(items) {
  return [...items]
    .map((item) => ({
      ...item,
      scores: {
        authority: item.authorityScore || 0,
        freshness: freshnessScore(item.publishedAt),
        evidence: EVIDENCE_WEIGHT[item.evidenceType] || 0
      }
    }))
    .map((item) => ({
      ...item,
      score: item.scores.authority + item.scores.freshness + item.scores.evidence
    }))
    .sort((a, b) => b.score - a.score);
}

function freshnessScore(publishedAt) {
  if (!publishedAt) return 0;

  const ageMs = Date.now() - new Date(publishedAt).getTime();
  if (!Number.isFinite(ageMs)) return 0;

  const days = ageMs / 86400000;
  if (days <= 2) return 20;
  if (days <= 7) return 14;
  if (days <= 30) return 8;
  return 2;
}
