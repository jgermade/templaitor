# GitHub Pages: API reference and in-browser editor demo

Request: add to GitHub Pages `/api/` (documentation of every endpoint) and `/demo/` (the editor with its
backend running in the browser, e.g. IndexedDB).

## Decisions

- **`/api/`** is a hand-written static page (`site/api/index.html`), styled like the landing page. A test
  extracts every route from the code (editor route table, binary routes, `/preview`, `/static`, the hosted
  service's route list) and fails when one is missing from the page or the page lists one that no longer
  exists, so the reference cannot drift silently.
- **`/demo/`** runs the *real* engine, not a mock: the editor and `src/engine` are bundled with Vite
  (`vite.demo.config.js`) with Node built-ins replaced by shims — an in-memory `fs` persisted to IndexedDB,
  `path-browserify`, stubs for `child_process`/`os`/`module`/`url`/`http` — plus `mjml-browser` (same
  version as `mjml`) and nunjucks' browser build. `fetch('/api/…')` is intercepted and answered by the same
  route table as the server (`createRoutes`, extracted from `createHandler`).
- Versions in the demo: a store with the same interface as the git/db ones, kept in the virtual fs. Every
  document starts with a v1 so versions and compare work at once.
- What needs programs or the network answers `501` with an explanation: PDF rendering and veraPDF, sending
  email, remote attachments. Static images become `data:` URLs (the canvas iframe is sandboxed and Pages has
  no `/static/`); the shareable preview is `?preview=<id>` on the demo page.

```mermaid
gantt
  title GitHub Pages: /api/ and /demo/
  dateFormat YYYY-MM-DD
  section API reference
  Route inventory (server, service)          :done, a1, 2026-11-24, 1d
  site/api/index.html                        :done, a2, after a1, 1d
  Coverage test (routes ⇄ docs)              :done, a3, after a2, 1d
  section Demo
  createRoutes() extracted from the server   :done, d1, 2026-11-24, 1d
  Node shims + IndexedDB virtual fs          :done, d2, after d1, 1d
  Browser backend (fetch, versions, static)  :done, d3, after d2, 1d
  vite.demo.config.js, banner and reset      :done, d4, after d3, 1d
  section Site
  build-site, pages.yml, build.yml, Makefile :done, s1, after d4, 1d
  Landing links, README                      :done, s2, after s1, 1d
  section Later
  PDF in the demo (browser print)            :p1, after s2, 2d
```
