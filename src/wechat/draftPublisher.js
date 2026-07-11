export function prepareDraftPayload({ article, html, config, dryRun }) {
  const thumbMediaId = config.secrets.wechat?.coverImageMediaId || config.defaults.wechat?.coverImageMediaId || "";

  return {
    dryRun,
    credentialsSource: "config/local.secrets.json",
    articles: [
      {
        title: article.title,
        author: article.author,
        digest: article.digest,
        content: html,
        content_source_url: article.contentSourceUrl,
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0
      }
    ]
  };
}

export async function publishDraft({ payload, config, dryRun }) {
  if (dryRun || config.defaults.wechat?.dryRunOnlyByDefault !== false) {
    return {
      mode: "dry-run",
      articleCount: payload.articles.length,
      credentialsSource: payload.credentialsSource
    };
  }

  if (!config.secrets.wechat?.appId || !config.secrets.wechat?.appSecret) {
    throw new Error("Missing WeChat credentials in config/local.secrets.json");
  }

  if (!payload.articles[0]?.thumb_media_id) {
    throw new Error("Missing wechat.coverImageMediaId. WeChat draft creation requires a cover media id.");
  }

  const accessToken = await getAccessToken(config.secrets.wechat);
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      articles: payload.articles
    })
  });

  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new Error(`WeChat draft creation failed: ${JSON.stringify(data)}`);
  }

  return {
    mode: "live",
    mediaId: data.media_id,
    articleCount: payload.articles.length,
    credentialsSource: payload.credentialsSource
  };
}

async function getAccessToken(wechatConfig) {
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", wechatConfig.appId);
  url.searchParams.set("secret", wechatConfig.appSecret);

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new Error(`WeChat access token failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}
