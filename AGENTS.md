## Project Documentation

Plans and specifications live in [ROADMAP/](ROADMAP/). Convention (same as doomus-rs):

- Name format: `YYYY-MM-DD_HHhMM.<summary>.plan.md` where `<summary>` is a kebab-case slug of the topic.
- Files can be **extended** (appended to the end) but existing content must never be deleted or modified. Extensions include date/time and a summary of the new content.
- For a new topic with no relation to previous ones: create a new file.
- When a plan is completed, create `YYYY-MM-DD_HHhMM.<summary>.result.md` with what was completed and what was not, and update `README.md` (`# Project Specs` and `# Todos` sections).

## Stack

- **Engine / CLI / server**: Node.js ≥ 20 (ESM), `mjml`, `yaml`, `json5`, `html-to-text`, `nunjucks` (preview only), plain `node:http`.
- **Editor**: Svelte 5 (runes) + Vite, CodeMirror 6. Source in `editor/src`, built to `dist/editor`.
- **Tests**: `node --test` (`npm test`).

## Conventions

- `src/shared/` must stay browser-safe (no Node imports): it is bundled into the editor.
- Compiled output must keep Jinja2 tokens intact (`{{ }}`, `{% %}`, `{# #}`).
- Editor state: the template source texts (`mjml`, `yml`, `data`) are the single source of truth; visual edits rewrite them.
- `editor/src/components` holds store-agnostic UI; `editor/src/views` holds store-connected panels; shared state in `editor/src/stores`.
