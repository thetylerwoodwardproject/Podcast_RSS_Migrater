#!/usr/bin/env bash
#
# One-step Podcast RSS Migrater installer.
#
#   curl -fsSL https://raw.githubusercontent.com/thetylerwoodwardproject/Podcast_RSS_Migrater/main/scripts/bootstrap.sh | sudo bash
#
# Clones the repository to a source directory and runs scripts/install.sh from it.
# Everything install.sh does is unchanged; this only gets the source onto the
# machine first.
#
# Environment:
#   MIGRATER_REF       branch, tag or commit to install (default: main)
#   MIGRATER_SRC_DIR   where the checkout lives (default: /usr/local/src/migrater)
#
# The checkout is kept rather than discarded, because updating later is
#   cd /usr/local/src/migrater && sudo git pull && sudo ./scripts/update.sh

set -euo pipefail

# The whole script is one function, invoked on the last line. Piping into bash
# executes whatever has arrived so far, so a download cut off midway could
# otherwise run half an installer. Defining a function first means an incomplete
# file simply never calls it.
main() {
  local repo_url="https://github.com/thetylerwoodwardproject/Podcast_RSS_Migrater.git"
  local ref="${MIGRATER_REF:-main}"
  local src_dir="${MIGRATER_SRC_DIR:-/usr/local/src/migrater}"

  printf '\n==> Installing Podcast RSS Migrater\n'

  if [ "$(id -u)" -ne 0 ]; then
    printf 'error: this installer must run as root. Pipe it into "sudo bash":\n' >&2
    printf '  curl -fsSL https://raw.githubusercontent.com/thetylerwoodwardproject/Podcast_RSS_Migrater/main/scripts/bootstrap.sh | sudo bash\n' >&2
    exit 1
  fi

  if [ ! -r /etc/os-release ]; then
    printf 'error: cannot read /etc/os-release. Podcast RSS Migrater installs on Ubuntu and Debian 13+.\n' >&2
    exit 1
  fi

  # A light check only; install.sh does the authoritative one, including the
  # Debian version check.
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-} ${ID_LIKE:-}" in
  *debian* | *ubuntu*) printf '  Detected %s\n' "${PRETTY_NAME:-${ID:-unknown}}" ;;
  *)
    printf 'error: Podcast RSS Migrater installs on Ubuntu and Debian 13+. Detected: %s\n' "${PRETTY_NAME:-${ID:-unknown}}" >&2
    printf 'For other distributions, use the Docker deployment.\n' >&2
    exit 1
    ;;
  esac

  if ! command -v git >/dev/null 2>&1; then
    printf '  Installing git\n'
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ca-certificates
  fi

  if [ -e "$src_dir" ] && [ ! -d "${src_dir}/.git" ]; then
    printf 'error: %s exists but is not a git checkout.\n' "$src_dir" >&2
    printf 'Move it aside, or set MIGRATER_SRC_DIR to a different path.\n' >&2
    exit 1
  fi

  if [ -d "${src_dir}/.git" ]; then
    printf '  Updating the existing checkout at %s\n' "$src_dir"
    git -C "$src_dir" remote set-url origin "$repo_url"
    git -C "$src_dir" fetch --quiet --tags origin
  else
    printf '  Cloning into %s\n' "$src_dir"
    mkdir -p "$(dirname "$src_dir")"
    git clone --quiet "$repo_url" "$src_dir"
  fi

  # Resolve through origin/<ref> first so a branch name follows the remote rather
  # than a stale local copy; fall back to the literal ref for a tag or commit.
  local target
  if target="$(git -C "$src_dir" rev-parse --verify --quiet "origin/${ref}^{commit}")"; then
    :
  elif target="$(git -C "$src_dir" rev-parse --verify --quiet "${ref}^{commit}")"; then
    :
  else
    printf 'error: "%s" is not a branch, tag or commit in the repository.\n' "$ref" >&2
    exit 1
  fi

  git -C "$src_dir" -c advice.detachedHead=false checkout --quiet --force "$target"
  printf '  Using %s (%s)\n' "$ref" "$(git -C "$src_dir" rev-parse --short HEAD)"

  [ -x "${src_dir}/scripts/install.sh" ] ||
    fail_missing_installer "$src_dir"

  # stdin is the piped script itself, so it is detached before handing over.
  bash "${src_dir}/scripts/install.sh" </dev/null
}

fail_missing_installer() {
  printf 'error: scripts/install.sh is missing or not executable in %s\n' "$1" >&2
  exit 1
}

main "$@"
