#!/usr/bin/env bash
#
# Updates an existing Podcast RSS Migrater installation from this source tree.
#
#   git pull && sudo ./scripts/update.sh
#
# Configuration in /etc/migrater and job workspaces in /var/lib/migrater are left alone.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

step "Checking the system"
require_root
require_debian_like

[ -f "$UNIT_FILE" ] || fail "${APP_NAME} does not appear to be installed. Run scripts/install.sh first."

# Before anything destructive: a refusal here must not leave the service stopped.
require_external_source "$SOURCE_DIR"

step "Checking dependencies"
ensure_node

if [ -f "$CONFIG_FILE" ]; then
  BACKUP="${CONFIG_FILE}.$(date +%Y%m%d%H%M%S).bak"
  info "Backing up configuration to ${BACKUP}"
  cp -a "$CONFIG_FILE" "$BACKUP"
fi

step "Stopping ${SERVICE_NAME}"
systemctl stop "$SERVICE_NAME" || true

step "Installing the new version"
install_application "$SOURCE_DIR"

step "Configuring"
# Only fills in a config file if one is missing; an existing file is untouched.
create_config_if_missing
create_data_dirs
install_service "$SOURCE_DIR"

step "Starting ${SERVICE_NAME}"
systemctl start "$SERVICE_NAME"

if wait_for_health; then
  VERSION="$(curl -fsS "http://127.0.0.1:$(configured_port)/api/health" 2>/dev/null |
    sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  printf '\n%s updated%s and running.\n\n' "$APP_NAME" "${VERSION:+ to v${VERSION}}"
else
  printf '\n'
  warn "${SERVICE_NAME} did not become healthy after the update."
  printf 'Check the logs with: journalctl -u %s -n 50 --no-pager\n\n' "$SERVICE_NAME"
  exit 1
fi
