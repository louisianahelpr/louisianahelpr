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
# SWEEP_PHASE (required): `pre` before a suite, `teardown` after it. A helper
# mint that fails in a TEARDOWN fails the step: the helper secrets were passed,
# so a poster-only sweep there is a sweep that could not do its job, and it
# used to stay green (lh-money-escrow review M1, 2026-09-25). In a PRE-sweep it
# degrades to the poster-only deferral and says so, so it never blocks the
# suite; the same job's teardown runs `if: always()` and fails instead.
#
# E2E_STRIPE_MODE (from the repo variable, passed through untouched): the
# sweeper settles forward only when it is "test" (see the sweeper's header).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${POSTER_ACCESS_TOKEN:?POSTER_ACCESS_TOKEN is not set — mint the poster token first}"
: "${SWEEP_PHASE:?SWEEP_PHASE is not set — pre or teardown}"
case "$SWEEP_PHASE" in
  pre|teardown) ;;
  *) echo "::error title=Sweep phase unknown::SWEEP_PHASE must be pre or teardown, got '$SWEEP_PHASE'"; exit 1 ;;
esac

HTOKEN=""
if [ -n "${HELPER_EMAIL:-}" ] && [ -n "${HELPER_PASSWORD:-}" ]; then
  if ! HTOKEN=$(POSTER_EMAIL="$HELPER_EMAIL" POSTER_PASSWORD="$HELPER_PASSWORD" MINT_LABEL=helper bash "$HERE/mint-poster-token.sh"); then
    if [ "$SWEEP_PHASE" = "teardown" ]; then
      echo "::error title=Teardown sweep could not hold the helper seat::could not mint a helper token although HELPER_EMAIL/_PASSWORD were passed; hired+funded leftovers cannot be settled forward (Q52: an unwind that did not run is not green)"
      exit 1
    fi
    echo "::warning title=Sweep holds only the poster seat::could not mint a helper token; hired+funded leftovers are deferred, not settled forward (the teardown sweep fails on this)"
    HTOKEN=""
  fi
else
  echo "::warning title=Sweep holds only the poster seat::HELPER_EMAIL/_PASSWORD were not passed to this step; hired+funded leftovers are deferred, not settled forward"
fi

HELPER_ACCESS_TOKEN="$HTOKEN" SWEEP_PHASE="$SWEEP_PHASE" exec node "$HERE/prod-lifecycle-sweeper.mjs" "$@"
