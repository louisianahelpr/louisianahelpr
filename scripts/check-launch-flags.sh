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

# --- SHOW_SEED_JOBS_PUBLICLY must be false at launch -------------------------
# Fixture rows are flagged `is_seed` in the database; this switch is what hides
# them from guest-facing surfaces. Admin aggregates already exclude them
# unconditionally, so this is purely about the public marketplace.
seed_file="src/config/showSeedJobs.ts"
if [[ -f "$seed_file" ]]; then
  if grep -qE '^export const SHOW_SEED_JOBS_PUBLICLY *= *true' "$seed_file"; then
    note "$seed_file: SHOW_SEED_JOBS_PUBLICLY is true — the public jobs feed would show fixture listings. Set it to false."
  fi
else
  note "$seed_file is missing — the seed-visibility switch moved or was deleted; update this guard."
fi

if [[ "$fail" == "1" ]]; then
  echo
  echo "check-launch-flags: FAILED — see docs/LAUNCH_CHECKLIST.md"
  exit 1
fi

echo "check-launch-flags: all launch flags are in their launch position"
