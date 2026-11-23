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
                                                  ──► dist/<id>/<name>.<locale>.attachments.json (if any)
```

## Install

One line, interactive (install · update · reinstall · uninstall):

```bash
curl -fsSL https://jgermade.github.io/templaitor/setup.sh | sh
```

Or non-interactive: `curl -fsSL https://jgermade.github.io/templaitor/setup.sh | sh -s -- <action> [options]`.

| Method | What you get | Example |
|---|---|---|
| `binary` (default) | Self-contained bundle with its own Node.js (Linux/macOS, x64/arm64) in `<prefix>/lib/templaitor`, linked as `<prefix>/bin/templaitor` (`/usr/local` as root, `~/.local` otherwise) | `sh -s -- install` |
| `docker` | The hosted service (`templaitor serve`) as the `templaitor` container, data in the `templaitor-data` volume, config in `~/.config/templaitor/docker.env` (secret generated) | `sh -s -- install --method docker --port 3000` |
| `helm` | The hosted service on Kubernetes, chart `oci://ghcr.io/jgermade/charts/templaitor` | `sh -s -- install --method helm --namespace templaitor --values my-values.yml` |

Actions: `install` (does nothing if it is already installed) · `update` (only when there is a newer
release) · `reinstall` · `uninstall` (keeps data; `--purge` deletes the Docker volume / the Helm PVC and
Secret) · `status`. Options: `--version 0.2.0` (default: latest), `--prefix`, `--port`, `--namespace`,
`--values`, `-y` (no confirmations). Downloads are verified against the published SHA-256.

Without the script:

```bash
# binary: every release has templaitor-<linux|darwin>-<x64|arm64>.tar.gz (+ .sha256)
curl -fsSL https://github.com/jgermade/templaitor/releases/latest/download/templaitor-linux-x64.tar.gz | tar -xz
./templaitor/bin/templaitor --help

# Docker (hosted service)
docker run -d --name templaitor -p 3000:3000 -v templaitor-data:/data \
  -e TEMPLAITOR_SECRET="$(openssl rand -hex 32)" -e TEMPLAITOR_BASE_URL=http://localhost:3000 \
  ghcr.io/jgermade/templaitor:latest

# Helm (hosted service)
helm install templaitor oci://ghcr.io/jgermade/charts/templaitor -n templaitor --create-namespace \
  --set config.baseUrl=https://templaitor.example.com --set ingress.enabled=true \
  --set 'ingress.hosts[0].host=templaitor.example.com' --set 'ingress.hosts[0].paths[0].path=/' \
  --set 'ingress.hosts[0].paths[0].pathType=Prefix'
```

The binary bundle covers the CLI, the local editor and `templaitor serve`; PDFs still need an engine on the
machine (`pip install weasyprint`). The Docker image ships WeasyPrint. Helm chart values:
[`deploy/helm/templaitor/values.yaml`](deploy/helm/templaitor/values.yaml) — SQLite (default) runs one
replica with a `ReadWriteOnce` PVC; more replicas need `config.database.driver=postgres` and
`config.storage=db` (the chart refuses other combinations). `TEMPLAITOR_SECRET` is generated on install and
kept across upgrades; the PVC and the Secret survive `helm uninstall`.

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

## Email attachments

An email lists its attachments in the frontmatter. They can be **local** (a PDF template of the project,
rendered in the same language as the email) or **remote** (a URL):

```
---
layout: base.layout.mjml
attachments:
  - template: documents/invoice                      # local PDF template
    filename: "$t('invoice_file')"                   # optional (default: invoice.pdf)
    context: invoice                                 # optional: email variable used as the document's data
  - url: "https://example.com/terms-$lang.pdf"       # remote file
    filename: terms.pdf                              # optional (default: last segment of the URL)
  - documents/delivery-note                          # short forms: template id…
  - https://example.com/catalogue.pdf                # …or URL
---
```

- `$lang`, `$t()` and `$link{}` are resolved at compile time in `url` and `filename`; Jinja2 (`{{ }}`) is
  kept and rendered at runtime with the email's data.
- A local attachment is rendered with the locale of the email. If the document has no texts in that
  language it falls back to its first language (with a warning). Without `context`, the document is
  rendered with the whole email context; with `context: invoice`, with the email's `invoice` variable.
- `templaitor compile` writes `<name>.<locale>.attachments.json` for the backend: local entries point to the
  compiled document (`html`, `options` → its `.pdf.json`, relative to `outDir`) and remote ones carry the `url`.
- In the editor: **Attachments** under "Template" (add a local PDF or a remote file, file name, context),
  📎 chips in the subject bar to open each attachment rendered with the demo data, and **Send a test**
  attaches them (local PDFs rendered with the engine, remote files downloaded).
- Accessibility: local PDFs are rendered as PDF/UA-1 like any other document; remote files are not checked.

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
- **Versions** (top bar): save the current state of a template, component or layout as a **version** with a
  description, browse its versions (number, description, author, date), **compare** one with the draft or
  **restore** it into the draft (unsaved, so Undo reverts it and Save keeps it). Locally a version is a
  **git commit** of the document's own files (`.mjml`/`.yml`/`.json5`) — other changes you have staged are
  left alone, and commits made from the terminal show up as versions too. A project that is not in a
  repository gets a **Create a git repository** button (`git init`, a `.gitignore` for the compiled output
  and a first version of every document). In the hosted service: git commits in the organization's folder
  (`fs` storage, author = the signed-in user) or rows in the database (`db` storage).
- **Compare**: the current draft (B) against a base (A) — the **saved files**, a **version** of the
  document, or **another template** (component, layout). Each side has its own language (e.g. `es` ↔ `en`) and its
  own demo data (or the same data for both).
  - *Visual*: **side by side** (one scroll), **overlay** (opacity of B), **difference** (identical pixels
    are black, changes show in color) and **swipe**; desktop or mobile width.
  - *Code*: line diff of MJML, texts, demo data, the rendered text and the compiled HTML (Jinja2 kept),
    with the number of changed blocks per tab. The draft side is editable and **⇥ copies a chunk from A**
    into it (e.g. restore a text from the last commit).
  - A summary of what changed: subject, accessibility result, HTML size and attachments.
- Undo/redo, `Ctrl+S`, mobile view, compile and SMTP test sending. Dialogs are `<dialog>` modals.

Visual edits rewrite the MJML with a normalized format (2-space indentation).

## Brand

`assets/brand/`: `logo.svg` (color), `logo-mono.svg` (single ink, print), `favicon.svg` (simplified for
16–48 px) and PNG exports (`logo-128/256/512.png`, `favicon-32.png`, `logo-mono-256.png`). The SVGs only
use paths and linear gradients (no filters, masks or fonts), so they embed as vectors in PDFs; in emails
use the PNGs (Gmail/Outlook do not display SVG).

## Hosted service

templaitor can also run on a server as a multi-user service: `templaitor serve` (Node ≥ 22.13). The local
tools do not change: `templaitor editor`, `make up` and `compile` keep working as before (Node ≥ 20, no login).

- **Login** without passwords: a 6-digit **code by email** (10 min, 5 attempts) or a **passkey** (WebAuthn).
  Sessions are `HttpOnly` cookies; cross-site writes are rejected.
- **Organizations** with members and roles: `viewer` (reads and previews) · `editor` (edits, sends tests)
  · `admin` (members, SMTP, API keys) · `owner` (deletes the organization). Invitations by email; `signup:
  invite` only lets invited emails in. A new organization starts blank or from the demo project.
- **Editor per organization**: the same editor, working on the organization's project; an organization
  switcher and the settings (members, SMTP, API keys, send log, account and passkeys) are in the top bar.
- **Template storage** (configurable): `fs` — a project folder per organization (`dataDir/orgs/<slug>`), or
  an existing folder such as a git checkout (`storage.projects`) — or `db` — the files live in the database
  and are materialized into a cache for the engine. **Template versions** follow the storage: with `fs`
  each organization's folder is a git repository (created with the organization; the image includes git)
  and versions are commits authored by the signed-in user; with `db` they are stored in the database.
- **Sending service** with each organization's **SMTP** (SES, Postmark, Mailgun, Brevo, your own server…;
  the password is stored encrypted), a persistent **queue** with retries (30 s → 6 h, 6 attempts) and a
  **send log** (the HTML, text and attachments of sent messages are purged after `send.retentionDays`,
  30 by default; the metadata stays):

```bash
# hosted template + data (rendered in the requested language, with its attachments)
curl https://templaitor.example.com/v1/send -H "Authorization: Bearer tpl_…" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-A-1042" \
  -d '{"template": "orders/order-confirmation", "lang": "es", "to": "ada@example.com", "data": {"order_id": "A-1042"}}'
# raw HTML (your own rendering)
curl https://templaitor.example.com/v1/send -H "Authorization: Bearer tpl_…" -H "Content-Type: application/json" \
  -d '{"to": ["ada@example.com"], "subject": "Hi", "html": "<p>Hello</p>",
       "attachments": [{"filename": "a.pdf", "content": "<base64>"}, {"filename": "terms.pdf", "url": "https://…"}]}'
```

| Endpoint | |
|---|---|
| `POST /v1/send` | `template` + `lang` + `data` (hosted) or `subject` + `html` (+ `text`) (raw); `to`/`cc`/`bcc`, `replyTo`, `from` (same domain as the org's); `Idempotency-Key` header → `202 { id, status: "queued" }` |
| `POST /v1/render` | same body, returns `{ subject, html, text, attachments }` without sending |
| `GET /v1/messages/:id` | `queued` · `sending` · `sent` · `failed`, attempts, last error |
| `GET /v1/templates` | the organization's templates and languages |

- **Security**: PDFs are rendered in a **sandbox** (only `data:` URLs and the project's static files load:
  no `file:///…` of the server, no network); remote attachments can only reach public hosts (SSRF guard
  checked at connection time); API keys, codes and session tokens are stored as HMAC hashes; per-org rate
  limit on sends.

**Run it**: `make serve` (local trial; codes are printed in the terminal) or with Docker:

```bash
cp deploy/.env.example deploy/.env      # TEMPLAITOR_SECRET, TEMPLAITOR_BASE_URL, system SMTP…
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Put it behind a TLS reverse proxy (passkeys need HTTPS on the real domain). Configuration:
`templaitor.server.yml` (see `templaitor.server.example.yml`) or `TEMPLAITOR_*` environment variables. Back
up the data volume (SQLite database and organization projects). Plan: [`ROADMAP/2026-11-21/hosted-service.md`](ROADMAP/2026-11-21/hosted-service.md).

**Database**: SQLite (a file in the data volume) by default — one instance. **Postgres** for several
instances behind a load balancer: `TEMPLAITOR_DATABASE_URL=postgres://…` (or `database.url`), together with
`TEMPLAITOR_STORAGE=db` so the templates are not on one instance's disk. With Docker:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.postgres.yml --env-file deploy/.env up -d --build
```

Migrations run on start (an advisory lock serializes them between instances), the send queue is claimed
with `FOR UPDATE SKIP LOCKED` (no message is sent twice), and with `db` storage every instance re-reads the
templates another instance changed and stores its own changes before answering. The service tests run
against Postgres too when `TEMPLAITOR_TEST_POSTGRES_URL` points to a server (CI does it).

## Architecture

```
bin/templaitor.js          CLI (compile · pdf · validate · engines · editor · new · serve)
src/shared/                code shared by Node and the browser
  mjml-tree.js             MJML parser/serializer that keeps $ commands and Jinja2
  components.js            component catalog (attributes, valid nesting)
  imports.js               $import calls with parameters
  semantics.js             paragraph / heading semantics
  attachments.js           attachments frontmatter (normalized list)
src/engine/                compilation engine (ported from doomus-rs)
  pipeline.js              frontmatter → $import/layout → $ commands → guard → MJML → HTML/TXT
  design.js                design-mode annotation (node ids, editable regions, chips)
  a11y.js                  accessibility checker (WCAG 2.1 AA)
  pdf.js · verapdf.js      PDF engines and veraPDF validation
  attachments.js           email attachments (local PDF templates per language, remote files)
  versions.js · history.js template versions (list, read, save, init) · git version store
  commands.js · guard.js · resolver.js · render.js · project.js
src/server/server.js       editor HTTP API + static files (local editor; reused per org by the service)
src/service/               hosted service (templaitor serve)
  app.js                   routes: auth, organizations, org-scoped editor API, /v1 send API, editor SPA
  auth.js · mailer.js      email codes, passkeys (WebAuthn), sessions · service emails
  repo.js · db/            data access (portable SQL, async) · SQLite and Postgres adapters, migrations
  storage.js · workspaces.js   fs/db template storage · one project + editor handler per org
  sender.js · netguard.js  send queue and SMTP delivery · SSRF-safe fetch for remote attachments
  versions.js              version store in the database (db storage)
editor/                    Svelte 5 + Vite SPA (→ dist/editor)
  src/stores/editor.svelte.js   state: the source texts are the single source of truth
  src/lib/bridge.js             iframe script (selection, inline editing, serialization)
examples/demo/             demo project
```

## Website, CI and releases

- **Landing page**: `site/` (static, accessible: axe-core reports no WCAG violations on desktop and
  mobile). `make site` builds it into `dist/site`; `make screenshots` regenerates `site/screenshots/`
  from the demo project.
- **`build.yml`** (push to `main`, pull requests, manual, reusable): installs dependencies, installs
  WeasyPrint and veraPDF so the tests validate the demo PDF against PDF/UA-1, runs the tests, builds the
  editor, the site, the binary bundles (`scripts/build-binary.mjs`, smoke-tested: `version`, `compile`,
  `serve`) and the Helm chart (`helm lint` + render checks), and uploads two artifacts: `build` (npm package
  `.tgz`, editor `.zip`, `templaitor-<os>-<arch>.tar.gz` + `.sha256`, `templaitor-chart-<version>.tgz`) and
  `site`. A second job builds the Docker image and smoke-tests it (`/healthz`, a PDF with WeasyPrint).
- **`release.yml`** (manual, input `version`: `patch` · `minor` · `major`): computes the next version,
  runs `build.yml` with it, commits the version bump, tags `vX.Y.Z`, creates the GitHub release with the
  build attached, pushes the Docker image to `ghcr.io/jgermade/templaitor` (`X.Y.Z`, `X.Y`, `latest`;
  amd64 + arm64) and the chart to `oci://ghcr.io/jgermade/charts/templaitor`, and deploys the site
  (with `setup.sh`) to GitHub Pages.
  Requires *Settings → Pages → Source: GitHub Actions*, permission for the workflow to push the version
  commit and tag to the branch it runs on, and — after the first release — the `templaitor` and
  `charts/templaitor` packages set to **public** in GitHub (*Packages → Package settings*) so they can be
  pulled without logging in.
- **Local builds**: `make binary` (bundle for this machine, reusing the local Node), `make docker`,
  `make helm` (lint + package, needs `helm`).
- **`chart.yml`** (manual with a `version`, or called by `release.yml`): pushes the chart attached to that
  GitHub release to `oci://ghcr.io/jgermade/charts`. Helm is pinned to v3 (Helm 4's `helm push` fails
  against ghcr.io). Run it by hand to republish the chart of an existing release.
- **`pages.yml`** (manual, or called by `release.yml`): builds `site/` and deploys it to GitHub Pages,
  with upload and deployment in separate jobs. Run it on its own to redeploy the landing page.

Project plan: [`ROADMAP/`](ROADMAP/) · project memory: [`RECORD/`](RECORD/) · conventions: [`AGENTS.md`](AGENTS.md).

# Todos

- [ ] doomus-rs integration: replace `emails/_engine` with `templaitor compile` and read `*.subject.txt` in the backend.
- [ ] Floating format toolbar (bold, italic, link) for inline editing.
- [ ] Variable validation: warn about `{{ var }}` without demo data.
- [ ] Render the preview with minijinja (Rust) so it matches the runtime exactly.
- [x] Email attachments: local PDF templates (per language) and remote files.
- [ ] Template compare mode: code diff (MJML/YAML/data) and visual diff (side by side / overlay).
