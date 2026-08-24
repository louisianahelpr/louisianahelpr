#!/bin/bash
# Switches the edge functions to Stripe TEST mode for the E2E window.
# Prompts for your sk_test key (Stripe dashboard -> test mode -> API keys),
# creates a test-mode webhook endpoint aimed at the live webhook URL, sets
# both Supabase secrets, and writes nothing to disk except the endpoint id
# needed by stripe-sandbox-off.sh. Run by the OWNER.
set -euo pipefail
REF=fncmgoasalhdgfwzhsqa
WEBHOOK_URL="https://$REF.supabase.co/functions/v1/stripe-webhook"
read -r -s -p "Paste your sk_test key: " SK; echo
RESP=$(curl -s -u "$SK:" -X POST https://api.stripe.com/v1/webhook_endpoints \
  -d url="$WEBHOOK_URL" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=payment_intent.succeeded" \
  -d "enabled_events[]=payment_intent.payment_failed" \
  -d "enabled_events[]=transfer.created" \
  -d "enabled_events[]=customer.subscription.created" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=invoice.paid")
WHSEC=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['secret'])")
echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])" > /tmp/lh-test-webhook-id.txt
supabase secrets set STRIPE_SECRET_KEY="$SK" STRIPE_WEBHOOK_SECRET="$WHSEC" --project-ref $REF
echo "SANDBOX ON. Restore with scripts/e2e/stripe-sandbox-off.sh (needs your sk_live + live whsec)."
