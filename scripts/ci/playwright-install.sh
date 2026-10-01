#!/usr/bin/env bash
# Install Playwright browsers in CI with a per-attempt time limit and retries.
#
# A bare `npx playwright install --with-deps` has hung at this step with no
# output until the job's own budget: the vacuity "Guards shown able to fail"
# job sat 34 min and then 15 min on 2026-10-01 (PR #2006, run 36887972258) and
# had to be force-cancelled, which leaves no log. A hang now fails one attempt
# after LH_PW_INSTALL_TIMEOUT seconds and retries, instead of eating the job.
#
# Usage: bash scripts/ci/playwright-install.sh chromium [webkit ...]
# Every workflow uses this (src/test/playwrightInstallHasTimeout.test.ts).
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "playwright-install: name at least one browser" >&2
  exit 2
fi

limit="${LH_PW_INSTALL_TIMEOUT:-300}"
attempts="${LH_PW_INSTALL_ATTEMPTS:-3}"

for i in $(seq 1 "$attempts"); do
  echo "playwright-install: attempt $i/$attempts ($*), limit ${limit}s"
  if timeout --kill-after=15 "$limit" npx playwright install --with-deps "$@"; then
    exit 0
  fi
  echo "::warning::playwright install attempt $i/$attempts failed or timed out ($*)"
  sleep $((i * 10))
done

echo "::error::playwright install failed after $attempts attempts ($*)"
exit 1
