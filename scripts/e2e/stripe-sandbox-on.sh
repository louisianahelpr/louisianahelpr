#!/bin/bash
# Switches the edge functions to Stripe TEST mode for the E2E window.
#
# Prompts for your sk_test key (Stripe dashboard -> test mode -> API keys),
# makes the test-mode webhook endpoint aimed at the live webhook URL, sets both
# Supabase secrets, and writes nothing to disk except the endpoint id needed by
# stripe-sandbox-off.sh. Run by the OWNER. TEST MODE ONLY — the key is asserted
# to start with sk_test_ below, so this can never touch live.
#
# Issue #1586: the old version POSTed a brand-new endpoint on every run and
# never looked for a prior one, stashing the id in /tmp — which does not
# reliably survive on this machine. A second run therefore left the first
# endpoint alive and enabled on the SAME url, with its signing secret still in
# the comma-separated STRIPE_WEBHOOK_SECRET the edge function accepts. Both
# copies of every event verified, so test mode delivered every webhook twice.
#
# Two changes make that unrepresentable:
#   1. We DELETE every pre-existing endpoint on this url before creating one.
#      Reuse is not an option: Stripe returns `secret` only at creation time, so
#      an endpoint we did not just create is one whose signing secret we cannot
#      know. Delete-then-create makes "exactly one enabled endpoint on this url,
#      whose secret we hold" true by construction, and makes the script safe to
#      run twice in a row.
#   2. The id file lives under $HOME, not /tmp.
#
# The event list is generated from the EVENT_HANDLERS dispatch map in
# supabase/functions/stripe-webhook/index.ts (see scripts/stripe-webhook-events.mjs),
# never hardcoded here — the old hardcoded list had already drifted to 8 stale
# entries. scripts/check-stripe-webhook-events.mjs guards both properties in CI.
set -euo pipefail

REF=fncmgoasalhdgfwzhsqa
WEBHOOK_URL="https://$REF.supabase.co/functions/v1/stripe-webhook"
ID_FILE="$HOME/.lh-stripe-test-webhook-id"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

read -r -s -p "Paste your sk_test key: " SK; echo
case "$SK" in
  sk_test_*|rk_test_*) ;;
  *) echo "REFUSED: that is not a test-mode key. Stripe stays in sandbox until launch." >&2; exit 1 ;;
esac

# Generated from the handler map, one -d argument per event.
EVENT_ARGS=()
EVENT_COUNT=0
while IFS= read -r ev; do
  [ -z "$ev" ] && continue
  EVENT_ARGS+=(-d "enabled_events[]=$ev")
  EVENT_COUNT=$((EVENT_COUNT + 1))
done < <(node "$REPO_ROOT/scripts/stripe-webhook-events.mjs")
if [ "$EVENT_COUNT" -eq 0 ]; then
  echo "REFUSED: derived an empty event list from the handler map." >&2; exit 1
fi
echo "Subscribing to $EVENT_COUNT events derived from EVENT_HANDLERS."

# --- 1. Remove every pre-existing endpoint on this url (enabled or disabled).
EXISTING=$(curl -sf -u "$SK:" "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
  | WEBHOOK_URL="$WEBHOOK_URL" python3 -c '
import json, os, sys
url = os.environ["WEBHOOK_URL"]
d = json.load(sys.stdin)
# livemode is belt-and-braces: a test key can only list test endpoints.
print("\n".join(e["id"] for e in d["data"] if e["url"] == url and not e["livemode"]))
')
if [ -n "$EXISTING" ]; then
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    echo "Deleting pre-existing test endpoint $id on $WEBHOOK_URL"
    curl -sf -u "$SK:" -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$id" >/dev/null
  done <<< "$EXISTING"
fi

# --- 2. Create exactly one.
RESP=$(curl -sf -u "$SK:" -X POST https://api.stripe.com/v1/webhook_endpoints \
  -d url="$WEBHOOK_URL" "${EVENT_ARGS[@]}")
# The signing secret is read into a variable and handed straight to `supabase
# secrets set`. It is never echoed, logged, or written to disk.
WHSEC=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['secret'])")
WHID=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

umask 077
printf '%s\n' "$WHID" > "$ID_FILE"
echo "Created test endpoint $WHID (id recorded in $ID_FILE)"

# --- 3. Confirm the invariant held, so a partial failure above cannot pass.
REMAINING=$(curl -sf -u "$SK:" "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
  | WEBHOOK_URL="$WEBHOOK_URL" python3 -c '
import json, os, sys
url = os.environ["WEBHOOK_URL"]
d = json.load(sys.stdin)
print(sum(1 for e in d["data"] if e["url"] == url and e["status"] == "enabled"))
')
if [ "$REMAINING" != "1" ]; then
  echo "REFUSED: $REMAINING enabled endpoints on $WEBHOOK_URL after create; expected 1. Secrets NOT changed — fix in the Stripe dashboard (test mode) and re-run." >&2
  exit 1
fi

supabase secrets set STRIPE_SECRET_KEY="$SK" STRIPE_WEBHOOK_SECRET="$WHSEC" --project-ref $REF
echo "SANDBOX ON. Restore with scripts/e2e/stripe-sandbox-off.sh (needs your sk_live + live whsec)."
