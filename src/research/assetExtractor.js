export function extractAssetCandidates(items) {
  return items.flatMap((item) => {
    const assets = item.assets || [];
    return assets.map((asset) => ({
      ...asset,
      sourceTitle: item.title,
      sourceUrl: item.url,
      platform: item.platform,
      sourceType: item.evidenceType,
      canAutoUse: asset.licenseStatus === "generated" || asset.licenseStatus === "official-press-approved"
    }));
  });
}

export function plannedAssetRules(queryPlan) {
  return queryPlan.tasks
    .filter((task) => task.platform === "official" || task.platform === "x" || task.platform === "youtube")
    .map((task) => ({
      sourceName: task.sourceName,
      platform: task.platform,
      query: task.query,
      licenseStatus: task.assetPolicy || "needs-review",
      canAutoUse: false
    }));
}
