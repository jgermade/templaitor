# Project plan — 2026-11-20

Goal: a generic template editor (originally the email engine of `doomus-rs`) that compiles MJML
templates to Jinja2 HTML/text, with a WYSIWYG editor, reusable components, PDF documents and
accessibility (WCAG 2.1 AA / EN 301 549 / PDF/UA-1) as a hard requirement.

```mermaid
gantt
    title templaitor
    dateFormat YYYY-MM-DD
    axisFormat %d %b

    section Engine
    Port doomus-rs engine (MJML, $ commands, Jinja2 guard)  :done, e1, 2026-11-20, 1d
    Project config, CLI (compile/editor/new)                :done, e2, 2026-11-20, 1d
    Reusable components + parameters                         :done, e3, 2026-11-20, 1d

    section Editor
    WYSIWYG canvas, outline, inspector, code view            :done, w1, 2026-11-20, 1d
    UI redesign, components, layouts editing                 :done, w2, 2026-11-20, 1d
    Mailpit integration, <dialog> modals, logo               :done, w3, 2026-11-20, 1d
    Template compare mode (code diff + visual diff)          :w4, 2026-11-23, 3d

    section PDF & accessibility
    PDF templates, pluggable engines                         :done, p1, 2026-11-20, 1d
    WCAG checker + accessibility report                      :done, p2, 2026-11-20, 1d
    veraPDF validation (PDF/UA-1)                            :done, p3, 2026-11-20, 1d
    Attach PDF templates to test emails                      :p4, after w4, 2d

    section Integration
    Repository conventions (English, ROADMAP, RECORD)        :active, i1, 2026-11-20, 1d
    Use templaitor in doomus-rs (compile + subject.txt)      :i2, after p4, 2d
    Preview rendered with minijinja (runtime parity)         :i3, after i2, 3d
```

## Upcoming work

1. **Template compare mode** — code diff (MJML/YAML/data) and visual diff (side by side / overlay)
   between two templates or two versions.
2. **PDF attachments** — attach a PDF template to a test email.
3. **doomus-rs integration** — replace `emails/_engine` with `templaitor compile` and read
   `*.subject.txt` in the backend.
4. **Runtime parity** — render the preview with minijinja (the runtime engine) instead of nunjucks.
