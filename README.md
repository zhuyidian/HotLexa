# HotLexa

HotLexa takes a word or sentence, gathers source material, drafts an article, formats it for WeChat Official Account, and prepares a draft-box payload.

Current MVP status:

- Keyless Bing RSS fallback search is implemented.
- Local generation is implemented.
- WeChat HTML formatting is implemented.
- Draft-box DryRun is implemented.
- Optional OpenAI polishing is implemented when `openai.apiKey` is configured.
- Optional X and YouTube API collectors are adapter-ready.
- Optional live WeChat draft creation is implemented when credentials and cover media id are configured.

## Quick Start

```powershell
node ./src/cli.js dryrun "AI 手机"
npm.cmd run wechat:dryrun -- "AI 手机"
```

The output is written under:

```text
.runs/hotlexa/YYYY-MM-DD/<topic-slug>/
```

Key files:

- `research.json`: collected or planned source material
- `article.md`: generated article draft
- `wechat-article.html`: WeChat-ready HTML
- `wechat-draft-payload.json`: payload that would be sent to WeChat
- `run-summary.json`: run metadata

`run-summary.json` includes a `diagnostics.missing` list for keys or IDs that are not configured.

## Configuration

Copy `config/local.secrets.example.json` to `config/local.secrets.json` when you are ready to connect external services.

Do not commit `config/local.secrets.json`.

## Pipeline

1. Input: receive one word or sentence.
2. Research: collect source candidates from mainstream sites and official sources.
3. Synthesis: choose an editorial angle and draft a structured article.
4. Formatting: render Markdown into WeChat-friendly HTML.
5. DryRun: generate the draft payload locally.
6. Publish: send to the WeChat draft box only after DryRun is verified.

## Research Sources

The research layer is source-registry driven. Edit `config/source-registry.json` to add or reprioritize sources.

Current source categories:

- `official`: government, regulator, company newsroom, product blog, paper/project source
- `cn-authority`: domestic authoritative media and public-sector platforms
- `cn-media`: domestic business and technology media
- `web`: mainstream international media
- `x`: X platform signals, posts, and attached media candidates
- `youtube`: videos, official channels, launches, interviews, and thumbnail candidates

Evidence rules:

- Official sources decide facts.
- Media reports provide context.
- X and YouTube are signal sources unless cross-confirmed.
- Images and thumbnails are collected as asset candidates and default to manual review.

Real provider keys go in `config/local.secrets.json`:

- `openai.apiKey`: AI polishing
- `search.serperApiKey`: web, official, domestic source site search
- `search.youtubeApiKey`: YouTube Data API
- `search.xBearerToken`: X API recent search
- `wechat.appId`: WeChat Official Account app id
- `wechat.appSecret`: WeChat Official Account app secret
- `wechat.coverImageMediaId`: existing WeChat permanent/temporary media id for the article cover

Without provider keys, HotLexa still runs a minimum closed loop by using Bing RSS fallback search, local article generation, WeChat HTML formatting, and draft payload DryRun.
