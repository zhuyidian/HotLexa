export function buildDiagnostics(config) {
  const missing = [];
  const available = [];

  checkKey({ label: "openai.apiKey", value: config.secrets.openai?.apiKey, missing, available });
  checkKey({ label: "search.serperApiKey", value: config.secrets.search?.serperApiKey, missing, available });
  checkKey({ label: "search.youtubeApiKey", value: config.secrets.search?.youtubeApiKey, missing, available });
  checkKey({ label: "search.xBearerToken", value: config.secrets.search?.xBearerToken, missing, available });
  checkKey({ label: "wechat.appId", value: config.secrets.wechat?.appId, missing, available });
  checkKey({ label: "wechat.appSecret", value: config.secrets.wechat?.appSecret, missing, available });
  checkKey({
    label: "wechat.coverImageMediaId",
    value: config.secrets.wechat?.coverImageMediaId || config.defaults.wechat?.coverImageMediaId,
    missing,
    available
  });

  return {
    available,
    missing,
    canPolishWithAI: hasValue(config.secrets.openai?.apiKey),
    canSearchWithSerper: hasValue(config.secrets.search?.serperApiKey),
    canSearchYouTube: hasValue(config.secrets.search?.youtubeApiKey),
    canSearchX: hasValue(config.secrets.search?.xBearerToken),
    canCreateWechatDraft:
      hasValue(config.secrets.wechat?.appId) &&
      hasValue(config.secrets.wechat?.appSecret) &&
      hasValue(config.secrets.wechat?.coverImageMediaId || config.defaults.wechat?.coverImageMediaId)
  };
}

function checkKey({ label, value, missing, available }) {
  if (hasValue(value)) {
    available.push(label);
  } else {
    missing.push(label);
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
