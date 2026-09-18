#!/usr/bin/env bash
#
# End-to-end check against a running instance.
#
#   ./scripts/smoke-test.sh [base-url]
#
# Serves a tiny podcast from a local directory, archives it through the API, and
# asserts the delivered ZIP contains a correctly rewritten feed. The fixture
# server binds to localhost, so the instance under test needs
# MIGRATER_ALLOW_PRIVATE_HOSTS=true.

set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
FIXTURE_PORT="${MIGRATER_SMOKE_PORT:-8099}"
FIXTURE_HOST="${MIGRATER_SMOKE_HOST:-127.0.0.1}"

WORK_DIR="$(mktemp -d)"
FIXTURE_PID=""

cleanup() {
  if [ -n "$FIXTURE_PID" ]; then
    kill "$FIXTURE_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

pass() { printf '  ok   %s\n' "$*"; }
fail() {
  printf '  FAIL %s\n' "$*" >&2
  exit 1
}

printf '\n==> Smoke testing %s\n' "$BASE_URL"

# --- A podcast to archive ---------------------------------------------------
mkdir -p "${WORK_DIR}/site/audio" "${WORK_DIR}/site/images"
head -c 4096 /dev/urandom >"${WORK_DIR}/site/audio/ep001.mp3"

# An 8x8 RGBA PNG, embedded rather than generated: it has to be a genuinely valid
# image for the conversion step to mean anything, and the host running this script
# has no image library of its own. The alpha channel makes the run exercise the
# composite-onto-white path as well.
COVER_PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGM4oaHRgA8zjAwFALcUZgE/9ExZAAAAAElFTkSuQmCC'
printf '%s' "$COVER_PNG_BASE64" | base64 -d >"${WORK_DIR}/site/images/cover.png"

FIXTURE_BASE="http://${FIXTURE_HOST}:${FIXTURE_PORT}"
cat >"${WORK_DIR}/site/feed.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Smoke Test Show</title>
    <link>${FIXTURE_BASE}/</link>
    <description>Fixture</description>
    <atom:link rel="self" href="${FIXTURE_BASE}/feed.xml"/>
    <itunes:image href="${FIXTURE_BASE}/images/cover.png"/>
    <item>
      <title>Episode One</title>
      <guid>smoke-1</guid>
      <enclosure url="${FIXTURE_BASE}/audio/ep001.mp3" length="1" type="audio/mpeg"/>
    </item>
  </channel>
</rss>
XML

# --- Serve it ---------------------------------------------------------------
cat >"${WORK_DIR}/serve.mjs" <<'JS'
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOT = process.argv[2];
const TYPES = { '.xml': 'application/rss+xml', '.mp3': 'audio/mpeg', '.png': 'image/png' };
createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const stats = statSync(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': stats.size,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(Number(process.argv[3]), process.argv[4]);
JS

node "${WORK_DIR}/serve.mjs" "${WORK_DIR}/site" "$FIXTURE_PORT" "$FIXTURE_HOST" &
FIXTURE_PID=$!
sleep 1
curl -fsS "${FIXTURE_BASE}/feed.xml" >/dev/null || fail "the fixture server did not start"
pass "fixture podcast is being served on ${FIXTURE_BASE}"

# --- Health -----------------------------------------------------------------
HEALTH="$(curl -fsS "${BASE_URL}/api/health")" || fail "GET /api/health failed"
case "$HEALTH" in
*'"status":"ok"'*) pass "health reports ok" ;;
*) fail "health did not report ok: ${HEALTH}" ;;
esac
case "$HEALTH" in
*'"jpeg"'*) pass "the image library can encode JPEG" ;;
*) fail "no JPEG support reported: ${HEALTH}" ;;
esac

# --- Archive ----------------------------------------------------------------
CREATE="$(curl -fsS -X POST "${BASE_URL}/api/jobs" \
  -H 'content-type: application/json' \
  -d "{\"feedUrl\":\"${FIXTURE_BASE}/feed.xml\",\"baseUrl\":\"https://cdn.example.test/show/\"}")" ||
  fail "POST /api/jobs failed (is MIGRATER_ALLOW_PRIVATE_HOSTS=true?)"

JOB_ID="$(printf '%s' "$CREATE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[ -n "$JOB_ID" ] || fail "no job id in the response: ${CREATE}"
case "$CREATE" in
*'"phase":"planned"'*) pass "discovery produced a plan without downloading" ;;
*) fail "job did not reach the planned phase: ${CREATE}" ;;
esac

curl -fsS -X POST "${BASE_URL}/api/jobs/${JOB_ID}/start" >/dev/null || fail "POST start failed"

PHASE=""
for _ in $(seq 1 60); do
  JOB="$(curl -fsS "${BASE_URL}/api/jobs/${JOB_ID}")"
  PHASE="$(printf '%s' "$JOB" | sed -n 's/.*"phase":"\([^"]*\)".*/\1/p')"
  [ "$PHASE" = ready ] && break
  [ "$PHASE" = failed ] && fail "the job failed: ${JOB}"
  sleep 1
done
[ "$PHASE" = ready ] || fail "the job never became ready (last phase: ${PHASE})"
pass "the archive completed"

# Matching on the check status rather than a "failed":0 count, which also appears
# in the job's asset tally and would pass for the wrong reason.
JOB="$(curl -fsS "${BASE_URL}/api/jobs/${JOB_ID}")"
case "$JOB" in
*'"status":"fail"'*) fail "a validation check failed: ${JOB}" ;;
*) pass "every validation check passed" ;;
esac

# --- The rewritten feed -----------------------------------------------------
FEED="$(curl -fsS "${BASE_URL}/api/jobs/${JOB_ID}/feed")" || fail "GET feed failed"

case "$FEED" in
*'https://cdn.example.test/show/audio/ep001.mp3'*) pass "the enclosure points at the new host" ;;
*) fail "the enclosure was not rewritten" ;;
esac
case "$FEED" in
*'https://cdn.example.test/show/images/cover.jpg'*) pass "artwork was converted to JPEG and rewritten" ;;
*) fail "artwork was not converted and rewritten" ;;
esac
case "$FEED" in
*'length="4096"'*) pass "the enclosure length matches the archived file" ;;
*) fail "the enclosure length was not corrected" ;;
esac
case "$FEED" in
*"${FIXTURE_BASE}/audio"* | *"${FIXTURE_BASE}/images"*) fail "an asset URL still points at the old host" ;;
*) pass "no asset URL still points at the old host" ;;
esac

# --- Delivery ---------------------------------------------------------------
curl -fsS "${BASE_URL}/api/jobs/${JOB_ID}/download" -o "${WORK_DIR}/archive.zip" || fail "ZIP download failed"
[ -s "${WORK_DIR}/archive.zip" ] || fail "the ZIP is empty"

# "PK\003\004" is the local file header every ZIP begins with.
case "$(head -c 4 "${WORK_DIR}/archive.zip" | od -An -c | tr -d ' \n')" in
'PK003004') pass "the download is a ZIP archive" ;;
*) fail "the download is not a ZIP archive" ;;
esac

if command -v unzip >/dev/null 2>&1; then
  LISTING="$(unzip -l "${WORK_DIR}/archive.zip")"
  for entry in feed.xml manifest.json audio/ep001.mp3 images/cover.jpg; do
    case "$LISTING" in
    *"$entry"*) pass "the ZIP contains ${entry}" ;;
    *) fail "the ZIP is missing ${entry}" ;;
    esac
  done
else
  printf '  skip unzip is not installed; ZIP contents not inspected\n'
fi

# --- Cleanup ----------------------------------------------------------------
curl -fsS -X DELETE "${BASE_URL}/api/jobs/${JOB_ID}" >/dev/null || fail "DELETE failed"
if curl -fsS "${BASE_URL}/api/jobs/${JOB_ID}" >/dev/null 2>&1; then
  fail "the job still exists after being deleted"
fi
pass "the job and its workspace were deleted"

printf '\nSmoke test passed.\n\n'
