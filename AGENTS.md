# AGENTS.md

Guidelines for humans and AI agents working on **templaitor**. `CLAUDE.md` is a symlink to this file.

## Language

Everything in the repository is written in **English**: code, identifiers, comments, user-facing
strings (CLI, editor UI, error messages), tests and every `.md` file.
Exception: localized template content (the `messages`/`subject` of non-English locales, e.g. `es:`).

## Project plan — `ROADMAP/`

The plan lives in `ROADMAP/YYYY-MM-DD/` (the date the plan was written), as `.md` files.

- Each plan file includes a **Gantt diagram in Mermaid** (` ```mermaid gantt `) with its phases/tasks.
- One file per topic, kebab-case name: `ROADMAP/2026-11-20/project-plan.md`.
- A new planning session creates a new dated folder; earlier plans are kept as they were written.

## Project memory — `RECORD/`

`RECORD/YYYY-MM-DD.<summary>.(WIP|completed).md` is the project's memory: what was done, decisions
and their reasons, results, and what is pending. `<summary>` is a kebab-case slug.

- `*.WIP.md` — work in progress: **append-only**. Add new entries at the end (with time and a short
  title); never edit or delete existing content.
- `*.completed.md` — finished: **read-only**. Never modify it. To close a WIP record, rename it from
  `.WIP.md` to `.completed.md` (optionally appending a final summary first).
- Read the latest records before starting work; append to the active WIP record while working.

## Stack

- **Engine / CLI / server**: Node.js ≥ 20 (ESM), `mjml`, `yaml`, `json5`, `html-to-text`, `htmlparser2`,
  `nunjucks` (preview only), plain `node:http`.
- **Editor**: Svelte 5 (runes) + Vite, CodeMirror 6. Source in `editor/src`, built to `dist/editor`.
- **PDF**: pluggable engines (WeasyPrint — recommended, PDF/UA-1 —, Prince, Chromium via Playwright) and
  validation with veraPDF (binary or Docker `verapdf/cli`).
- **Tests**: `node --test` (`npm test` / `make test`).

## Conventions

- `src/index.js` is the public API of the npm package (`createEngine`): keep it stable; the hosted service and the
  library share `src/engine/message.js` for rendering a template for one recipient.
- `src/shared/` must stay browser-safe (no Node imports): it is bundled into the editor.
- Compiled output must keep Jinja2 tokens intact (`{{ }}`, `{% %}`, `{# #}`).
- Editor state: the template source texts (`mjml`, `yml`, `data`) are the single source of truth; visual
  edits rewrite them.
- `editor/src/components` holds store-agnostic UI; `editor/src/views` holds store-connected panels;
  shared state lives in `editor/src/stores`.
- No browser `alert`/`prompt`/`confirm`: use the `<dialog>` helpers in `editor/src/lib/dialogs.svelte.js`.
- Icons are **always SVG**: `editor/src/components/Icon.svelte` (add new ones to its set). Never text characters or
  emoji as icons (✓ ✕ ⚠ → ◆ 📎 …), never native checkboxes/radios (use `components/Checkbox.svelte`), and flags
  through `components/Flag.svelte` (SVG files from `country-flag-icons`).
- **Accessibility is a hard requirement**: emails and PDFs must meet WCAG 2.1 AA / EN 301 549, and PDFs
  must be PDF/UA-1 (validated with veraPDF). The demo templates and the repository's own templates (`templates/`,
  the ones it deploys and ships in the npm package) must pass the checker (there is a test).
