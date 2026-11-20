<p align="center"><img src="assets/brand/logo.svg" width="112" alt="templaitor" /></p>

# templaitor

Generic **MJML → HTML/TXT with Jinja2** template editor, with a visual (WYSIWYG) editor, reusable
components and accessible PDF documents.

It started as the email engine of `doomus-rs` (`emails/_engine`) and generalizes it: any project with a
`templaitor.config.yml` can compile and edit its templates. The output is still Jinja2, ready to be
rendered at runtime (minijinja, Jinja2, Tera…).

```
template.mjml + template.yml (texts per language) ──► dist/<id>/<name>.<locale>.html
                                                  ──► dist/<id>/<name>.<locale>.txt
                                                  ──► dist/<id>/<name>.<locale>.subject.txt
```

## Quick start

```bash
make install           # (or `make i`) installs dependencies and builds the editor (dist/editor)
make up                # local development: editor + API on http://localhost:5180 (Mailpit under /mailpit/)
make down              # stops Mailpit
make test              # tests
make build             # builds the editor into dist/editor
```

`make up` opens `examples/demo` by default; for another project: `make up PROJECT=path/to/project`.

**Local Mailpit**: when Docker is available, `make up` starts [Mailpit](https://mailpit.axllent.org/) with
`docker compose` (SMTP on `localhost:1025`). Its inbox is published under **`/mailpit/`** of the editor
itself (http://localhost:5180/mailpit/), so with `GATE=...` it is also reachable at
`https://<gate>/mailpit/`. The editor **mailpit ➤** button sends the template rendered with the demo data;
the notification and the ↗ icon in the top bar open **that email** in Mailpit (or the inbox if nothing has
been sent yet). Without Docker it starts anyway (with a warning); `make up MAILPIT=0` disables it and
`make down` stops it. Ports: `MAILPIT_SMTP_PORT` / `MAILPIT_WEB_PORT`.

To expose it publicly with [intergate](https://jgermade.github.io/intergate/):

```bash
make up GATE=templaitor.gate.example.com
```

It opens an SSH tunnel (`ssh -p 2222 -R templaitor:80:localhost:5180 gate.example.com`) that reconnects
on its own, and allows that host in Vite. Your SSH key must be authorized for the subdomain in the
intergate dashboard. The SSH port defaults to 2222; set it in the host itself
(`GATE=templaitor.gate.example.com:2223`) or with `GATE_SSH_PORT`. Specific key: `GATE_KEY=~/.ssh/intergate`.
⚠ The editor has no authentication and can write project files: restrict access to the subdomain in
intergate unless you want it to be public.
Without `make`: `npm run dev` (development, :5180), `npm run editor` (prebuilt editor, :3333) and `npm run compile`.

In another project:

```bash
npx templaitor editor --cwd path/to/project     # visual editor
npx templaitor compile --cwd path/to/project    # compile (--watch, --strict)
npx templaitor new group/name --layout base.layout.mjml
```


# Project Specs

## Project layout

```
templaitor.config.yml
templates/
  _layouts/base.layout.mjml        # layouts with $content
  _components/footer/              # reusable components: $import(_components/footer)
    footer.mjml · footer.yml · footer.json5
  _shared/links.yml                # URLs for $link{...}
  _shared/logo.svg                 # static files (served at /static/ by the editor)
  customers/email-verification/
    email-verification.mjml        # template (optional frontmatter: layout)
    email-verification.yml         # subject + messages per language
    email-verification.json5       # demo data for the preview
dist/                              # compiled output
```

Folders starting with `_` are not templates. A template is a folder `x/` containing `x.mjml`.

## `templaitor.config.yml`

```yaml
name: My project
templates: templates     # templates root
outDir: dist
layouts: _layouts        # relative to templates
partials: _partials
components: _components  # reusable components
previewLayout: base.layout.mjml   # <mj-head> used to preview components (default: the first layout)
links: _shared/links.yml
static: _shared
locales:                 # language key in the .yml → locale ($lang and file names)
  es: es-ES
  en: en-US
output:
  text: true             # writes .txt
  subject: true          # writes .subject.txt
pdf:
  engine: auto           # weasyprint · prince · chromium · auto
smtp:                    # optional: editor "Send" button (e.g. Mailpit)
  host: localhost
  port: 1025
  from: noreply@example.com
  label: mailpit         # send button label
  web: /mailpit/         # web inbox (linked after sending; relative to the editor)
```

## `$` commands (compile time) and Jinja2 (runtime)

| Command | Description |
|---|---|
| `$import( path, key="value", … )` | Includes a partial or component (relative to `templates/`; `_components/x` = `_components/x/x.mjml`), with optional parameters |
| `$param.name` | (inside a component) the instance's parameter value or its default |
| `$lang` / `$country` | Current locale (`es-ES`) / country (`ES`) |
| `$if( expr ) … $else … $end` | Compile-time conditional (JS expression) |
| `$t('key')` | Text from `messages.<language>.key` (nested keys `a.b` supported) |
| `$link{ name, label: …, title: … }` | `<a>` with the URL from `links.yml` |

Resolution is recursive (a `$t` may contain other commands). Everything Jinja2 (`{{ }}`, `{% %}`,
`{# #}`) is protected from the MJML compiler and reaches the HTML, TXT and subject intact.
For Jinja2 blocks between sections use `<mj-raw>{% if … %}</mj-raw>`.

## Reusable components

A component is a folder `_components/<name>/` with `<name>.mjml` (an MJML fragment), `<name>.yml`
(`messages` per language) and `<name>.json5` (demo data). It is used with `$import(_components/<name>)`
in templates, layouts or other components.

- Its `$t` texts resolve with its own `.yml`; the template can **override** any key in its own.
- In the editor: the **Components** panel inserts them, shows how many templates use them and creates
  them; on the canvas every instance is selected as one block (◆) and **double-clicking** edits the
  component with the same WYSIWYG (with "← back" to the template). Changes apply to every template.
- **Parameters**: declared in the component frontmatter and used as `$param.name` in texts, buttons or
  attributes. Each instance sets them (or uses the default value):

  ```
  ---
  params:
    url: { type: text, label: Link, default: "#" }
    color: { type: color, label: Color, default: "#4F46E5" }
    align: { type: select, options: [left, center, right], default: center }
    label: $t('cta')          # short form: just the default value
    logo: { type: image, default: "{{ assets_url }}/logo.svg" }
    show_note: { type: boolean, default: false }
  ---
  <mj-section>
    <mj-column>
      <mj-button href="$param.url" background-color="$param.color" align="$param.align">$param.label</mj-button>
      $if($param.show_note)
      <mj-text>…</mj-text>
      $end
    </mj-column>
  </mj-section>
  ```

  ```
  $import(_components/cta-button, url="{{ app_url }}/verify?token={{ token }}", label="$t('cta')", color="#047857")
  ```

  Types: `text`, `color`, `select` (with `options`), `image` (a URL; in the editor: thumbnail, gallery of
  the `static` images and file upload, inserted as `{{ assets_url }}/file`, configurable with `assetsUrl`)
  and `boolean` (`true`/`false`, for `$if($param.x) … $end`; evaluated at compile time, so use
  `{% if %}` for runtime conditions).

  Values (in double or single quotes) accept Jinja2 and `$` commands. In the editor, the inspector of an
  instance shows a form with the declared parameters, and when editing the component the **Parameters**
  panel declares them and inserts `$param.x` as a chip in texts.
- **Turn selection into a component**: moves the selected block and its texts to a new component.
- **Detach**: replaces an instance with a copy editable only in that template.

## PDF documents

A template is a PDF document when its frontmatter has `format: pdf`. It uses the same things as emails
(MJML, `$t`, components, layouts and the WYSIWYG) plus page options:

```
---
format: pdf
layout: document.layout.mjml      # document layout: <mj-body width="680px"> (A4 with 15 mm margins)
pdf:
  engine: weasyprint              # optional: weasyprint · prince · chromium · auto
  size: A4                        # A4 · A5 · A3 · Letter · Legal
  orientation: portrait           # portrait · landscape
  margin: 15mm                    # or { top, right, bottom, left }
  header: ""                      # {page} {pages} {title}
  footer: "{page} / {pages}"
---
```

- `templaitor compile` writes `<name>.<locale>.html` (Jinja2 + `@page` paged-media CSS) and
  `<name>.<locale>.pdf.json` (engine, page and per-engine options) so the backend can render the PDF with
  its data at runtime. `compile --pdf` adds `<name>.<locale>.sample.pdf` with the demo data and
  `compile --validate` also validates them with veraPDF.
- `templaitor pdf group/name [--lang es] [--data data.json5] [-o out.pdf] [--engine weasyprint] [--validate]`
- `templaitor validate file.pdf [--flavour ua1]` validates any PDF; `templaitor engines` lists the
  installed engines and validator.
- In the editor: **PDF** view (the real PDF, re-rendered on edit, with an engine selector, download and a
  **Validate PDF/UA (veraPDF)** button), format and page options under "Template", a "Page break" block and
  the subject used as the document **title**.

### Rendering engines

The PDF HTML is the same for every engine: it uses standard paged-media CSS (`@page` with header and footer
in margin boxes, MJML columns outside `@media`). Choose it with `pdf.engine` in `templaitor.config.yml` or
in the template frontmatter (`auto` = the first installed one, in this order):

| Engine | PDF/UA-1 (veraPDF) | License | Install |
|---|---|---|---|
| **WeasyPrint** (recommended) | ✓ compliant (106 rules ✓, 0 ✕) | Free (BSD) | `pip install weasyprint` (≥ 58) |
| **Prince** | produces PDF/UA-1 (`--pdf-profile=PDF/UA-1`); not tested here | Commercial | princexml.com |
| **Chromium** (Playwright) | ✕ not compliant (4 rules: XMP metadata, untagged content, links) | Free | `npm i -D playwright && npx playwright install chromium` |

Results of validating the demo invoice with veraPDF 1.30 (PDF/UA-1 profile). **Since meeting the
accessibility regulations is the priority, WeasyPrint is the recommended engine**: free and compliant.
Prince is the commercial reference alternative. Chromium tags the PDF (structure, language, bookmarks) but
does not reach PDF/UA-1: use it only for quick previews or when no other engine is available.

### Validation with veraPDF

[veraPDF](https://verapdf.org) is the reference validator for PDF/UA and PDF/A. templaitor uses the
`verapdf` executable (or `TEMPLAITOR_VERAPDF=/path`) or, otherwise, Docker with the official image:
`make verapdf` pulls it and `make pdf-tools` checks engines and validator. Failing rules are shown with
their ISO 14289-1 clause and an explanation.

## Accessibility

Emails and PDFs are checked against **WCAG 2.1 AA / EN 301 549** (the standard required by the European
Accessibility Act) and PDFs are produced **tagged (PDF/UA)**: heading structure, tables and text
alternatives, language, title and bookmarks.

Every compile and preview checks: language (`lang`), title, heading structure, image text alternatives,
links without text or with vague text, data tables (`<th scope>`), color contrast (4.5:1, 3:1 for large
text) and minimum text size.

- In the editor, the **♿** indicator in the subject bar summarizes the status, and the **Preview** (and
  the PDF view) shows the full report: criterion by criterion, how to fix each issue, the heading outline,
  the inventory of images and links and every contrast pair.
- Texts have **Semantics** (Paragraph / Heading 1–3) in the inspector: it wraps the content in an `<hN>`
  that inherits the `mj-text` style, so adding structure does not change the design.
- `templaitor compile` prints the issues (`a11y-error` / `a11y-warn`) and fails with `--strict` if there are any.
- It is an automated check: also review the reading order and that the texts make sense.

## Layouts

A layout (`_layouts/<name>.mjml`) is a full MJML document with `$content` where each template goes (a
template picks it with `layout: <name>.mjml` in its frontmatter). In the editor they are opened from the
picker (**Layouts** section) or with ✎ next to the template's layout selector, and edited with the same
WYSIWYG: `$content` shows as a dashed slot that can be moved in "Structure". A layout has no texts or data
of its own, so the preview uses those of the first template using it (not saved with the layout) and its
`$t` texts are shown but not editable there. New layouts can be created and unused ones deleted.

## Visual editor

- **Design**: the canvas is the real HTML compiled by MJML. Click to select a block; type directly into
  texts and buttons. When the content is `$t('key')`, what you type goes to the `.yml` of the active
  language. Jinja2 variables and `$` commands show as non-editable *chips*; typing `{{ variable }}`
  creates a new one.
- **Interface**: template path (click to search/open templates, components and layouts), language flags,
  SMTP send button (e.g. *mailpit*) and a ↗ icon that opens Mailpit (the last sent email); in the subject
  bar, open the preview in a new tab and the `text` toggle. On the left, demo data (JSON5) and collapsible
  sections: Messages, Components, Blocks, Structure and Template. The inspector appears when a block is
  selected.
- **Structure**: block tree with drag and drop (validates where each component may go), move up/down,
  duplicate and delete. **Blocks**: palette of MJML components; new texts and buttons are translatable in
  every language from the start.
- **Inspector**: component attributes, translations in every language, key renaming, insertion of variables
  (from the demo data) and links.
- **Messages**: every key of the active language, add/remove keys and languages.
- **Preview / text**: rendered with the demo data (nunjucks, Jinja2 compatible) and the TXT version.
- **Code**: `.mjml`, `.yml`, `.json5`, layouts, partials and `links.yml` with a live preview.
- Undo/redo, `Ctrl+S`, mobile view, compile and SMTP test sending. Dialogs are `<dialog>` modals.

Visual edits rewrite the MJML with a normalized format (2-space indentation).

## Brand

`assets/brand/`: `logo.svg` (color), `logo-mono.svg` (single ink, print), `favicon.svg` (simplified for
16–48 px) and PNG exports (`logo-128/256/512.png`, `favicon-32.png`, `logo-mono-256.png`). The SVGs only
use paths and linear gradients (no filters, masks or fonts), so they embed as vectors in PDFs; in emails
use the PNGs (Gmail/Outlook do not display SVG).

## Architecture

```
bin/templaitor.js          CLI (compile · pdf · validate · engines · editor · new)
src/shared/                code shared by Node and the browser
  mjml-tree.js             MJML parser/serializer that keeps $ commands and Jinja2
  components.js            component catalog (attributes, valid nesting)
  imports.js               $import calls with parameters
  semantics.js             paragraph / heading semantics
src/engine/                compilation engine (ported from doomus-rs)
  pipeline.js              frontmatter → $import/layout → $ commands → guard → MJML → HTML/TXT
  design.js                design-mode annotation (node ids, editable regions, chips)
  a11y.js                  accessibility checker (WCAG 2.1 AA)
  pdf.js · verapdf.js      PDF engines and veraPDF validation
  commands.js · guard.js · resolver.js · render.js · project.js
src/server/server.js       editor HTTP API + static files
editor/                    Svelte 5 + Vite SPA (→ dist/editor)
  src/stores/editor.svelte.js   state: the source texts are the single source of truth
  src/lib/bridge.js             iframe script (selection, inline editing, serialization)
examples/demo/             demo project
```

Project plan: [`ROADMAP/`](ROADMAP/) · project memory: [`RECORD/`](RECORD/) · conventions: [`AGENTS.md`](AGENTS.md).

# Todos

- [ ] doomus-rs integration: replace `emails/_engine` with `templaitor compile` and read `*.subject.txt` in the backend.
- [ ] Floating format toolbar (bold, italic, link) for inline editing.
- [ ] Variable validation: warn about `{{ var }}` without demo data.
- [ ] Render the preview with minijinja (Rust) so it matches the runtime exactly.
- [ ] Attach a PDF (PDF template) to an email when sending a test.
- [ ] Template compare mode: code diff (MJML/YAML/data) and visual diff (side by side / overlay).
