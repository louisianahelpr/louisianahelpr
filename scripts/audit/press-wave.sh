#!/usr/bin/env bash
# One WAVE of press-every-control: the given shards (of 12) side by side on this
# runner, each in its own output and request-meter directory, prefixed logs.
#
# Why two shards per job: each press LEG job (press-every-control.yml, legs
# 1-6) holds the job-level `prod-lifecycle-shared-accounts` lock for its own
# two shards only, under an hour (src/test/sharedAccountLockJobsAreShort.test.ts),
# with its own snapshot before and restore + sweep after (Q272), so other
# suites can take the accounts between legs. Two at a time is the Q317 load
# ceiling (the old matrix ran `max-parallel: 2`).
#
#   bash scripts/audit/press-wave.sh 1 2
#
# Env passed through to each shard: everything press-every-control.mjs reads
# (BASE, WIDTH, ROUTES, PERSONAS, TIME_BUDGET_MIN, SNAPSHOT_IN, PLAYWRIGHT_*).
# RUN_BASE names the run; each shard gets RUN_ID=$RUN_BASE-<shard>.
set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: press-wave.sh <shard> [<shard> ...]" >&2
  exit 2
fi
: "${SNAPSHOT_IN:?SNAPSHOT_IN must name the leg snapshot (Q272)}"
RUN_BASE="${RUN_BASE:-local-$(date +%s)}"
# #1582: every shard of the run pulls rows from ONE queue (claimRow in
# pressFailureClass.mjs), so a shard with time left takes the next row instead
# of idling beside a slow one. Every leg of a run shares it (same RUN_BASE; the
# workflow carries it between leg jobs as the press-queue-leg-N artifact).
# PRESS_LAST_WAVE=0 on an earlier leg hands unwalked rows to the next one.
export PRESS_QUEUE_DIR="${PRESS_QUEUE_DIR:-test-results/press-queue/$RUN_BASE}"
export PRESS_LAST_WAVE="${PRESS_LAST_WAVE:-1}"
# The shards of one wave share the run's load ceiling: each paces to 1/width of
# it (press-every-control.mjs paceToCeiling), since the budget step sums them.
export PRESS_WAVE_WIDTH="$#"

pids=()
for n in "$@"; do
  (
    export SHARD="$n/12"
    export RUN_ID="$RUN_BASE-$n"
    export OUT="test-results/press-every-control/shard-$n"
    export REQUEST_BUDGET_DIR="request-budget/shard-$n"
    mkdir -p "$OUT"
    # Workflow commands (::warning:: / ::error::) must start the line, so only
    # plain lines get the shard prefix.
    node scripts/audit/press-every-control.mjs 2>&1 | sed -u "/^::/!s/^/[shard $n] /"
    exit "${PIPESTATUS[0]}"
  ) &
  pids+=("$!")
done

rc=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    echo "::error title=press shard ${*:$((i + 1)):1} failed::see the [shard ${*:$((i + 1)):1}] lines above and its artifact"
    rc=1
  fi
done
exit "$rc"
