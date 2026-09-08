#!/usr/bin/env bash
# Launch-position guard for build-time feature flags.
#
# Some flags are deliberately in a TESTING position while the app is being
# built out, and must be flipped before the marketplace is opened to the
# public. A flag like that is easy to add and easy to forget, and forgetting
# SHOW_SEED_JOBS_PUBLICLY specifically would launch the public jobs feed full
# of fixture listings (measured 2026-08-25: 12 of 13 open jobs were fixtures).
#
# This is opt-in rather than always-on: a normal `npm run build` during
# development must not fail because a testing flag is in its testing position.
# Set HELPR_LAUNCH=1 (in the release build, or run `npm run check:launch`) to
# assert every flag is in its LAUNCH position.
#
# Adding a flag: add one check below. Keep the failure message actionable —
# it should name the file, the required value, and why.
set -euo pipefail

if [[ "${HELPR_LAUNCH:-0}" != "1" ]]; then
  echo "check-launch-flags: skipped (set HELPR_LAUNCH=1 to enforce)"
  exit 0
fi

fail=0
note() { printf '  ✗ %s\n' "$1"; fail=1; }

# --- Fixture jobs must be hidden at launch -----------------------------------
# The switch lives in the DATABASE: `platform_settings.feature_flags ->>
# 'seed_jobs_hidden_publicly'`, read by every guest surface through the
# `public.seed_jobs_hidden_publicly()` function. This block used to grep
# `src/config/showSeedJobs.ts` for `SHOW_SEED_JOBS_PUBLICLY = true`, a constant
# retired when the switch moved into the database — so it reported "all launch
# flags are in their launch position" no matter what the flag said, and
# docs/LAUNCH_CHECKLIST.md still presented it as the automated half. A guard
# that greps for a name nothing defines can only ever pass. Ask the database.
env_file=".env"
url=$(grep -E '^VITE_SUPABASE_URL=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"')
key=$(grep -E '^VITE_SUPABASE_PUBLISHABLE_KEY=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"')
if [[ -z "$url" || -z "$key" ]]; then
  note ".env is missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — cannot read the seed switch."
else
  hidden=$(curl -s -X POST "$url/rest/v1/rpc/seed_jobs_hidden_publicly" \
    -H "apikey: $key" -H "Authorization: Bearer $key" -H "Content-Type: application/json" -d '{}')
  case "$hidden" in
    true) ;;
    false) note "seed_jobs_hidden_publicly() is FALSE on ${url#https://} — the public marketplace still shows fixture jobs. Run: npm run launch:go -- --on" ;;
    *) note "seed_jobs_hidden_publicly() could not be read (got: ${hidden:0:120}) — refusing to call the flag clean." ;;
  esac
fi

if [[ "$fail" == "1" ]]; then
  echo
  echo "check-launch-flags: FAILED — see docs/LAUNCH_CHECKLIST.md"
  exit 1
fi

echo "check-launch-flags: all launch flags are in their launch position"
