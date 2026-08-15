#!/usr/bin/env bash
#
# Boot the built server and check it actually serves the app.
#
# This exists because of a specific miss: an express 5 upgrade passed the
# type-check, all the tests and the production build, and still could not
# start — path-to-regexp v8 rejected the `app.use("*")` patterns at boot. None
# of the other checks run the server, so none of them could have caught it.
#
# The bar here is deliberately low and deliberately end-to-end: build output on
# disk, a real listening process, real HTTP responses. No database, no API keys.
# Anything that needs those belongs in the test suite, not in a smoke check.

set -euo pipefail

PORT="${SMOKE_PORT:-5099}"
BASE="http://127.0.0.1:${PORT}"
LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

fail() {
  echo "✗ $*" >&2
  echo "--- server output ---" >&2
  cat "$LOG" >&2
  exit 1
}

if [[ ! -f dist/index.js ]]; then
  echo "dist/index.js is missing — run \`pnpm build\` first." >&2
  exit 1
fi

# JWT_SECRET is the only variable read at import time. A throwaway value is
# right here: this check is about whether the process starts and serves, not
# about whether real credentials work.
echo "Starting server on port ${PORT}…"
NODE_ENV=production \
PORT="$PORT" \
JWT_SECRET="smoke-test-secret-not-used-for-anything" \
  node dist/index.js >"$LOG" 2>&1 &
SERVER_PID=$!

# Wait for a listening socket, but give up the moment the process dies rather
# than burning the full timeout on something that already exited. The express 5
# failure surfaced exactly this way: startServer() rejected, the catch logged
# it, and node exited 0 with nothing listening.
for _ in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "server exited before it accepted a connection"
  fi
  if curl -fsS -o /dev/null "${BASE}/" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

kill -0 "$SERVER_PID" 2>/dev/null || fail "server exited before it accepted a connection"

# 1. The app shell. A browser asking for a page must get the SPA back.
page="$(curl -fsS -H 'Accept: text/html' "${BASE}/login")" \
  || fail "GET /login did not return a successful response"
grep -q '<div id="root"></div>' <<<"$page" \
  || fail "GET /login returned a body that is not the app shell"
echo "✓ GET /login serves the app shell"

# 2. A hashed asset, taken from the index.html the build just wrote. This is
#    less about the fallback than about the two halves of the build agreeing:
#    if the client bundle landed somewhere the server does not serve from, the
#    page loads and then dies on its own script tag.
asset="$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' dist/public/index.html | head -1)"
[[ -n "$asset" ]] || fail "could not find a hashed script tag in dist/public/index.html"

asset_type="$(curl -fsS -o /dev/null -w '%{content_type}' "${BASE}${asset}")" \
  || fail "GET ${asset} did not return a successful response"
grep -qi 'javascript' <<<"$asset_type" \
  || fail "GET ${asset} returned content-type '${asset_type}', not JavaScript"
echo "✓ GET ${asset} serves JavaScript"

# 3. Paths that do not exist must 404, not fall through to the app shell.
#
#    This is the check that pins down how the SPA fallback decides. curl sends
#    `Accept: */*`, and so does a browser fetching a script — `*/*` matches
#    text/html, so the obvious `req.accepts("html")` gate returns true for both
#    and hands out index.html with a 200 for anything at all. A stale script tag
#    then gets HTML back and the page comes up blank; an API typo surfaces in the
#    client as a JSON parse error rather than as the 404 it is.
#
#    The fallback reads the Accept header explicitly instead. These two requests
#    are what holds it to that: swap the condition back and both return 200.
for path in /api/definitely-not-a-route /assets/definitely-not-an-asset.js; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}${path}")"
  [[ "$status" == "404" ]] \
    || fail "GET ${path} returned ${status}, expected 404 — the SPA fallback is answering requests that are not navigations"
done
echo "✓ unknown paths 404 instead of returning the app shell"

echo "Smoke check passed."
