# Distribution: binary, Docker, Helm and one-line setup — 2026-11-21

Goal: templaitor can be deployed as a **self-contained binary**, a **Docker image** and a **Helm chart**,
and installed, updated, reinstalled or uninstalled with one line:
`curl -fsSL https://jgermade.github.io/templaitor/setup.sh | sh`.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Binary format | Per-platform archive `templaitor-<os>-<arch>.tar.gz`: app + production `node_modules` + prebuilt editor + the **official Node.js binary**, with a POSIX launcher (`bin/templaitor`) | The app reads files next to its sources (`dist/editor`, `examples/demo`, `assets`) and runs mjml with dynamic requires: a Node SEA single file would need a bundler and an asset layer for all of that. The archive needs nothing on the machine and keeps the code identical to npm/Docker |
| Targets | linux/darwin × x64/arm64 (glibc); Alpine/Windows → Docker or npm | No native modules (`node:sqlite` is built in, `pg` is pure JS), so the app tree is shared and only the Node binary changes per target |
| Asset names | Unversioned (`templaitor-linux-x64.tar.gz`) + `.sha256` | `releases/latest/download/<name>` works without the GitHub API (no rate limit) |
| Docker | Existing image published to `ghcr.io/jgermade/templaitor` (`X.Y.Z`, `X.Y`, `latest`, amd64 + arm64) | One registry with the repo's token |
| Helm | Chart in `deploy/helm/templaitor`, pushed as OCI to `ghcr.io/jgermade/charts` and attached to the release | No separate chart repository/index to maintain |
| Helm data safety | PVC and Secret with `helm.sh/resource-policy: keep`; the secret is generated once and reused (`lookup`) | `TEMPLAITOR_SECRET` must stay stable (it encrypts SMTP passwords); uninstall must not lose data by accident |
| Helm scaling | One replica + `Recreate` by default; `replicaCount > 1` requires Postgres + `storage: db` (template fails otherwise) | SQLite is single-instance (see the hosted-service record) |
| setup.sh | POSIX `sh`, hosted by GitHub Pages from `site/`, whole body inside `main()`; menu through `/dev/tty` when piped; `--method binary|docker|helm`; `uninstall` keeps data unless `--purge` | Works with `curl | sh` on Linux and macOS; a truncated download runs nothing |

```mermaid
gantt
    title templaitor — distribution
    dateFormat YYYY-MM-DD
    axisFormat %d %b

    section Packaging
    Binary bundle builder + launcher (`scripts/build-binary.mjs`)     :d1, 2026-11-21, 1d
    Helm chart (deployment, PVC, secret, ingress, tests)               :d2, 2026-11-21, 1d
    Docker image labels and smoke test                                  :d3, 2026-11-21, 1d

    section Installer
    `setup.sh`: install · update · reinstall · uninstall (binary/docker/helm) :i1, 2026-11-21, 1d
    Tests against a local release mirror                                :i2, after i1, 1d

    section CI / release
    build.yml: binaries, chart lint/package, Docker build + smoke tests :c1, after d1, 1d
    release.yml: GHCR image (multi-arch) and OCI chart                  :c2, after c1, 1d
    First release + packages made public                                :c3, after c2, 1d
