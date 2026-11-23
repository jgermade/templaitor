# Template versions — 2026-11-23

Goal: a version system for templates (and components and layouts), also in the local editor, where versions
are git commits. Until now the compare view could read the git history, but versions could not be created or
restored from the editor, and the hosted service with `db` storage had no history at all.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| What a version is | A snapshot of **one document**: its `.mjml`, `.yml` and `.json5` (a layout: only its `.mjml`), with a description, author, date and a per-document number (v1, v2…) | Templates, components and layouts are edited and saved one by one; a component change is versioned as the component |
| Pluggable storage | `project.versionStore` with `info · list · read · save · init?`; façade in `src/engine/versions.js` | One editor API (`/api/versions`, `/api/version`) for every storage |
| Local mode | **git** store: a version is a commit of the document's files only (`git commit -- <files>`); commits from the terminal are versions too | Uses the repository the project already lives in; no hidden format; push/branch/review with normal git |
| Project without git | Button **Create a git repository**: `git init`, `.gitignore` for the compiled output, first commit "Initial version" | Opt-in: never creates a repository behind the user's back in local mode |
| Identity | The repository's `user.name`/`user.email`; when none is configured, `templaitor <templaitor@localhost>` as committer. Hosted: author = signed-in user | Commits must never fail because git has no identity |
| Hosted `fs` storage | The org folder is a git repository created with the org; a non-mapped folder must be its **own** repository (no fallback to a parent repository); mapped folders may be inside a larger checkout | Isolation between organizations |
| Hosted `db` storage | `versions` table (migration 2): files as JSON, SHA-256 of the contents to detect "no changes", numbers assigned in a transaction with a UNIQUE guard | No git there; works with several instances (Postgres) |
| Restore | Loads the version **into the draft** (unsaved, undoable); the user saves it | Never overwrites files without a review; undo works |
| Permissions | Viewers list, read and compare versions; editors save, restore and create the repository | Same rule as the rest of the editor API |

## Editor API

```
GET  /api/versions?id&kind           → { backend: git|db|null, available, canInit, branch?, dirty, versions: [{ id, rev, short, number, message, author, email, date }] }
GET  /api/version?id&kind&rev        → the document at a version ({ mjml, yml, data } + metadata)
POST /api/versions { id, kind, message }   → saves the saved files as a new version (409 when nothing changed)
POST /api/versions/init              → git init + first version (local / fs storage)
```

```mermaid
gantt
    title templaitor — template versions
    dateFormat YYYY-MM-DD
    axisFormat %d %b

    section Engine
    Version store interface + façade (versions.js)                     :v1, 2026-11-23, 1d
    git store: list, read, save (only the document), init, identity    :v2, 2026-11-23, 1d

    section Hosted service
    versions table (migration 2) + db store                             :s1, after v1, 1d
    fs storage: git repository per org, author = signed-in user         :s2, after v2, 1d
    git in the Docker image                                             :s3, after s2, 1d

    section Editor
    Versions dialog: save, list, compare, restore, create repository    :e1, after v2, 1d
    Compare view lists versions of every storage                        :e2, after e1, 1d

    section Later
    Send/render a pinned version from the API (/v1/send version)        :done, l1, after e2, 1d
    Compiled output per version / release tags                          :l2, after l1, 2d
```
