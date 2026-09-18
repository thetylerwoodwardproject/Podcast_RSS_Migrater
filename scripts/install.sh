#!/usr/bin/env bash
#
# Installs Podcast RSS Migrater as a systemd service on Ubuntu or Debian.
#
#   sudo ./scripts/install.sh
#
# Existing configuration in /etc/migrater and job workspaces in /var/lib/migrater
# are preserved if they are already present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

step "Checking the system"
require_root
require_debian_like

step "Checking dependencies"
ensure_node

step "Creating the service account"
create_service_user

step "Installing ${APP_NAME}"
install_application "$SOURCE_DIR"

step "Configuring"
create_config_if_missing
create_data_dirs
install_service "$SOURCE_DIR"

step "Starting ${SERVICE_NAME}"
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"

if wait_for_health; then
  PORT="$(configured_port)"
  ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$ADDRESS" ] || ADDRESS="your-server-ip"

  printf '\n%s is running.\n\n' "$APP_NAME"
  printf '  Web interface   http://%s:%s\n' "$ADDRESS" "$PORT"
  printf '  Configuration   %s\n' "$CONFIG_FILE"
  printf '  Job storage     %s\n' "$DATA_DIR"
  printf '  Logs            journalctl -u %s -f\n\n' "$SERVICE_NAME"
  printf '%s has no built-in authentication. It fetches URLs on your behalf and\n' "$APP_NAME"
  printf 'handles SFTP credentials, so put it behind an authenticated reverse proxy\n'
  printf 'before exposing it beyond a trusted network.\n\n'
else
  printf '\n'
  warn "${SERVICE_NAME} did not become healthy within 30 seconds."
  printf 'Check the logs with: journalctl -u %s -n 50 --no-pager\n\n' "$SERVICE_NAME"
  exit 1
fi
