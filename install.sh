#!/usr/bin/env bash
# CoopCentric installer / updater for Ubuntu 24.04.
#
#   curl -fsSL https://raw.githubusercontent.com/caritechsolutions/codenameduck/main/install.sh | sudo bash
#
# Idempotent. First run: installs nginx + tools, clones the repo to /opt/coopcentric, creates
# /srv/coopcentric, installs bin/* to /usr/local/bin. Every run: updates the checkout and
# re-deploys tv-app/ into every tenant under /srv/coopcentric/tenants/ — including tenants that
# were created by hand (their xait.xml and nginx vhost are left untouched).
#
# Optional environment (pass as `sudo COOPCENTRIC_BRANCH=foo bash`):
#   COOPCENTRIC_REPO    git URL      (default https://github.com/caritechsolutions/codenameduck.git)
#   COOPCENTRIC_BRANCH  branch       (default main)
#   COOPCENTRIC_HOME    checkout dir (default /opt/coopcentric)
#   COOPCENTRIC_ROOT    data dir     (default /srv/coopcentric)
set -euo pipefail

# Everything lives inside main() so bash parses the whole script before running any of it —
# required when piped from curl and when this file is replaced underneath us by the git update.
main() {
  local REPO BRANCH HOME_DIR ROOT_DIR BIN_DIR pkgs missing
  REPO="${COOPCENTRIC_REPO:-https://github.com/caritechsolutions/codenameduck.git}"
  BRANCH="${COOPCENTRIC_BRANCH:-main}"
  HOME_DIR="${COOPCENTRIC_HOME:-/opt/coopcentric}"
  ROOT_DIR="${COOPCENTRIC_ROOT:-/srv/coopcentric}"
  BIN_DIR="${COOPCENTRIC_BIN:-/usr/local/bin}"

  log()  { printf '[coopcentric-install] %s\n' "$*"; }
  warn() { printf '[coopcentric-install] WARNING: %s\n' "$*" >&2; }
  die()  { printf '[coopcentric-install] ERROR: %s\n' "$*" >&2; exit 1; }

  [ "$(id -u)" -eq 0 ] || die "must run as root: curl -fsSL <url> | sudo bash"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    [ "${ID:-}" = "ubuntu" ] || warn "this installer is written for Ubuntu 24.04 (detected ${PRETTY_NAME:-unknown})"
    [ "${VERSION_ID:-}" = "24.04" ] || warn "untested on Ubuntu ${VERSION_ID:-?}; continuing"
  fi

  # --- packages ------------------------------------------------------------------------------
  pkgs=(nginx git rsync unzip curl ca-certificates)
  missing=()
  for p in "${pkgs[@]}"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    log "installing packages: ${missing[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq </dev/null
    apt-get install -y -qq --no-install-recommends "${missing[@]}" </dev/null
  else
    log "packages already installed: ${pkgs[*]}"
  fi

  # --- code checkout -------------------------------------------------------------------------
  if [ -d "$HOME_DIR/.git" ]; then
    if [ -n "$(git -C "$HOME_DIR" status --porcelain)" ]; then
      die "$HOME_DIR has local modifications; commit/stash/discard them, then re-run"
    fi
    log "updating $HOME_DIR from $REPO ($BRANCH)"
    git -C "$HOME_DIR" remote set-url origin "$REPO"
    git -C "$HOME_DIR" fetch --quiet --prune origin "$BRANCH" </dev/null
    git -C "$HOME_DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
  elif [ -e "$HOME_DIR" ] && [ -n "$(ls -A "$HOME_DIR" 2>/dev/null)" ]; then
    die "$HOME_DIR exists but is not a git checkout; move it aside and re-run"
  else
    log "cloning $REPO ($BRANCH) into $HOME_DIR"
    git clone --quiet --branch "$BRANCH" "$REPO" "$HOME_DIR" </dev/null
  fi
  log "checkout at $(git -C "$HOME_DIR" rev-parse --short HEAD) ($(git -C "$HOME_DIR" log -1 --format=%s))"

  # --- filesystem layout ---------------------------------------------------------------------
  mkdir -p "$ROOT_DIR/tenants"
  log "data root: $ROOT_DIR (tenants in $ROOT_DIR/tenants)"

  # --- CLI tools -----------------------------------------------------------------------------
  for f in "$HOME_DIR"/bin/*; do
    [ -f "$f" ] || continue
    install -m 0755 "$f" "$BIN_DIR/$(basename "$f")"
    log "installed $BIN_DIR/$(basename "$f")"
  done

  # --- nginx ---------------------------------------------------------------------------------
  if [ -d /run/systemd/system ]; then
    systemctl enable --quiet nginx 2>/dev/null || true
    systemctl is-active --quiet nginx || systemctl start nginx
  fi

  # --- deploy tv-app into every tenant (adopts hand-made tenants) -----------------------------
  local count=0 d
  for d in "$ROOT_DIR"/tenants/*/; do [ -d "$d" ] && count=$((count + 1)); done
  if [ "$count" -gt 0 ]; then
    log "deploying tv-app into $count tenant(s)"
    COOPCENTRIC_HOME="$HOME_DIR" COOPCENTRIC_ROOT="$ROOT_DIR" "$BIN_DIR/coopcentric-tenant" deploy
  else
    log "no tenants yet — create one with: sudo coopcentric-tenant new <name> <hostname>"
  fi

  # Reload so any vhost that already existed picks up nothing new but we prove config validity.
  if command -v nginx >/dev/null 2>&1; then
    nginx -t 2>&1 | sed 's/^/[nginx] /'
    [ "${PIPESTATUS[0]}" -eq 0 ] || die "nginx configuration test failed"
    if [ -d /run/systemd/system ]; then
      systemctl reload nginx && log "nginx reloaded"
    elif pidof nginx >/dev/null 2>&1; then
      nginx -s reload && log "nginx reloaded"
    else
      warn "nginx not running (no systemd?); config valid, not reloaded"
    fi
  fi

  log "done."
  COOPCENTRIC_HOME="$HOME_DIR" COOPCENTRIC_ROOT="$ROOT_DIR" "$BIN_DIR/coopcentric-tenant" list
}

main "$@"
