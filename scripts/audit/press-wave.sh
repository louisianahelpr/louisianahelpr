#!/usr/bin/env bash
# One WAVE of press-every-control: the given shards (of 4) side by side on this
# runner, each in its own output and request-meter directory, prefixed logs.
#
# Why shards share a job (docs/OPEN.md Q326): the job holds the job-level
# `prod-lifecycle-shared-accounts` lock for the WHOLE run, like every other
# suite that drives the shared test accounts. A 4-way matrix could not hold it
# (each shard would wait on the next, and GitHub keeps one pending run per
# group, so a queued shard could be cancelled). Two at a time is still the
# Q317 load ceiling: the matrix ran `max-parallel: 2`.
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
: "${SNAPSHOT_IN:?SNAPSHOT_IN must name the run-level snapshot (Q272)}"
RUN_BASE="${RUN_BASE:-local-$(date +%s)}"
# #1582: every shard of the run pulls rows from ONE queue (claimRow in
# pressFailureClass.mjs), so a shard with time left takes the next row instead
# of idling beside a slow one. Both waves of a run share it (same RUN_BASE).
# PRESS_LAST_WAVE=0 on an earlier wave hands unwalked rows to the next one.
export PRESS_QUEUE_DIR="${PRESS_QUEUE_DIR:-test-results/press-queue/$RUN_BASE}"
export PRESS_LAST_WAVE="${PRESS_LAST_WAVE:-1}"

pids=()
for n in "$@"; do
  (
    export SHARD="$n/4"
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
