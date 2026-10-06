#!/usr/bin/env bash
# Mint a short-lived poster access token for the prod lifecycle sweeper.
#
# Prints the token on stdout and NOTHING else there. Diagnostics go to stderr.
# The password is never echoed, and neither is the token.
#
# WHY THIS FILE EXISTS. The same mint was inlined twice in
# .github/workflows/e2e-real-backend.yml as
#
#     TOKEN=$(curl -s … | jq -r '.access_token // empty')
#     test -n "$TOKEN" || echo "could not mint a poster token — check PLAYWRIGHT_POSTER_EMAIL / _PASSWORD"
#
# On 2026-09-12 the money loop failed there, and that message sent the
# investigation after the password. The password was fine: auth logged that
# account's password sign-ins as HTTP 200 throughout that window and recorded
# no refused /token request at all. `curl -s` swallows a network failure,
# `// empty` swallows an error body, and the only thing left to print was a
# guess. A step that can only guess sends the next person the wrong way.
#
# So: capture the HTTP status and the error body, retry transient failures,
# and say what actually happened. (The helper below carries GoTrue's status
# and body in its error.)
set -uo pipefail

# MINT_LABEL names the seat in the diagnostics. The same mint serves the helper
# seat (POSTER_EMAIL set to the helper's) for the sweeper's settle-forward,
# which needs both parties (prod-lifecycle-sweeper.mjs).
LABEL="${MINT_LABEL:-poster}"

# THE MINT (docs/OPEN.md Q1314). This used to be an anon password grant
# (POST /auth/v1/token?grant_type=password with POSTER_PASSWORD). Once Supabase
# Auth CAPTCHA is on, GoTrue refuses those without a Turnstile token, so the
# token is minted with the service role by the shared helper instead
# (scripts/lib/adminSession.mjs: admin generate_link + verify, both outside
# GoTrue's captcha middleware). The key comes from SUPABASE_SERVICE_ROLE_KEY or
# the checkout's .env, which the workflow provides after its build.
export SUPABASE_URL="${SUPABASE_URL:-https://fncmgoasalhdgfwzhsqa.supabase.co}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP}"
: "${POSTER_EMAIL:?POSTER_EMAIL is not set — the secret did not reach this step}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

for attempt in 1 2 3; do
  # The helper prints the access token on stdout and nothing else; its own
  # error (GoTrue's status and body, never a secret) goes to stderr.
  TOKEN=$(node "$HERE/../lib/adminSession.mjs" "$POSTER_EMAIL" 2>"$ERR") || TOKEN=""
  if [ -n "$TOKEN" ]; then
    [ "$attempt" -gt 1 ] && echo "token minted on attempt $attempt" >&2
    printf '%s' "$TOKEN"
    exit 0
  fi
  DETAIL=$(head -c 400 "$ERR" 2>/dev/null || echo "no diagnostic")
  echo "::warning::$LABEL token mint attempt $attempt/3 — $DETAIL" >&2
  # No key, no account, or a refused key will not improve on retry.
  case "$DETAIL" in
    *"no service-role key"*|*"HTTP 401"*|*"HTTP 403"*|*"HTTP 404"*|*"HTTP 422"*) break ;;
  esac
  sleep $((attempt * 5))
done
exit 1
