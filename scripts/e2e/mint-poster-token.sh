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
# and say what actually happened.
set -uo pipefail

URL="${SUPABASE_URL:-https://fncmgoasalhdgfwzhsqa.supabase.co}"
KEY="${SUPABASE_ANON_KEY:-sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP}"
: "${POSTER_EMAIL:?POSTER_EMAIL is not set — the secret did not reach this step}"
: "${POSTER_PASSWORD:?POSTER_PASSWORD is not set — the secret did not reach this step}"

PAYLOAD=$(jq -nc --arg e "$POSTER_EMAIL" --arg p "$POSTER_PASSWORD" '{email:$e,password:$p}')

for attempt in 1 2 3; do
  RESP=$(curl -sS --max-time 20 -w $'\n%{http_code}' -X POST \
    "$URL/auth/v1/token?grant_type=password" \
    -H "apikey: $KEY" -H "Content-Type: application/json" \
    -d "$PAYLOAD" 2>/tmp/mint-curl-err) || RESP=$'\n000'
  CODE="${RESP##*$'\n'}"
  BODY="${RESP%$'\n'*}"
  TOKEN=$(printf '%s' "$BODY" | jq -r '.access_token // empty' 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    [ "$attempt" -gt 1 ] && echo "token minted on attempt $attempt" >&2
    printf '%s' "$TOKEN"
    exit 0
  fi
  if [ "$CODE" = "000" ]; then
    DETAIL="no HTTP response — $(head -c 200 /tmp/mint-curl-err 2>/dev/null || echo 'curl failed')"
  else
    DETAIL=$(printf '%s' "$BODY" | jq -c '{error, error_code, code, msg, message}' 2>/dev/null \
      || printf 'non-JSON body, %s bytes' "${#BODY}")
  fi
  echo "::warning::poster token mint attempt $attempt/3 — HTTP $CODE — $DETAIL" >&2
  # 400/401/422 is a credentials problem and will not improve on retry.
  case "$CODE" in 400|401|403|422) break ;; esac
  sleep $((attempt * 5))
done
exit 1
