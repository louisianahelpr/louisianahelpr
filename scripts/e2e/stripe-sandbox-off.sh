#!/bin/bash
# Restores LIVE Stripe mode after the E2E window and deletes the test webhook.
# Prompts for your sk_live key and the LIVE webhook signing secret (Stripe
# dashboard -> Developers -> Webhooks -> the live endpoint -> signing secret).
set -euo pipefail
REF=fncmgoasalhdgfwzhsqa
read -r -s -p "Paste your sk_live key: " SK; echo
read -r -s -p "Paste the LIVE webhook signing secret (whsec_...): " WHSEC; echo
supabase secrets set STRIPE_SECRET_KEY="$SK" STRIPE_WEBHOOK_SECRET="$WHSEC" --project-ref $REF
if [ -f /tmp/lh-test-webhook-id.txt ]; then
  read -r -s -p "Paste sk_test once more (to delete the test webhook): " SKT; echo
  curl -s -u "$SKT:" -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$(cat /tmp/lh-test-webhook-id.txt)" >/dev/null && echo "test webhook deleted"
fi
echo "LIVE restored."
