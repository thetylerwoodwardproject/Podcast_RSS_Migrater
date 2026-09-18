#!/usr/bin/env bash
#
# Removes Podcast RSS Migrater.
#
#   sudo ./scripts/uninstall.sh
#
# The application is removed without prompting. Configuration and job workspaces are
# only deleted if you explicitly confirm; the default for both is to keep them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

# Defaults chosen so that a non-interactive run never destroys data.
confirm() {
  local prompt="$1"
  local reply

  if [ ! -t 0 ]; then
    info "Not running interactively; keeping it."
    return 1
  fi

  read -r -p "${prompt} [y/N] " reply
  case "$reply" in
  [yY] | [yY][eE][sS]) return 0 ;;
  *) return 1 ;;
  esac
}

step "Checking the system"
require_root

step "Stopping ${SERVICE_NAME}"
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true

if [ -f "$UNIT_FILE" ]; then
  info "Removing the systemd unit"
  rm -f "$UNIT_FILE"
  systemctl daemon-reload
fi

step "Removing the application"
if [ -d "$INSTALL_DIR" ]; then
  case "$INSTALL_DIR" in
  /opt/migrater) rm -rf "${INSTALL_DIR:?}" && info "Removed ${INSTALL_DIR}" ;;
  *) warn "Refusing to remove '${INSTALL_DIR}': expected /opt/migrater." ;;
  esac
else
  info "${INSTALL_DIR} is already gone"
fi

step "Job workspaces and configuration"

if [ -d "$DATA_DIR" ]; then
  SIZE="$(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)"
  printf '\n%s holds archived podcasts (%s).\n' "$DATA_DIR" "${SIZE:-unknown size}"
  if confirm "Delete ${DATA_DIR} and everything in it?"; then
    rm -rf "${DATA_DIR:?}"
    info "Removed ${DATA_DIR}"
  else
    info "Keeping ${DATA_DIR}"
  fi
fi

if [ -d "$CONFIG_DIR" ]; then
  printf '\n%s holds your configuration.\n' "$CONFIG_DIR"
  if confirm "Delete ${CONFIG_DIR}?"; then
    rm -rf "${CONFIG_DIR:?}"
    info "Removed ${CONFIG_DIR}"
  else
    info "Keeping ${CONFIG_DIR}"
  fi
fi

if id "$SERVICE_USER" >/dev/null 2>&1; then
  printf '\nThe system user '\''%s'\'' still exists.\n' "$SERVICE_USER"
  if confirm "Remove the '${SERVICE_USER}' user?"; then
    if userdel "$SERVICE_USER" 2>/dev/null; then
      info "Removed user '${SERVICE_USER}'"
    else
      warn "Could not remove the user; it may still own files."
    fi
  else
    info "Keeping the '${SERVICE_USER}' user"
  fi
fi

printf '\n%s has been uninstalled.\n' "$APP_NAME"
printf 'Node.js was left installed; remove it yourself if nothing else needs it.\n\n'
