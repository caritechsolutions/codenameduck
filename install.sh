#!/usr/bin/env bash
# CoopCentric installer / updater for Ubuntu 24.04.
#
#   curl -fsSL https://raw.githubusercontent.com/caritechsolutions/codenameduck/main/install.sh | sudo bash
#
# Idempotent. First run: installs nginx + Node.js 20 (NodeSource) + tools, clones the repo to
# /opt/coopcentric, creates /srv/coopcentric, installs bin/* to /usr/local/bin and the
# coopcentric systemd service. Every run: updates the checkout, installs server dependencies,
# builds tv-app (and admin, once it exists), restarts the service and re-deploys the tv-app
# build into every tenant under /srv/coopcentric/tenants/ — including tenants that were created
# by hand (their xait.xml is never touched; a hand-made vhost is kept until adopted).
#
# Optional environment (pass as `sudo COOPCENTRIC_BRANCH=foo bash`):
#   COOPCENTRIC_REPO    git URL      (default https://github.com/caritechsolutions/codenameduck.git)
#   COOPCENTRIC_BRANCH  branch       (default main)
#   COOPCENTRIC_HOME    checkout dir (default /opt/coopcentric)
#   COOPCENTRIC_ROOT    data dir     (default /srv/coopcentric)
#   COOPCENTRIC_NODE_MAJOR  Node.js major to install from NodeSource (default 20)
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
  NODE_MAJOR="${COOPCENTRIC_NODE_MAJOR:-20}"
  SERVICE="coopcentric"

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
  pkgs=(nginx git rsync unzip curl ca-certificates gnupg)
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

  # --- Node.js (NodeSource) ------------------------------------------------------------------
  local node_ok=0 nv
  if command -v node >/dev/null 2>&1; then
    nv="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    [ "$nv" -ge "$NODE_MAJOR" ] 2>/dev/null && node_ok=1
  fi
  if [ "$node_ok" -eq 1 ]; then
    log "node $(node --version) present at $(command -v node)"
  else
    log "installing Node.js ${NODE_MAJOR}.x from NodeSource"
    export DEBIAN_FRONTEND=noninteractive
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key </dev/null \
      | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq </dev/null
    apt-get install -y -qq nodejs </dev/null
    log "installed node $(node --version), npm $(npm --version)"
  fi
  command -v npm >/dev/null 2>&1 || die "npm not found after Node.js install"

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

  # --- build: server deps, tv-app bundle, admin UI (when present) -----------------------------
  local npm_cache; npm_cache="$(mktemp -d)"
  export npm_config_cache="$npm_cache" npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
  log "installing server dependencies"
  (cd "$HOME_DIR/server" && npm ci --omit=dev --no-progress --loglevel=error </dev/null)
  log "building tv-app"
  (cd "$HOME_DIR/tv-app" && npm ci --no-progress --loglevel=error </dev/null && npm run --silent build </dev/null)
  if [ -f "$HOME_DIR/admin/package.json" ]; then
    log "building admin UI"
    (cd "$HOME_DIR/admin" && npm ci --no-progress --loglevel=error </dev/null && npm run --silent build </dev/null)
  else
    log "admin UI not present yet (Phase 2 step 2) — skipping"
  fi
  rm -rf "$npm_cache"
  # The service runs as www-data and must be able to read the checkout.
  chmod -R a+rX "$HOME_DIR"

  # --- data dir + sudo rule + systemd service --------------------------------------------------
  install -d -m 0750 -o www-data -g www-data "$ROOT_DIR/data"
  # The admin's superadmin "Tenants" page creates tenants by running the same CLI as root.
  local sudoers=/etc/sudoers.d/coopcentric tmp_sudo
  tmp_sudo="$(mktemp)"
  printf 'www-data ALL=(root) NOPASSWD:SETENV: %s/coopcentric-tenant\n' "$BIN_DIR" > "$tmp_sudo"
  if command -v visudo >/dev/null 2>&1 && visudo -cf "$tmp_sudo" >/dev/null 2>&1; then
    install -m 0440 -o root -g root "$tmp_sudo" "$sudoers"
    log "installed $sudoers (www-data may run coopcentric-tenant as root)"
  else
    warn "visudo check failed or missing; not installing $sudoers (tenant creation from admin will fail)"
  fi
  rm -f "$tmp_sudo"
  if [ -d /run/systemd/system ]; then
    install -m 0644 "$HOME_DIR/systemd/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
    systemctl daemon-reload
    systemctl enable --quiet "$SERVICE" 2>/dev/null || true
    systemctl restart "$SERVICE"
    local _
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break
      sleep 1
    done
    if curl -fsS http://127.0.0.1:3000/healthz 2>/dev/null; then
      echo; log "$SERVICE.service is up (systemctl status $SERVICE / journalctl -u $SERVICE -f)"
    else
      systemctl --no-pager --lines=20 status "$SERVICE" || true
      die "$SERVICE.service did not answer on http://127.0.0.1:3000/healthz"
    fi
  else
    warn "no systemd: not installing $SERVICE.service; start manually with: cd $HOME_DIR/server && node src/index.js"
  fi

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

  # Prove the nginx config is valid and reload (deploy may have re-rendered managed vhosts).
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

  log "done. tv-app build: $(cat "$HOME_DIR/tv-app/dist/version.txt" 2>/dev/null || echo '?')"
  COOPCENTRIC_HOME="$HOME_DIR" COOPCENTRIC_ROOT="$ROOT_DIR" "$BIN_DIR/coopcentric-tenant" list
  echo
  log "next: a tenant whose vhost is listed as hand-made needs the platform routes;"
  log "      when ready run: sudo coopcentric-tenant vhost <name> --adopt   (keeps a .bak of the old vhost)"
}

main "$@"
