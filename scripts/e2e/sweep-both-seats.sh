#!/usr/bin/env bash
# Run prod-lifecycle-sweeper.mjs holding BOTH test seats.
#
# The caller mints the poster token itself (its own Q52 error text) and passes
# POSTER_ACCESS_TOKEN, SUPABASE_URL and SUPABASE_ANON_KEY. This adds the helper
# seat from HELPER_EMAIL / HELPER_PASSWORD, because a hired+funded leftover can
# only be settled FORWARD by both parties (arrival and Done are the Helpr's).
#
# WHY (nightly-red #1719, e2e-journeys run 36164148002, 2026-09-25): the
# sweeper has settled forward when given HELPER_ACCESS_TOKEN since 2026-09-22,
# but no workflow ever passed one, so ten hired+funded test jobs sat in escrow,
# seven past 48h. Every workflow step that sweeps goes through this file
# (src/test/sweeperHoldsBothSeats.test.ts).
#
# A helper mint that fails degrades to the poster-only deferral and says so;
# the sweeper's own 48h warning still reports any row left behind.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${POSTER_ACCESS_TOKEN:?POSTER_ACCESS_TOKEN is not set — mint the poster token first}"

HTOKEN=""
if [ -n "${HELPER_EMAIL:-}" ] && [ -n "${HELPER_PASSWORD:-}" ]; then
  if ! HTOKEN=$(POSTER_EMAIL="$HELPER_EMAIL" POSTER_PASSWORD="$HELPER_PASSWORD" MINT_LABEL=helper bash "$HERE/mint-poster-token.sh"); then
    echo "::warning title=Sweep holds only the poster seat::could not mint a helper token; hired+funded leftovers are deferred, not settled forward"
    HTOKEN=""
  fi
else
  echo "::warning title=Sweep holds only the poster seat::HELPER_EMAIL/_PASSWORD were not passed to this step; hired+funded leftovers are deferred, not settled forward"
fi

HELPER_ACCESS_TOKEN="$HTOKEN" exec node "$HERE/prod-lifecycle-sweeper.mjs" "$@"
