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
REFUSAL_LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$LOG" "$REFUSAL_LOG"
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

# 4. A server that can sign people in but is missing something sign-in needs
#    must refuse to start, and say which thing.
#
#    Everything above ran with no database, which is the case where nobody can
#    sign in and nothing needs an app id or a signing key. With a database the
#    same omissions mean sign-in fails or succeeds and is then refused, so the
#    process has to stop at boot with a message instead. The database here is a
#    placeholder that is never contacted: the check runs before anything
#    connects.
#
#    Each case runs from an empty directory with a cleared environment. The
#    server loads a `.env` from the working directory, and a developer's own
#    would supply the very variable a case is leaving out.
ROOT="$(pwd)"
REFUSAL_PORT="$((PORT + 1))"

expect_refusal() {
  local variable="$1" description="$2"
  shift 2
  local scratch refusal_log pid status
  scratch="$(mktemp -d)"
  refusal_log="${scratch}/out.log"

  ( cd "$scratch" && exec env -i PATH="$PATH" NODE_ENV=production \
      PORT="$REFUSAL_PORT" "$@" node "${ROOT}/dist/index.js" ) \
    >"$refusal_log" 2>&1 &
  pid=$!

  for _ in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done

  # `fail` prints $LOG, so what the refused process said goes there.
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    cat "$refusal_log" >>"$LOG"
    rm -rf "$scratch"
    fail "${description} kept running instead of refusing to start"
  fi

  status=0
  wait "$pid" || status=$?
  cat "$refusal_log" >>"$LOG"
  [[ "$status" != "0" ]] \
    || fail "${description} exited 0 — a process manager would read that as a clean shutdown"
  grep -q "$variable" "$refusal_log" \
    || fail "${description} refused to start but its output does not name ${variable}"
  if grep -q "smoke-db-password-must-not-print" "$refusal_log"; then
    fail "${description} printed the database password"
  fi
  rm -rf "$scratch"
  echo "✓ ${description} refuses to start"
}

DB_URL="mysql://smoke:smoke@127.0.0.1:1/smoke"
expect_refusal VITE_APP_ID "a server with a database and no VITE_APP_ID" \
  JWT_SECRET="smoke-test-secret-not-used-for-anything" DATABASE_URL="$DB_URL"
expect_refusal JWT_SECRET "a server with a database and no JWT_SECRET" \
  VITE_APP_ID="smoke-app" DATABASE_URL="$DB_URL"

#    A DATABASE_URL that cannot work is refused too: left alone, the server
#    would start as one with no database and sign-in would quietly never work.
#    The fake password must not come back out in the refusal.
BAD_DB_PW="smoke-db-password-must-not-print"
expect_refusal DATABASE_URL "a DATABASE_URL that is not a URL" \
  JWT_SECRET="smoke-test-secret-not-used-for-anything" VITE_APP_ID="smoke-app" \
  DATABASE_URL="smoke:${BAD_DB_PW}@127.0.0.1:1/smoke ok"
expect_refusal DATABASE_URL "a DATABASE_URL for another database" \
  JWT_SECRET="smoke-test-secret-not-used-for-anything" VITE_APP_ID="smoke-app" \
  DATABASE_URL="postgres://smoke:${BAD_DB_PW}@127.0.0.1:1/smoke"
expect_refusal DATABASE_URL "a DATABASE_URL that names no database" \
  JWT_SECRET="smoke-test-secret-not-used-for-anything" VITE_APP_ID="smoke-app" \
  DATABASE_URL="mysql://smoke:${BAD_DB_PW}@127.0.0.1:1"

#    A PORT that is not plain digits naming a port is refused with or without a
#    database. The lenient parse the server used binds something else in
#    silence: `1e3` is port 1, `80.5` is 80, `0` is a random port.
expect_refusal PORT "a PORT that is not a number" PORT="abc"
expect_refusal PORT "a PORT that parses to a different port" PORT="1e3"
expect_refusal PORT "a PORT of zero" PORT="0"
expect_refusal PORT "a PORT out of range" PORT="70000"

# 5. A weak JWT_SECRET is a warning, not a refusal.
#
#    A short one, or a long one that is plainly guessable, still works, and
#    changing it signs everyone out, so the server has to start and say so once.
#    The other half matters as much: a good secret must get no warning at all,
#    or the line is noise nobody reads. Same setup as above, but these must come
#    up and serve, so the check is a listening socket and what the process
#    printed on the way.
BOOT_PORT="$((PORT + 2))"

# $2 is the text the warning must contain, or "-" for none of the secret, app id
# NODE_ENV, TRUSTED_PROXY_HOPS, PUBLIC_ORIGIN, DEMO_LIMIT_SALT, S3, email, Google, OAuth or reCAPTCHA warnings. $4 is the VITE_APP_ID to run with, a
# good one unless given. $5 is the NODE_ENV, production unless given; "unset"
# leaves it out. $6 is the TRUSTED_PROXY_HOPS and $7 the PUBLIC_ORIGIN, each left
# out unless given. $8 is the DEMO_LIMIT_SALT, left out unless given. $9 is any other
# NAME=value assignments to set, space separated.
expect_boot() {
  local description="$1" expected="$2" secret="$3" app_id="${4:-smoke-app}"
  local node_env="${5:-production}" hops="${6:-}" origin="${7:-}" salt="${8:-}"
  local extra="${9:-}"
  local scratch boot_log pid up="" env_node=() env_hops=() env_origin=() env_salt=()
  local env_extra=()
  [[ "$node_env" == "unset" ]] || env_node=(NODE_ENV="$node_env")
  [[ -z "$hops" ]] || env_hops=(TRUSTED_PROXY_HOPS="$hops")
  [[ -z "$origin" ]] || env_origin=(PUBLIC_ORIGIN="$origin")
  [[ -z "$salt" ]] || env_salt=(DEMO_LIMIT_SALT="$salt")
  # shellcheck disable=SC2206  # NAME=value pairs, split on purpose; none holds a space
  [[ -z "$extra" ]] || env_extra=($extra)
  scratch="$(mktemp -d)"
  boot_log="${scratch}/out.log"

  ( cd "$scratch" && exec env -i PATH="$PATH" "${env_node[@]}" "${env_hops[@]}" "${env_origin[@]}" "${env_salt[@]}" "${env_extra[@]}" \
      PORT="$BOOT_PORT" JWT_SECRET="$secret" VITE_APP_ID="$app_id" \
      DATABASE_URL="$DB_URL" node "${ROOT}/dist/index.js" ) \
    >"$boot_log" 2>&1 &
  pid=$!

  for _ in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || break
    if curl -fsS -o /dev/null "http://127.0.0.1:${BOOT_PORT}/" 2>/dev/null; then
      up=yes
      break
    fi
    sleep 0.25
  done

  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  cat "$boot_log" >>"$LOG"

  [[ -n "$up" ]] || fail "${description} did not start"
  if [[ "$expected" == "-" ]]; then
    if grep -q 'JWT_SECRET is ' "$boot_log"; then
      fail "${description} warned about a secret that is fine"
    fi
    if grep -q 'VITE_APP_ID looks wrong' "$boot_log"; then
      fail "${description} warned about an app id that is fine"
    fi
    if grep -q 'NODE_ENV ' "$boot_log"; then
      fail "${description} warned about a NODE_ENV that is fine"
    fi
    if grep -q 'TRUSTED_PROXY_HOPS ' "$boot_log"; then
      fail "${description} warned about a TRUSTED_PROXY_HOPS that is fine"
    fi
    if grep -q 'PUBLIC_ORIGIN looks wrong' "$boot_log"; then
      fail "${description} warned about a PUBLIC_ORIGIN that is fine"
    fi
    if grep -q 'DEMO_LIMIT_SALT ' "$boot_log"; then
      fail "${description} warned about a DEMO_LIMIT_SALT that is fine"
    fi
    if grep -qE 'S3_(BUCKET|ENDPOINT|REGION) |S3_(ACCESS_KEY_ID|SECRET_ACCESS_KEY) |AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN) ' "$boot_log"; then
      fail "${description} warned about S3 settings that are fine"
    fi
    if grep -qE 'EMAIL_(API_URL|API_KEY|FROM) |Email is configured but' "$boot_log"; then
      fail "${description} warned about email settings that are fine"
    fi
    if grep -qE 'GOOGLE_CLIENT_(ID|SECRET) ' "$boot_log"; then
      fail "${description} warned about Google settings that are fine"
    fi
    if grep -q 'BUILT_IN_FORGE_API_URL ' "$boot_log"; then
      fail "${description} warned about a BUILT_IN_FORGE_API_URL that is fine"
    fi
    if grep -qE 'BUILT_IN_FORGE_MODEL |BUILT_IN_FORGE_API_URL points away' "$boot_log"; then
      fail "${description} warned about a BUILT_IN_FORGE_MODEL that is fine"
    fi
    if grep -q 'OWNER_OPEN_ID ' "$boot_log"; then
      fail "${description} warned about an OWNER_OPEN_ID that is fine"
    fi
    if grep -q 'BUILT_IN_FORGE_API_KEY ' "$boot_log"; then
      fail "${description} warned about a BUILT_IN_FORGE_API_KEY that is fine"
    fi
    if grep -q 'BUILT_IN_FORGE_TRANSCRIPTION_MODEL ' "$boot_log"; then
      fail "${description} warned about a BUILT_IN_FORGE_TRANSCRIPTION_MODEL that is fine"
    fi
    if grep -q 'OAUTH_SERVER_URL looks wrong' "$boot_log"; then
      fail "${description} warned about an OAUTH_SERVER_URL that is fine"
    fi
    if grep -qE 'RECAPTCHA_(SITE|SECRET)_KEY (looks|is set|is Google)|reCAPTCHA is off' "$boot_log"; then
      fail "${description} warned about reCAPTCHA keys that are fine"
    fi
  else
    grep -q "$expected" "$boot_log" \
      || fail "${description} started but did not warn (${expected})"
  fi
  if grep -qF "$secret" "$boot_log"; then
    fail "${description} printed the secret"
  fi
  if [[ -n "$salt" ]] && grep -qF "$salt" "$boot_log"; then
    fail "${description} printed the salt"
  fi
  rm -rf "$scratch"
  echo "✓ ${description}"
}

# A good secret, worked out and not written down: a fixed input hashed to the
# 64 hex characters `openssl rand -hex 32` would give.
GOOD_SECRET="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update("smoke").digest("hex"))')"

expect_boot "a short JWT_SECRET starts, with a warning" \
  'JWT_SECRET is only' "shortsecret"
expect_boot "a long but guessable JWT_SECRET starts, with a warning" \
  'looks guessable' "changeme-changeme-changeme-changeme"
expect_boot "a good JWT_SECRET starts, with no warning" - "$GOOD_SECRET"

# 6. A VITE_APP_ID that cannot be a real id is a warning too: only portal
#    sign-in is affected, so the server starts and says so. `undefined` is what a
#    build writes when the variable it read was empty.
expect_boot "a placeholder VITE_APP_ID starts, with a warning" \
  'VITE_APP_ID looks wrong' "$GOOD_SECRET" "undefined"

# 7. A NODE_ENV the server does not recognise is a warning too. Everything in it
#    compares against exactly "production", so an unset or misspelt value quietly
#    runs the relaxed mode: cookies, HTTPS, CSP and proxy handling included.
expect_boot "an unset NODE_ENV starts, with a warning" \
  'NODE_ENV is not set' "$GOOD_SECRET" smoke-app unset
expect_boot "a NODE_ENV of Production starts, with a warning" \
  'looks like production' "$GOOD_SECRET" smoke-app Production
expect_boot "a NODE_ENV of staging starts, with a warning" \
  'neither `production` nor' "$GOOD_SECRET" smoke-app staging

# 8. A TRUSTED_PROXY_HOPS that does not mean what it looks like is a warning. A
#    value the parse ignores falls back to the default without a word, and one
#    past what any deployment has reads into text the caller wrote.
expect_boot "a non-numeric TRUSTED_PROXY_HOPS starts, with a warning" \
  'not a whole number written in digits' "$GOOD_SECRET" smoke-app production abc
expect_boot "an implausible TRUSTED_PROXY_HOPS starts, with a warning" \
  'more proxies than most deployments have' "$GOOD_SECRET" smoke-app production 9
expect_boot "a sensible TRUSTED_PROXY_HOPS starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production 1

# 9. A PUBLIC_ORIGIN that cannot work as one is a warning. Email and Google
#    sign-in are optional, so a deploy using neither runs today; and `http://` in
#    production redirects every non-loopback visitor to the same address.
expect_boot "a PUBLIC_ORIGIN with no scheme starts, with a warning" \
  'PUBLIC_ORIGIN looks wrong' "$GOOD_SECRET" smoke-app production "" notes.example.com
expect_boot "an http PUBLIC_ORIGIN in production starts, with a warning" \
  'back to the same http address' "$GOOD_SECRET" smoke-app production "" http://notes.example.com
expect_boot "a good PUBLIC_ORIGIN starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production "" https://notes.example.com

# 10. A DEMO_LIMIT_SALT a leaked table could be reversed with is a warning. The
#     stored hash is only as private as the salt that keys it. The salt must not
#     be printed.
expect_boot "a short DEMO_LIMIT_SALT starts, with a warning" \
  'DEMO_LIMIT_SALT is only' "$GOOD_SECRET" smoke-app production "" "" shortsalt
expect_boot "a guessable DEMO_LIMIT_SALT starts, with a warning" \
  'DEMO_LIMIT_SALT looks guessable' "$GOOD_SECRET" smoke-app production "" "" \
  changeme-changeme-changeme-changeme
expect_boot "a good DEMO_LIMIT_SALT starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production "" "" "$GOOD_SECRET"

# 11. S3 settings that would fail at the first backup are a warning, found at
#     boot instead. Backup is on exactly when S3_BUCKET is set, so the other two
#     without it are worth saying out loud as well.
expect_boot "an s3:// S3_BUCKET starts, with a warning" \
  'S3_BUCKET looks wrong' "$GOOD_SECRET" smoke-app production "" "" "" \
  S3_BUCKET=s3://my-bucket
expect_boot "a schemeless S3_ENDPOINT starts, with a warning" \
  'S3_ENDPOINT is not an absolute' "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket S3_ENDPOINT=minio:9000"
expect_boot "an S3_REGION with no bucket starts, with a warning" \
  'S3_REGION is set but S3_BUCKET is not' "$GOOD_SECRET" smoke-app production "" "" "" \
  S3_REGION=eu-west-1
expect_boot "an S3_ACCESS_KEY_ID nothing reads starts, with a warning" \
  'S3_ACCESS_KEY_ID is set, but nothing reads it' "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket S3_ACCESS_KEY_ID=made-up-id"
expect_boot "a quoted AWS_ACCESS_KEY_ID starts, with a warning" \
  'AWS_ACCESS_KEY_ID looks wrong' "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket AWS_ACCESS_KEY_ID=\"made-up-id\" AWS_SECRET_ACCESS_KEY=made-up-secret"
expect_boot "a quoted AWS_SECRET_ACCESS_KEY starts, with a warning" \
  'AWS_SECRET_ACCESS_KEY looks wrong' "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket AWS_ACCESS_KEY_ID=made-up-id AWS_SECRET_ACCESS_KEY=\"made-up-secret\""
expect_boot "a temporary AWS key with no session token starts, with a warning" \
  'AWS_ACCESS_KEY_ID begins with ASIA' "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket AWS_ACCESS_KEY_ID=ASIAmade-up-id AWS_SECRET_ACCESS_KEY=made-up-secret"
expect_boot "a quoted AWS_SESSION_TOKEN starts, with a warning" \
  'AWS_SESSION_TOKEN looks wrong' "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket AWS_ACCESS_KEY_ID=ASIAmade-up-id AWS_SECRET_ACCESS_KEY=made-up-secret AWS_SESSION_TOKEN=\"made-up-token\""
expect_boot "half an AWS key pair starts, with a warning" \
  'AWS_ACCESS_KEY_ID is set but AWS_SECRET_ACCESS_KEY is not' "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket AWS_ACCESS_KEY_ID=made-up-id"
expect_boot "sensible S3 settings start, with no warning" \
  - "$GOOD_SECRET" smoke-app production "" "" "" \
  "S3_BUCKET=my-bucket S3_REGION=eu-west-1"

# 12. Email settings that fail without telling anyone. A password reset is sent
#     without being awaited and a failure is only logged, so a bad URL means
#     nobody ever gets a link and nothing says why; found at boot instead.
expect_boot "a schemeless EMAIL_API_URL starts, with a warning" \
  'EMAIL_API_URL is not an absolute' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=resend EMAIL_API_KEY=smoke-key EMAIL_FROM=notes@mail.acmenotes.dev"
expect_boot "a bare-origin EMAIL_API_URL starts, with a warning" \
  'EMAIL_API_URL has no path' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=https://api.resend.com EMAIL_API_KEY=smoke-key EMAIL_FROM=notes@mail.acmenotes.dev"
expect_boot "a partial email configuration starts, with a warning" \
  'email stays off' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=https://api.example.com/send"
expect_boot "email without PUBLIC_ORIGIN starts, with a warning" \
  'Email is configured but PUBLIC_ORIGIN is not set' "$GOOD_SECRET" smoke-app production \
  "" "" "" \
  "EMAIL_API_URL=https://api.example.com/send EMAIL_API_KEY=smoke-key EMAIL_FROM=notes@mail.acmenotes.dev"
expect_boot "an EMAIL_API_KEY with a curly quote starts, with a warning" \
  'EMAIL_API_KEY looks wrong' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=https://api.example.com/send EMAIL_API_KEY=smoke’key EMAIL_FROM=notes@mail.acmenotes.dev"
expect_boot "a quoted EMAIL_API_KEY starts, with a warning" \
  'wrapped in quotes' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=https://api.example.com/send EMAIL_API_KEY=\"smoke-key\" EMAIL_FROM=notes@mail.acmenotes.dev"
expect_boot "an EMAIL_FROM with no address starts, with a warning" \
  'EMAIL_FROM looks wrong' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=https://api.example.com/send EMAIL_API_KEY=smoke-key EMAIL_FROM=Notes"
expect_boot "an EMAIL_FROM at a reserved domain starts, with a warning" \
  'placeholder or reserved domain' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=https://api.example.com/send EMAIL_API_KEY=smoke-key EMAIL_FROM=notes@example.com"
expect_boot "a complete email configuration starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "EMAIL_API_URL=https://api.example.com/send EMAIL_API_KEY=smoke-key EMAIL_FROM=notes@mail.acmenotes.dev"

# 13. Google sign-in settings that fail late. The client ID is compared with the
#     ID token's audience for exact equality, so a stray character in it only
#     shows after Google has already signed someone in; and a missing secret or
#     public origin leaves the button off with nothing said.
# Built from pieces: GitHub's push protection matches the shape of a client ID,
# and this is a fixture.
GOOGLE_HOST=".apps.google""usercontent.com"
GOOGLE_ID="123456789012-abcdefghijklmnopqrstuvwxyz012345${GOOGLE_HOST}"
expect_boot "a GOOGLE_CLIENT_ID that is not a client ID starts, with a warning" \
  'GOOGLE_CLIENT_ID looks wrong' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "GOOGLE_CLIENT_ID=my-google-id GOOGLE_CLIENT_SECRET=GOCSPX-smokesecret"
expect_boot "a GOOGLE_CLIENT_ID without its secret starts, with a warning" \
  'GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is not' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "GOOGLE_CLIENT_ID=${GOOGLE_ID}"
expect_boot "Google settings without PUBLIC_ORIGIN start, with a warning" \
  'PUBLIC_ORIGIN is not' "$GOOD_SECRET" smoke-app production \
  "" "" "" \
  "GOOGLE_CLIENT_ID=${GOOGLE_ID} GOOGLE_CLIENT_SECRET=GOCSPX-smokesecret"
expect_boot "a quoted GOOGLE_CLIENT_SECRET starts, with a warning" \
  'GOOGLE_CLIENT_SECRET looks wrong' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "GOOGLE_CLIENT_ID=${GOOGLE_ID} GOOGLE_CLIENT_SECRET=\"GOCSPX-smokesecret\""
expect_boot "a placeholder GOOGLE_CLIENT_SECRET starts, with a warning" \
  'GOOGLE_CLIENT_SECRET looks wrong' "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "GOOGLE_CLIENT_ID=${GOOGLE_ID} GOOGLE_CLIENT_SECRET=your-client-secret"
expect_boot "a legacy-format GOOGLE_CLIENT_SECRET starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "GOOGLE_CLIENT_ID=${GOOGLE_ID} GOOGLE_CLIENT_SECRET=AbCdEfGhIjKlMnOpQrStUvWx"
expect_boot "complete Google settings start, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" https://notes.example.com "" \
  "GOOGLE_CLIENT_ID=${GOOGLE_ID} GOOGLE_CLIENT_SECRET=GOCSPX-smokesecret"

# 14. An OAUTH_SERVER_URL that cannot work as a base URL. axios rejects a value
#     with no scheme on the first call, so every portal sign-in would fail at the
#     token exchange; http:// to a real host sends the code and token in clear.
#     The server already logs when it is unset, so the good case here is a URL.
expect_boot "a schemeless OAUTH_SERVER_URL starts, with a warning" \
  'OAUTH_SERVER_URL looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "OAUTH_SERVER_URL=oauth.example.com"
expect_boot "an http OAUTH_SERVER_URL starts, with a warning" \
  'cross the network in clear text' "$GOOD_SECRET" smoke-app production \
  "" "" "" "OAUTH_SERVER_URL=http://oauth.example.com"
expect_boot "a good OAUTH_SERVER_URL starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" "" "" "OAUTH_SERVER_URL=https://oauth.example.com"

# 14b. A BUILT_IN_FORGE_API_URL that forgeUrl() cannot turn into a request. Unset
#      is the supported default and stays silent.
expect_boot "a schemeless BUILT_IN_FORGE_API_URL starts, with a warning" \
  'BUILT_IN_FORGE_API_URL is not an absolute http(s) URL' "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_API_URL=api.example.com"
expect_boot "a BUILT_IN_FORGE_API_URL ending in /v1 starts, with a warning" \
  'already ends in /v1' "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_API_URL=https://api.example.com/v1"
expect_boot "a good BUILT_IN_FORGE_API_URL starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_API_URL=https://api.example.com BUILT_IN_FORGE_MODEL=gpt-4o"

# 14e. A BUILT_IN_FORGE_MODEL the provider would reject, and the half-configured
#      state forge.ts describes: another provider's URL with the default model.
expect_boot "a BUILT_IN_FORGE_MODEL with a space starts, with a warning" \
  'BUILT_IN_FORGE_MODEL looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_MODEL=<gpt-4o>"
expect_boot "another provider's URL with no model starts, with a warning" \
  'points away from the built-in provider' "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_API_URL=https://api.example.com"
expect_boot "another provider's URL with a model starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_API_URL=https://api.example.com BUILT_IN_FORGE_MODEL=gpt-4o"

# 14c. An OWNER_OPEN_ID that matches no account promotes nobody and says nothing.
#      Unset is the supported default (no owner) and stays silent.
expect_boot "an OWNER_OPEN_ID that is an address starts, with a warning" \
  'OWNER_OPEN_ID looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "OWNER_OPEN_ID=me@example.com"
expect_boot "an email: OWNER_OPEN_ID with no UUID starts, with a warning" \
  'not followed by the UUID' "$GOOD_SECRET" smoke-app production \
  "" "" "" "OWNER_OPEN_ID=email:me-at-example"
expect_boot "a well-formed OWNER_OPEN_ID starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" "" "" "OWNER_OPEN_ID=email:3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c"

# 14d. A BUILT_IN_FORGE_API_KEY that cannot be sent as a Bearer token. Unset is
#      the supported off switch for AI and stays silent.
expect_boot "a quoted BUILT_IN_FORGE_API_KEY starts, with a warning" \
  'BUILT_IN_FORGE_API_KEY looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" 'BUILT_IN_FORGE_API_KEY="made-up-key"'
expect_boot "a placeholder BUILT_IN_FORGE_API_KEY starts, with a warning" \
  'is a placeholder name' "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_API_KEY=changeme"
expect_boot "a good BUILT_IN_FORGE_API_KEY starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_API_KEY=made-up-key-123"

# 14f. A BUILT_IN_FORGE_TRANSCRIPTION_MODEL the provider would reject. Unset
#      means whisper-1 and stays silent.
expect_boot "a BUILT_IN_FORGE_TRANSCRIPTION_MODEL with angle brackets starts, with a warning" \
  'BUILT_IN_FORGE_TRANSCRIPTION_MODEL looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_TRANSCRIPTION_MODEL=<whisper>"
expect_boot "a good BUILT_IN_FORGE_TRANSCRIPTION_MODEL starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" "" "" "BUILT_IN_FORGE_TRANSCRIPTION_MODEL=whisper-large-v3"

# 15. reCAPTCHA keys. With one key the check is silently off; with a secret
#     Google rejects it fails closed and locks everyone out of email sign-in.
#     The keys here are made up and neither is printed.
RC_SITE="smokesitekey_$(printf 'a%.0s' $(seq 1 27))"
RC_SECRET="smokesecretkey_$(printf 'b%.0s' $(seq 1 25))"
expect_boot "a reCAPTCHA secret with no site key starts, with a warning" \
  'reCAPTCHA is off' "$GOOD_SECRET" smoke-app production \
  "" "" "" "RECAPTCHA_SECRET_KEY=${RC_SECRET}"
expect_boot "a quoted reCAPTCHA secret starts, with a warning" \
  'RECAPTCHA_SECRET_KEY looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "RECAPTCHA_SITE_KEY=${RC_SITE} RECAPTCHA_SECRET_KEY=\"${RC_SECRET}\""
expect_boot "a placeholder reCAPTCHA secret starts, with a warning" \
  'RECAPTCHA_SECRET_KEY looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "RECAPTCHA_SITE_KEY=${RC_SITE} RECAPTCHA_SECRET_KEY=your-secret-key"
expect_boot "a quoted reCAPTCHA site key starts, with a warning" \
  'RECAPTCHA_SITE_KEY looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "RECAPTCHA_SITE_KEY=\"${RC_SITE}\" RECAPTCHA_SECRET_KEY=${RC_SECRET}"
expect_boot "a placeholder reCAPTCHA site key starts, with a warning" \
  'RECAPTCHA_SITE_KEY looks wrong' "$GOOD_SECRET" smoke-app production \
  "" "" "" "RECAPTCHA_SITE_KEY=your-site-key RECAPTCHA_SECRET_KEY=${RC_SECRET}"
expect_boot "a pair of reCAPTCHA keys starts, with no warning" \
  - "$GOOD_SECRET" smoke-app production \
  "" "" "" "RECAPTCHA_SITE_KEY=${RC_SITE} RECAPTCHA_SECRET_KEY=${RC_SECRET}"

echo "Smoke check passed."
