#!/bin/bash
# Creates an auth user for the seeded "Eli Thibodeaux" test profile (idempotent)
# and prints a one-time magic-link so Claude can drive the helper side of the
# two-role E2E. Run by the OWNER — Claude is not permitted to handle the keys.
set -euo pipefail
REF=fncmgoasalhdgfwzhsqa
ELI_ID=11111111-1111-1111-1111-111111111104
ELI_EMAIL=eli.seed.helper@louisianahelpr.com
KEY=$(supabase projects api-keys --project-ref $REF -o json | python3 -c "import json,sys;print(next(k['api_key'] for k in json.load(sys.stdin) if k.get('name')=='service_role'))")
# 1. auth user bound to the existing profile id (409 = already exists, fine)
curl -s -o /dev/null -w "create-user: %{http_code}\n" -X POST "https://$REF.supabase.co/auth/v1/admin/users" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"id\":\"$ELI_ID\",\"email\":\"$ELI_EMAIL\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"Eli Thibodeaux\"}}"
# 2. magic link, redirected to the second dev origin (127.0.0.1 = separate session from localhost)
curl -s -X POST "https://$REF.supabase.co/auth/v1/admin/generate_link" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"$ELI_EMAIL\",\"options\":{\"redirect_to\":\"http://127.0.0.1:8080/dashboard\"}}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['action_link'])" > /tmp/lh-helper-magiclink.txt
echo "magic link written to /tmp/lh-helper-magiclink.txt"
