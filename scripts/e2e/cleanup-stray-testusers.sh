#!/bin/bash
# Removes the two accidental auth users created during the 2026-08-24 id mixup
# (eli.seed.helper@ = random-id fallback; renames the fresh test helper so two
# profiles don't both read "Eli Thibodeaux"). Seed data untouched.
set -euo pipefail
REF=fncmgoasalhdgfwzhsqa
KEY=$(supabase projects api-keys --project-ref $REF -o json | python3 -c "import json,sys;print(next(k['api_key'] for k in json.load(sys.stdin) if k.get('name')=='service_role'))")
curl -s -o /dev/null -w "delete stray: %{http_code}\n" -X DELETE "https://$REF.supabase.co/auth/v1/admin/users/91c9cf9f-05a5-4cfe-9678-0b2ffeb47c92" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
