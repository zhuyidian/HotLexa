# Project-local agent skills

This project keeps third-party agent skills local to the repository under
`.agents/skills`.

Do not install project-specific skills globally with `npx skills add -g`.
Use plain `npx skills add <source>` from the project root so the skill is
copied into this folder.

Installed project-local skills:

- `baoyu-youtube-transcript`
- `baoyu-url-to-markdown`
- `baoyu-post-to-wechat`
- `baoyu-markdown-to-html`
- `humanizer`
