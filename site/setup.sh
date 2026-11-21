#!/bin/sh
# templaitor setup — install, update, reinstall or uninstall templaitor.
#
#   curl -fsSL https://jgermade.github.io/templaitor/setup.sh | sh                 # interactive menu
#   curl -fsSL https://jgermade.github.io/templaitor/setup.sh | sh -s -- install   # non-interactive
#
# Usage: setup.sh [install|update|reinstall|uninstall|status] [options]
#
# Methods (--method):
#   binary  (default) self-contained bundle with its own Node.js runtime, linked into <prefix>/bin
#   docker  the hosted service (templaitor serve) as a container with a persistent volume
#   helm    the hosted service on Kubernetes (Helm chart from oci://ghcr.io/jgermade/charts)
#
# Options:
#   --method <m>        binary · docker · helm
#   --version <v>       release to install (e.g. 0.2.0); default: latest
#   --prefix <dir>      binary: install prefix (default: /usr/local as root, ~/.local otherwise)
#   --port <n>          docker: host port (default: 3000)
#   --namespace <ns>    helm: namespace (default: templaitor)
#   --values <file>     helm: extra values file
#   --purge             uninstall: also delete data (docker volume / helm PVC and secret)
#   -y, --yes           do not ask for confirmation
#   -h, --help          this help
#
# Environment: TEMPLAITOR_METHOD, TEMPLAITOR_VERSION, TEMPLAITOR_PREFIX, TEMPLAITOR_PORT, TEMPLAITOR_BASE_URL,
# TEMPLAITOR_NAMESPACE, TEMPLAITOR_DOWNLOAD_URL (release mirror), TEMPLAITOR_IMAGE, TEMPLAITOR_CHART.
#
# Everything runs inside main() at the end, so a partially downloaded script does nothing.

set -eu

REPO_URL="https://github.com/jgermade/templaitor"
DOWNLOAD_URL="${TEMPLAITOR_DOWNLOAD_URL:-$REPO_URL/releases}"
IMAGE="${TEMPLAITOR_IMAGE:-ghcr.io/jgermade/templaitor}"
CHART="${TEMPLAITOR_CHART:-oci://ghcr.io/jgermade/charts/templaitor}"
NAME="templaitor"

ACTION=""
METHOD="${TEMPLAITOR_METHOD:-}"
VERSION="${TEMPLAITOR_VERSION:-}"
PREFIX="${TEMPLAITOR_PREFIX:-}"
PORT="${TEMPLAITOR_PORT:-}"
NAMESPACE="${TEMPLAITOR_NAMESPACE:-templaitor}"
VALUES=""
PURGE=0
YES=0
TMP=""

# ── output ────────────────────────────────────────────────────────────────────
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  B="$(printf '\033[1m')"; G="$(printf '\033[32m')"; Y="$(printf '\033[33m')"; R="$(printf '\033[31m')"; D="$(printf '\033[2m')"; X="$(printf '\033[0m')"
else
  B=""; G=""; Y=""; R=""; D=""; X=""
fi
say()  { printf '%s\n' "$*" >&2; }
info() { say "${B}→${X} $*"; }
ok()   { say "${G}✓${X} $*"; }
warn() { say "${Y}⚠${X} $*"; }
die()  { say "${R}✗${X} $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required${2:+: $2}"; }

usage() {
  if [ -f "$0" ] && grep -q '^# templaitor setup' "$0" 2>/dev/null; then
    sed -n '2,/^# Everything/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^Everything/d'
    return
  fi
  echo "Usage: setup.sh [install|update|reinstall|uninstall|status] [--method binary|docker|helm] [--version v] [--purge] [-y]"
}

cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; return 0; }

# Reads an answer from the terminal, also when the script itself comes from a pipe (curl | sh).
has_tty() { [ -r /dev/tty ] && (: < /dev/tty) 2>/dev/null; }
ask() { # ask "question" default → answer
  if [ "$YES" = 1 ] || ! has_tty; then printf '%s' "$2"; return; fi
  printf '%s ' "$1" > /dev/tty
  read -r answer < /dev/tty || answer=""
  printf '%s' "${answer:-$2}"
}
confirm() { # confirm "question" → 0 when yes
  [ "$YES" = 1 ] && return 0
  has_tty || die "Confirmation needed: run again with --yes"
  case "$(ask "$1 [y/N]" n)" in y|Y|yes|YES|s|S|si|sí) return 0 ;; *) return 1 ;; esac
}

strip_v() { printf '%s' "${1#v}"; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else printf ''; fi
}

download() { # download url file
  curl -fsSL --retry 3 -o "$2" "$1" || die "Download failed: $1"
}

# Latest release tag through the /releases/latest redirect (no API, no rate limit). Empty when unknown.
latest_version() {
  url="$(curl -fsSIL -o /dev/null -w '%{url_effective}' "$DOWNLOAD_URL/latest" 2>/dev/null || true)"
  case "$url" in */tag/*) strip_v "${url##*/tag/}" ;; *) printf '' ;; esac
}

# ── binary ────────────────────────────────────────────────────────────────────
bin_prefix() {
  if [ -n "$PREFIX" ]; then printf '%s' "$PREFIX"
  elif [ "$(id -u)" = 0 ]; then printf '/usr/local'
  else printf '%s/.local' "$HOME"; fi
}
bin_home() { printf '%s/lib/templaitor' "$(bin_prefix)"; }
bin_link() { printf '%s/bin/templaitor' "$(bin_prefix)"; }
bin_installed() { [ -x "$(bin_home)/bin/templaitor" ]; }
bin_current() { cat "$(bin_home)/VERSION" 2>/dev/null || printf ''; }

bin_target() {
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) die "No binary for $(uname -s): use --method docker (or npx templaitor)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "No binary for $(uname -m): use --method docker" ;;
  esac
  if [ "$os" = linux ] && [ -f /etc/alpine-release ]; then
    die "The binary needs glibc (Alpine uses musl): use --method docker"
  fi
  printf '%s-%s' "$os" "$arch"
}

bin_url() { # bin_url file
  if [ -n "$VERSION" ]; then printf '%s/download/v%s/%s' "$DOWNLOAD_URL" "$(strip_v "$VERSION")" "$1"
  else printf '%s/latest/download/%s' "$DOWNLOAD_URL" "$1"; fi
}

# Downloads, verifies and extracts the bundle into $TMP/templaitor
bin_fetch() {
  need curl; need tar
  file="templaitor-$(bin_target).tar.gz"
  TMP="$(mktemp -d)"
  info "Downloading $file${VERSION:+ (v$(strip_v "$VERSION"))}"
  download "$(bin_url "$file")" "$TMP/$file"
  if curl -fsSL -o "$TMP/$file.sha256" "$(bin_url "$file.sha256")" 2>/dev/null; then
    expected="$(cut -d' ' -f1 < "$TMP/$file.sha256")"
    actual="$(sha256 "$TMP/$file")"
    if [ -z "$actual" ]; then warn "sha256sum/shasum not found: checksum not verified"
    elif [ "$expected" != "$actual" ]; then die "Checksum mismatch for $file"
    else ok "Checksum verified"; fi
  else
    warn "No checksum published for $file: not verified"
  fi
  tar -xzf "$TMP/$file" -C "$TMP"
  [ -x "$TMP/templaitor/bin/templaitor" ] || die "Unexpected archive layout"
}

bin_place() {
  home="$(bin_home)"; link="$(bin_link)"
  mkdir -p "$(dirname "$home")" "$(dirname "$link")" || die "Cannot write to $(bin_prefix) (try --prefix or sudo)"
  rm -rf "$home.new"
  mv "$TMP/templaitor" "$home.new"
  rm -rf "$home.old"
  [ -d "$home" ] && mv "$home" "$home.old"
  mv "$home.new" "$home"
  ln -sf "$home/bin/templaitor" "$link"
  if ! "$link" version >/dev/null 2>&1; then
    rm -rf "$home"
    if [ -d "$home.old" ]; then mv "$home.old" "$home"; die "The new binary does not run: previous version restored"; fi
    rm -f "$link"
    die "The downloaded binary does not run on this system"
  fi
  rm -rf "$home.old"
  ok "templaitor $(bin_current) → $link"
  case ":$PATH:" in
    *":$(dirname "$link"):"*) ;;
    *) warn "$(dirname "$link") is not in your PATH. Add it, e.g.: echo 'export PATH=\"$(dirname "$link"):\$PATH\"' >> ~/.profile" ;;
  esac
  command -v weasyprint >/dev/null 2>&1 || say "${D}  Accessible PDFs (PDF/UA-1) need WeasyPrint: pip install weasyprint${X}"
}

bin_install() {
  if bin_installed; then
    ok "templaitor $(bin_current) is already installed in $(bin_home)"
    say "  Use ${B}update${X} or ${B}reinstall${X}."
    return
  fi
  bin_fetch; bin_place
  say "  Try: templaitor --help · templaitor editor --cwd path/to/project"
}

bin_update() {
  bin_installed || { warn "templaitor is not installed: installing"; bin_install; return; }
  current="$(bin_current)"
  wanted="$(strip_v "${VERSION:-$(latest_version)}")"
  if [ -n "$wanted" ] && [ "$wanted" = "$current" ]; then ok "templaitor $current is up to date"; return; fi
  bin_fetch
  new="$(cat "$TMP/templaitor/VERSION")"
  if [ "$new" = "$current" ]; then ok "templaitor $current is up to date"; return; fi
  info "Updating $current → $new"
  bin_place
}

bin_reinstall() {
  bin_fetch
  bin_installed && info "Replacing templaitor $(bin_current)"
  bin_place
}

bin_uninstall() {
  bin_installed || [ -L "$(bin_link)" ] || { ok "templaitor is not installed in $(bin_prefix)"; return; }
  confirm "Remove templaitor $(bin_current) from $(bin_home)?" || die "Cancelled"
  rm -rf "$(bin_home)"
  [ -L "$(bin_link)" ] && rm -f "$(bin_link)"
  ok "templaitor uninstalled (your projects and data folders are untouched)"
}

bin_status() {
  if bin_installed; then say "binary: templaitor $(bin_current) in $(bin_home) → $(bin_link)"
  else say "binary: not installed (prefix $(bin_prefix))"; fi
}

# ── docker ────────────────────────────────────────────────────────────────────
dk_env() { printf '%s/templaitor/docker.env' "${XDG_CONFIG_HOME:-$HOME/.config}"; }
dk_image() { printf '%s:%s' "$IMAGE" "$( [ -n "$VERSION" ] && strip_v "$VERSION" || printf latest)"; }
dk_exists() { docker container inspect "$NAME" >/dev/null 2>&1; }
dk_need() { need docker "https://docs.docker.com/get-docker/"; docker info >/dev/null 2>&1 || die "Docker is not running (or this user cannot use it)"; }
dk_port() { # port of the existing container, else --port / 3000
  p="$(docker inspect -f '{{range $k, $v := .HostConfig.PortBindings}}{{(index $v 0).HostPort}}{{end}}' "$NAME" 2>/dev/null || true)"
  printf '%s' "${PORT:-${p:-3000}}"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
}

dk_write_env() {
  env="$(dk_env)"
  [ -f "$env" ] && return
  mkdir -p "$(dirname "$env")"
  umask 077
  cat > "$env" <<EOF
# templaitor (docker) — edit, then: setup.sh reinstall --method docker
TEMPLAITOR_BASE_URL=${TEMPLAITOR_BASE_URL:-http://localhost:$1}
# Encrypts the organizations' SMTP passwords: keep it stable
TEMPLAITOR_SECRET=$(random_secret)
TEMPLAITOR_SIGNUP=invite
# System SMTP for sign-in codes (empty: codes are printed in the logs: docker logs templaitor)
TEMPLAITOR_SMTP_HOST=
TEMPLAITOR_SMTP_PORT=587
TEMPLAITOR_SMTP_USER=
TEMPLAITOR_SMTP_PASS=
TEMPLAITOR_SMTP_FROM=templaitor <no-reply@example.com>
EOF
  ok "Configuration → $env (secret generated)"
}

dk_run() {
  port="$1"
  dk_write_env "$port"
  docker run -d --name "$NAME" --restart unless-stopped \
    -p "$port:3000" --env-file "$(dk_env)" -v templaitor-data:/data \
    "$(dk_image)" >/dev/null
  ok "templaitor is running → http://localhost:$port (logs: docker logs -f $NAME)"
}

dk_install() {
  dk_need
  if dk_exists; then ok "The $NAME container already exists"; say "  Use ${B}update${X} or ${B}reinstall${X}."; return; fi
  info "Pulling $(dk_image)"
  docker pull -q "$(dk_image)" >/dev/null
  dk_run "$(dk_port)"
}

dk_update() {
  dk_need
  dk_exists || { warn "templaitor is not installed: installing"; dk_install; return; }
  port="$(dk_port)"
  info "Pulling $(dk_image)"
  docker pull -q "$(dk_image)" >/dev/null
  if [ "$(docker inspect -f '{{.Image}}' "$NAME")" = "$(docker image inspect -f '{{.Id}}' "$(dk_image)")" ]; then
    ok "templaitor is up to date"; return
  fi
  docker rm -f "$NAME" >/dev/null
  dk_run "$port"
}

dk_reinstall() {
  dk_need
  port="$(dk_port)"
  info "Pulling $(dk_image)"
  docker pull -q "$(dk_image)" >/dev/null
  dk_exists && docker rm -f "$NAME" >/dev/null
  dk_run "$port"
}

dk_uninstall() {
  dk_need
  if [ "$PURGE" = 1 ]; then
    confirm "Remove the $NAME container AND its data (volume templaitor-data, $(dk_env))?" || die "Cancelled"
  else
    confirm "Remove the $NAME container (data volume kept)?" || die "Cancelled"
  fi
  dk_exists && docker rm -f "$NAME" >/dev/null
  docker image rm "$(dk_image)" >/dev/null 2>&1 || true
  if [ "$PURGE" = 1 ]; then
    docker volume rm templaitor-data >/dev/null 2>&1 || true
    rm -f "$(dk_env)"
    ok "templaitor uninstalled, data deleted"
  else
    ok "templaitor uninstalled (data kept in the templaitor-data volume; --purge deletes it)"
  fi
}

dk_status() {
  if command -v docker >/dev/null 2>&1 && dk_exists; then
    say "docker: $(docker inspect -f '{{.Config.Image}} · {{.State.Status}}' "$NAME") · port $(dk_port)"
  else say "docker: not installed"; fi
}

# ── helm ──────────────────────────────────────────────────────────────────────
hm_need() { need helm "https://helm.sh/docs/intro/install/"; }
hm_exists() { helm status "$NAME" -n "$NAMESPACE" >/dev/null 2>&1; }
hm_run() { # hm_run install|upgrade [extra]
  verb="$1"; shift
  set -- "$verb" "$NAME" "$CHART" -n "$NAMESPACE" --wait --timeout 5m "$@"
  [ -n "$VERSION" ] && set -- "$@" --version "$(strip_v "$VERSION")"
  [ -n "$VALUES" ] && set -- "$@" --values "$VALUES"
  helm "$@"
}

hm_install() {
  hm_need
  if hm_exists; then ok "Helm release $NAME already exists in namespace $NAMESPACE"; say "  Use ${B}update${X} or ${B}reinstall${X}."; return; fi
  info "Installing $CHART into namespace $NAMESPACE"
  hm_run install --create-namespace
  ok "Installed. Next steps: helm get notes $NAME -n $NAMESPACE"
}

hm_update() {
  hm_need
  hm_exists || { warn "templaitor is not installed: installing"; hm_install; return; }
  info "Upgrading $NAME in namespace $NAMESPACE"
  hm_run upgrade --reuse-values
  ok "Upgraded ($(helm list -n "$NAMESPACE" -f "^$NAME\$" -o json 2>/dev/null | sed -n 's/.*"app_version":"\([^"]*\)".*/\1/p'))"
}

hm_reinstall() {
  hm_need
  hm_exists && helm uninstall "$NAME" -n "$NAMESPACE" --wait >/dev/null
  hm_install
}

hm_uninstall() {
  hm_need
  hm_exists || { ok "Helm release $NAME is not installed in $NAMESPACE"; [ "$PURGE" = 1 ] || return 0; }
  if [ "$PURGE" = 1 ]; then
    confirm "Uninstall $NAME AND delete its data (PVC and secret) in namespace $NAMESPACE?" || die "Cancelled"
  else
    confirm "Uninstall $NAME from namespace $NAMESPACE (data PVC and secret kept)?" || die "Cancelled"
  fi
  hm_exists && helm uninstall "$NAME" -n "$NAMESPACE" --wait >/dev/null
  if [ "$PURGE" = 1 ]; then
    need kubectl
    kubectl delete pvc,secret -n "$NAMESPACE" -l "app.kubernetes.io/instance=$NAME" --ignore-not-found >/dev/null
    ok "templaitor uninstalled, data deleted"
  else
    ok "templaitor uninstalled (PVC and secret kept; --purge deletes them)"
  fi
}

hm_status() {
  if command -v helm >/dev/null 2>&1 && hm_exists; then
    say "helm: release $NAME in namespace $NAMESPACE ($(helm status "$NAME" -n "$NAMESPACE" 2>/dev/null | sed -n 's/^STATUS: //p'))"
  else say "helm: not installed"; fi
}

# ── menu ──────────────────────────────────────────────────────────────────────
menu() {
  say ""
  say "${B}templaitor setup${X}"
  bin_status; dk_status; hm_status
  say ""
  if [ -z "$METHOD" ]; then
    say "How do you want to run templaitor?"
    say "  1) binary  — CLI + local editor (self-contained, no Node.js needed)"
    say "  2) docker  — hosted service in a container"
    say "  3) helm    — hosted service on Kubernetes"
    case "$(ask "Choose [1]:" 1)" in
      1|binary) METHOD=binary ;; 2|docker) METHOD=docker ;; 3|helm) METHOD=helm ;;
      *) die "Invalid choice" ;;
    esac
  fi
  say ""
  say "What do you want to do ($METHOD)?"
  say "  1) install"
  say "  2) update"
  say "  3) reinstall"
  say "  4) uninstall"
  case "$(ask "Choose [1]:" 1)" in
    1|install) ACTION=install ;; 2|update) ACTION=update ;; 3|reinstall) ACTION=reinstall ;; 4|uninstall) ACTION=uninstall ;;
    *) die "Invalid choice" ;;
  esac
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      install|update|upgrade|reinstall|uninstall|remove|status) ACTION="$1" ;;
      --method) METHOD="${2:?--method needs a value}"; shift ;;
      --method=*) METHOD="${1#*=}" ;;
      --version) VERSION="${2:?--version needs a value}"; shift ;;
      --version=*) VERSION="${1#*=}" ;;
      --prefix) PREFIX="${2:?--prefix needs a value}"; shift ;;
      --prefix=*) PREFIX="${1#*=}" ;;
      --port) PORT="${2:?--port needs a value}"; shift ;;
      --port=*) PORT="${1#*=}" ;;
      --namespace|-n) NAMESPACE="${2:?--namespace needs a value}"; shift ;;
      --namespace=*) NAMESPACE="${1#*=}" ;;
      --values|-f) VALUES="${2:?--values needs a value}"; shift ;;
      --values=*) VALUES="${1#*=}" ;;
      --purge) PURGE=1 ;;
      -y|--yes) YES=1 ;;
      -h|--help|help) usage; exit 0 ;;
      *) say "Unknown argument: $1"; usage >&2; exit 2 ;;
    esac
    shift
  done
  case "$ACTION" in upgrade) ACTION=update ;; remove) ACTION=uninstall ;; esac

  trap cleanup EXIT
  trap 'exit 130' INT TERM

  if [ "$ACTION" = status ]; then bin_status; dk_status; hm_status; exit 0; fi
  if [ -z "$ACTION" ]; then
    has_tty && [ "$YES" = 0 ] || { usage >&2; exit 2; }
    menu
  fi
  METHOD="${METHOD:-binary}"
  case "$METHOD" in
    binary) pre=bin ;; docker) pre=dk ;; helm|kubernetes|k8s) pre=hm ;;
    *) die "Unknown method: $METHOD (binary · docker · helm)" ;;
  esac
  "${pre}_${ACTION}"
}

main "$@"
