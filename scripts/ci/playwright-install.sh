#!/usr/bin/env bash
# Install Playwright browsers in CI with a per-attempt time limit and retries.
#
# A bare `npx playwright install --with-deps` sat 34 min and then 15 min on
# vacuity's Guards job on 2026-10-01 (PR #2006, run 36887972258). Run
# 36894838001 showed why: the runner's Ubuntu mirror was serving packages at
# ~100 KB/s, and a stalled apt connection waits forever. Killing npx on a
# timeout then left its `apt-get` running with the dpkg lock held, so every
# retry failed at once with "Could not get lock /var/lib/dpkg/lock-frontend".
#
# So: apt gets connection timeouts and its own retries, each attempt gets a
# limit, and between attempts any leftover apt-get is stopped and the dpkg
# lock waited out before trying again.
#
# Usage: bash scripts/ci/playwright-install.sh chromium [webkit ...]
# Every workflow uses this (src/test/playwrightInstallHasTimeout.test.ts).
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "playwright-install: name at least one browser" >&2
  exit 2
fi

limit="${LH_PW_INSTALL_TIMEOUT:-900}"
attempts="${LH_PW_INSTALL_ATTEMPTS:-3}"

# A stalled mirror connection times out and is retried instead of hanging.
printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' \
  | sudo tee /etc/apt/apt.conf.d/80-lh-retries >/dev/null

release_apt() {
  sudo pkill -TERM -x apt-get 2>/dev/null || true
  for _ in $(seq 1 24); do
    sudo fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock >/dev/null 2>&1 || break
    sleep 5
  done
  sudo dpkg --configure -a || true
}

for i in $(seq 1 "$attempts"); do
  echo "playwright-install: attempt $i/$attempts ($*), limit ${limit}s"
  if timeout --kill-after=15 "$limit" npx playwright install --with-deps "$@"; then
    exit 0
  fi
  echo "::warning::playwright install attempt $i/$attempts failed or timed out ($*)"
  release_apt
  sleep $((i * 10))
done

echo "::error::playwright install failed after $attempts attempts ($*)"
exit 1
