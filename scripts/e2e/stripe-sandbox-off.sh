#!/bin/bash
# Restores LIVE Stripe mode after the E2E window and deletes the test webhook.
# Prompts for your sk_live key and the LIVE webhook signing secret (Stripe
# dashboard -> Developers -> Webhooks -> the live endpoint -> signing secret).
#
# Issue #1586: the test endpoint id used to be read from /tmp, which does not
# reliably survive on this machine — so the delete below silently never ran and
# the endpoint was left alive for the next sandbox-on to duplicate. The id now
# lives under $HOME, and if it is missing we still sweep the url by hand rather
# than skipping quietly.
set -euo pipefail

REF=fncmgoasalhdgfwzhsqa
WEBHOOK_URL="https://$REF.supabase.co/functions/v1/stripe-webhook"
ID_FILE="$HOME/.lh-stripe-test-webhook-id"

read -r -s -p "Paste your sk_live key: " SK; echo
read -r -s -p "Paste the LIVE webhook signing secret (whsec_...): " WHSEC; echo
supabase secrets set STRIPE_SECRET_KEY="$SK" STRIPE_WEBHOOK_SECRET="$WHSEC" --project-ref $REF

# Cleaning up the test endpoint needs the TEST key: a live key cannot see or
# delete test-mode objects.
read -r -s -p "Paste sk_test once more (to delete the test webhook; blank to skip): " SKT; echo
if [ -n "$SKT" ]; then
  case "$SKT" in
    sk_test_*|rk_test_*) ;;
    *) echo "REFUSED: that is not a test-mode key; not deleting anything." >&2; exit 1 ;;
  esac
  # Delete every test endpoint on the url, not just the recorded id — the id
  # file is a convenience, never the authority on what exists.
  IDS=$(curl -sf -u "$SKT:" "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
    | WEBHOOK_URL="$WEBHOOK_URL" python3 -c '
import json, os, sys
url = os.environ["WEBHOOK_URL"]
d = json.load(sys.stdin)
print("\n".join(e["id"] for e in d["data"] if e["url"] == url and not e["livemode"]))
')
  if [ -z "$IDS" ]; then
    echo "No test-mode endpoints on $WEBHOOK_URL — nothing to delete."
  else
    while IFS= read -r id; do
      [ -z "$id" ] && continue
      curl -sf -u "$SKT:" -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$id" >/dev/null
      echo "test webhook $id deleted"
    done <<< "$IDS"
  fi
  rm -f "$ID_FILE"
else
  if [ -f "$ID_FILE" ]; then
    echo "WARNING: test endpoint $(cat "$ID_FILE") on $WEBHOOK_URL was NOT deleted (no sk_test given)." >&2
    echo "         Leaving it enabled is issue #1586: the next sandbox-on run will find and remove it, but until then it is live." >&2
  fi
fi
echo "LIVE restored."
