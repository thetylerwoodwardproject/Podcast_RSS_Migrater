#!/usr/bin/env bash
# Shared settings and helpers for the install, update and uninstall scripts.
# These paths must agree across all three, which is why they live in one place.

APP_NAME="Podcast RSS Migrater"
SERVICE_NAME="migrater"
SERVICE_USER="migrater"
INSTALL_DIR="/opt/migrater"
CONFIG_DIR="/etc/migrater"
CONFIG_FILE="${CONFIG_DIR}/migrater.env"
DATA_DIR="/var/lib/migrater"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
MIN_NODE_MAJOR=22
MIN_DEBIAN_MAJOR=13
NODESOURCE_MAJOR=22

info() { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "This script must be run as root. Try: sudo $0"
  fi
}

require_debian_like() {
  [ -r /etc/os-release ] || fail "Cannot read /etc/os-release. ${APP_NAME} supports Ubuntu and Debian."

  # shellcheck disable=SC1091
  . /etc/os-release

  case "${ID:-} ${ID_LIKE:-}" in
  *debian* | *ubuntu*) info "Detected ${PRETTY_NAME:-${ID:-unknown}}" ;;
  *)
    fail "${APP_NAME} supports Ubuntu and Debian. Detected: ${PRETTY_NAME:-${ID:-unknown}}.
For other distributions, use the Docker deployment instead."
    ;;
  esac

  # Debian 13 is the oldest release this is tested on. Older ones are warned about
  # rather than refused: they will often work, they are just not covered.
  if [ "${ID:-}" = debian ] && [ -n "${VERSION_ID:-}" ]; then
    local debian_major="${VERSION_ID%%.*}"
    if [ "$debian_major" -lt "$MIN_DEBIAN_MAJOR" ] 2>/dev/null; then
      warn "Debian ${VERSION_ID} is older than the tested minimum of ${MIN_DEBIAN_MAJOR}. The install may still work but is not covered by testing."
    fi
  fi
}

# Reads the configured port so the scripts report and health-check the right URL.
configured_port() {
  if [ -r "$CONFIG_FILE" ]; then
    local port
    port="$(grep -E '^PORT=' "$CONFIG_FILE" | tail -1 | cut -d= -f2 | tr -d '"'"'"' ')"
    if [ -n "$port" ]; then
      printf '%s' "$port"
      return
    fi
  fi
  printf '8080'
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
      info "Node.js $(node -v) is already installed"
      return
    fi
    warn "Node.js $(node -v) is older than the required v${MIN_NODE_MAJOR}. Installing a current release."
  fi

  info "Installing Node.js ${NODESOURCE_MAJOR}.x from NodeSource"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates

  # The distribution's own nodejs package is frequently too old for this project.
  curl -fsSL "https://deb.nodesource.com/setup_${NODESOURCE_MAJOR}.x" | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs

  command -v node >/dev/null 2>&1 || fail "Node.js is still missing after installation."
  info "Installed Node.js $(node -v)"
}

create_service_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    info "Service user '${SERVICE_USER}' already exists"
    return
  fi

  info "Creating system user '${SERVICE_USER}'"
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
}

create_data_dirs() {
  info "Creating storage under ${DATA_DIR}"
  mkdir -p "${DATA_DIR}/jobs"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DATA_DIR"
  chmod 750 "$DATA_DIR"
}

# Refuses a source directory that cannot safely be installed from.
#
# Call this before stopping the service or touching any files: installation
# deletes INSTALL_DIR and copies the source into it, and the scripts live inside
# INSTALL_DIR, so running the installed copy would delete the tree it is copying
# from. Failing here rather than mid-install is what keeps a refused update from
# leaving the service stopped.
require_external_source() {
  local source_dir="$1"

  [ -f "${source_dir}/package.json" ] || fail "Cannot find package.json in ${source_dir}."

  # Guard against a mistyped INSTALL_DIR before anything is removed.
  case "$INSTALL_DIR" in
  /opt/migrater) : ;;
  *) fail "Refusing to replace '${INSTALL_DIR}': expected /opt/migrater." ;;
  esac

  local resolved_source
  resolved_source="$(cd "$source_dir" 2>/dev/null && pwd -P)" ||
    fail "Cannot read the source directory ${source_dir}."

  if [ "$resolved_source" = "$INSTALL_DIR" ]; then
    fail "Refusing to install ${INSTALL_DIR} into itself, which would delete it.
Run this from a source checkout instead, for example:
  cd /usr/local/src/migrater && sudo git pull && sudo ./scripts/update.sh"
  fi
}

# Copies the application into INSTALL_DIR and builds it.
install_application() {
  local source_dir="$1"

  # Checked again here as well as up front: this function is what does the
  # deleting, so it should never rely on a caller having asked first.
  require_external_source "$source_dir"

  info "Installing application files into ${INSTALL_DIR}"
  rm -rf "${INSTALL_DIR:?}"
  mkdir -p "$INSTALL_DIR"

  local item
  for item in package.json package-lock.json tsconfig.json svelte.config.js vite.config.ts eslint.config.js src static scripts systemd LICENSE README.md; do
    if [ -e "${source_dir}/${item}" ]; then
      cp -a "${source_dir}/${item}" "${INSTALL_DIR}/"
    fi
  done

  # A stale node_modules or build copied from the source tree would be rebuilt anyway.
  rm -rf "${INSTALL_DIR}/node_modules" "${INSTALL_DIR}/build" "${INSTALL_DIR}/.svelte-kit"

  step "Installing dependencies (this can take a few minutes)"
  (cd "$INSTALL_DIR" && npm ci --no-audit --no-fund)

  step "Building ${APP_NAME}"
  (cd "$INSTALL_DIR" && npm run build)

  info "Removing build-only dependencies"
  # Never --omit=optional here: sharp resolves its native libvips binary through
  # platform-specific optional dependencies, and dropping them leaves an install
  # that builds fine and then throws on the first image.
  (cd "$INSTALL_DIR" && npm prune --omit=dev --no-audit --no-fund)

  (cd "$INSTALL_DIR" && node -e "require('sharp')") ||
    fail "sharp cannot load after pruning. The native image library is missing."

  # The service account only needs to read the application; it never writes here.
  chown -R root:root "$INSTALL_DIR"
}

create_config_if_missing() {
  mkdir -p "$CONFIG_DIR"

  if [ -f "$CONFIG_FILE" ]; then
    info "Keeping existing configuration at ${CONFIG_FILE}"
    return
  fi

  info "Writing default configuration to ${CONFIG_FILE}"
  cat >"$CONFIG_FILE" <<EOF
# ${APP_NAME} configuration. Restart after editing: systemctl restart ${SERVICE_NAME}
HOST=0.0.0.0
PORT=8080

MIGRATER_DATA_PATH=${DATA_DIR}

# Prefills the "new base URL" field, e.g. https://media.example.com/
MIGRATER_DEFAULT_BASE_URL=

MIGRATER_JPEG_QUALITY=90
MIGRATER_MAX_CONCURRENT_JOBS=1
MIGRATER_MAX_CONCURRENT_DOWNLOADS=4

MIGRATER_MAX_ASSET_MB=1000
MIGRATER_MAX_JOB_GB=50
MIGRATER_DOWNLOAD_TIMEOUT_MS=60000
MIGRATER_JOB_RETENTION_HOURS=24

# Leave false unless you are deliberately archiving a feed on your own network.
MIGRATER_ALLOW_PRIVATE_HOSTS=false

# Set to true only when running behind a reverse proxy you control.
MIGRATER_TRUST_PROXY=false

MIGRATER_LOG_LEVEL=info
EOF

  chmod 640 "$CONFIG_FILE"
  chown root:"$SERVICE_USER" "$CONFIG_FILE"
}

install_service() {
  local source_dir="$1"
  local unit_source="${source_dir}/systemd/${SERVICE_NAME}.service"

  [ -f "$unit_source" ] || fail "Cannot find the systemd unit at ${unit_source}."

  # ensure_node accepts any suitable Node on PATH, which is not always the
  # /usr/bin/node the shipped unit assumes: a Node installed from a tarball or by
  # nvm lands elsewhere. The installed unit is pointed at whichever one this
  # system actually has, or the service would fail to start.
  local node_bin
  node_bin="$(command -v node)" || fail "Node.js is not on PATH."

  info "Installing systemd unit (node: ${node_bin})"
  cp "$unit_source" "$UNIT_FILE"
  sed -i "s|^ExecStart=.*|ExecStart=${node_bin} ${INSTALL_DIR}/build/index.js|" "$UNIT_FILE"
  chmod 644 "$UNIT_FILE"
  systemctl daemon-reload
}

# Polls /api/health until the service answers, so a failed start is reported here
# rather than discovered later.
wait_for_health() {
  local port remaining
  port="$(configured_port)"
  remaining=30

  while [ "$remaining" -gt 0 ]; do
    if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    remaining=$((remaining - 1))
  done

  return 1
}
