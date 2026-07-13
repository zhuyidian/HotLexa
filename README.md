# HotLexa

HotLexa 是一个面向公众号选题的权威信息采集与草稿生成工具。新版流程围绕四件事：

1. 从 YouTube 获取关键词/关键句相关视频、频道信息和 transcript。
2. 从 X 获取相关帖子、账号信息和互动指标。
3. 从 B站获取中文视频、官方号/权威号/高信号 UP 主相关信息。
4. 从官网、权威媒体或其它可信平台获取可引用来源。
5. 汇总成证据包和公众号草稿，再交给当前 Codex 润色，最后发送到公众号草稿箱。

## 当前流程

```bash
node ./src/cli.js run "AI 手机"
```

运行后会在 `.runs/<时间-关键词>/` 下生成：

- `evidence.json`：统一证据包，包含 YouTube、X、B站、Web 来源、权威等级和截图待办。
- `article.draft.md`：基于证据包生成的公众号初稿。
- `humanizer-request.md`：调用 `.agents/skills/humanizer` 进行人味化润色的说明。
- `codex-polish-request.md`：给当前 Codex 会话使用的润色说明。
- `article.draft.html`：由 `.agents/skills/baoyu-markdown-to-html` 生成的公众号 HTML。
- `run-summary.json`：本次运行摘要。

## 精读 URL

采集到 URL 后，可以继续补全文、thread、transcript 和媒体信息：

```bash
node ./src/cli.js enrich .runs/<run>/evidence.json
```

它会调用 `.agents/skills/baoyu-url-to-markdown`，把每条证据保存到 `.runs/<run>/enriched/`，并把结果写回 `evidence.json`。

YouTube 关键词搜索现在优先走 Serper，按官方频道、权威频道、高信号创作者三层搜索；`youtube.transcriptApiKey` 只作为兜底。Serper 搜到的 YouTube URL 会先进入证据包，后续 `enrich` 会优先用 `.agents/skills/baoyu-youtube-transcript` 抽 transcript 和视频元数据。

B站关键词搜索现在优先走 Serper，按官方号、权威号、高信号 UP 主三层搜索 `bilibili.com/video` 视频结果。B站结果默认更适合做中文传播、评测和讨论信号；只有明确匹配白名单账号时才升级为官方/权威/高信号。

先看计划、不真正抓取：

```bash
node ./src/cli.js enrich .runs/<run>/evidence.json --dry-run
```

## 截图取证

先 dry-run 查看截图任务：

```bash
node ./src/cli.js capture .runs/<run>/evidence.json --dry-run
```

确认后执行：

```bash
node ./src/cli.js capture .runs/<run>/evidence.json
```

截图会保存到 `.runs/<run>/assets/screenshots/`，并把截图资产状态写回 `evidence.json`。

如果 Chrome 没被自动找到，在 `config/local.secrets.json` 里设置：

```json
{
  "capture": {
    "chromePath": "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "chromeProfileDir": ""
  }
}
```

如果 X/YouTube 需要登录，建议使用单独的 Chrome profile 目录，不要直接占用正在运行的个人主 Profile。

## X 搜索与浏览器兜底

X 关键词搜索现在也优先走 Serper，按官方账号、权威账号、高信号个人账号三层搜索公开 `x.com/.../status/...` 帖子；`x.bearerToken` 只作为 X API 兜底。

当 Serper 没搜到公开帖子，或 X API 返回 402/403 等权限问题时，`evidence.json` 会保留 X 搜索链接。可以用浏览器登录态继续兜底：

```bash
node ./src/cli.js x-fallback .runs/<run>/evidence.json --dry-run
```

执行：

```bash
node ./src/cli.js x-fallback .runs/<run>/evidence.json
```

它会调用 `.agents/skills/baoyu-url-to-markdown` 打开 X 搜索页，尝试保存搜索页的 JSON/Markdown，并在 `evidence.json` 中创建一个可截图的 `x-browser-fallback` 证据项。随后继续执行：

```bash
node ./src/cli.js capture .runs/<run>/evidence.json
```

如果需要登录 X，在 `config/local.secrets.json` 中设置 `xBrowserFallback.chromeProfileDir`，或按打开的 Chrome 窗口完成登录。

## 公众号发布

准备公众号发布命令：

```bash
node ./src/cli.js run "AI 手机" --publish --dry-run
```

正式发布前使用：

```bash
node ./src/cli.js publish .runs/<run>/article.draft.md --live
```

## 配置位置

复制示例配置：

```bash
copy config\local.secrets.example.json config\local.secrets.json
```

然后在 `config/local.secrets.json` 填：

- `youtube.transcriptApiKey`：TranscriptAPI key，仅作为 YouTube 搜索和 transcript 的兜底。
- `x.bearerToken`：X API Bearer Token，仅作为 X recent search 的兜底。
- `web.serperApiKey`：Serper API key，用于官网/权威网页搜索、社区/趋势渠道搜索，也优先用于 YouTube 和 X 关键词搜索。
- `wechat.appId` / `wechat.appSecret`：微信公众号 API 发布用。
- `capture.chromePath`：本机 Chrome 路径，自动识别失败时再填。
- `capture.chromeProfileDir`：截图用 Chrome profile，可选。
- `enrich.chromeProfileDir`：baoyu-url-to-markdown 抓取登录页时使用的 Chrome profile，可选。
- `xBrowserFallback.chromeProfileDir`：X 浏览器兜底抓取时使用的 Chrome profile，可选。

不填 key 也能跑，但对应渠道会进入 `plannedItems`，表示“待采集”，不会伪造结果。

## 权威源白名单

`config/authority-registry.json` 维护 YouTube 官方频道、X 官方账号、B站账号、权威账号、官网域名、权威媒体域名，以及社区/趋势渠道。

这是初始白名单，后续可以按你的公众号定位继续校准。X/YouTube/B站 搜索按三层执行：

- `official`：官方账号/官方频道，优先作为主证据。
- `authoritative`：权威媒体或权威账号，作为强补充证据。
- `high-signal`：高流量个人账号/创作者，只作为热度和讨论信号，默认需要人工复核。

证据包里每条信息都会带 `authority.level`：

- `official`：官方来源。
- `authoritative`：权威媒体或权威账号。
- `high-signal`：高流量个人账号/创作者，只作为讨论信号，需要人工复核。
- `known-source`：有来源但未进入白名单。
- `community-signal`：社区/趋势渠道，只作为选题和讨论热度参考，需要人工复核。
- `unverified`：需要人工审核。

## 评分排序器

采集完成后会先保留全部证据，再给每条证据写入：

- `ranking.score`：综合推荐分。
- `ranking.reasons`：入选或降权原因。
- `selected`：是否进入公众号初稿。

第一版评分不依赖额外 API，主要看：

- 来源可信度：官方、权威、高信号、社区、普通来源。
- 关键词相关度：标题/摘要/正文是否命中关键词，且多词关键词不能只命中 `AI` 这类泛词。
- 时效性：越新的内容越加分。
- 传播信号：有播放、浏览、互动指标时加分；没有结构化指标时按平台给基础分。
- 可用性：有摘要、正文/transcript、缩略图或截图任务会加分。

默认配置在 `config/defaults.json` 的 `ranking` 下。文章初稿只使用 `selected=true` 的证据，但 `evidence.json` 会保留全部来源方便复查。

## Codex 润色方式

不再做 `--codex-polish` 这类命令。运行采集后，直接在当前 Codex 会话里说：

> 基于 `.runs/.../evidence.json` 和 `.runs/.../article.draft.md`，进行公众号润色。

项目会同时生成 `humanizer-request.md`，用于按 `.agents/skills/humanizer` 的规则减少 AI 腔。润色过程仍由当前 Codex 完成，也更容易人工判断语气和事实边界。

## 已接入的本地 skills

- `.agents/skills/baoyu-url-to-markdown`：精读 URL，支持 X/Twitter、YouTube transcript、普通网页和媒体。
- `.agents/skills/baoyu-youtube-transcript`：YouTube 单视频 transcript/字幕/封面提取，`enrich` 遇到 YouTube URL 时优先使用它。
- `.agents/skills/baoyu-post-to-wechat`：公众号草稿箱发布。
- `.agents/skills/baoyu-markdown-to-html`：`run` 阶段把 Markdown 初稿转成公众号兼容 HTML。
- `.agents/skills/humanizer`：`run` 阶段生成人味化润色请求，后续由当前 Codex 按该规则润色。
