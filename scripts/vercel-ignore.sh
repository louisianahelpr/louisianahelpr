#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
# Exit 0 = SKIP this build. Exit 1 = BUILD.
#
# Why (2026-09-13): every push to main AND every push to any branch built a
# deployment. On a busy audit day that was several dozen, the project hit its
# deployment cap, and production silently stopped updating while main kept
# moving (a real-user bug fix sat undeployed). Now:
#   - only main builds (work branches, dependabot branches: skipped);
#   - main builds only when a deploy path changed since the last deployed
#     commit (docs/, e2e/, .github/, audit scripts, tests: skipped).
# When in doubt it BUILDS: a wasted build is cheap, a missing deploy is not.
set -uo pipefail

if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]; then
  echo "skip: branch '${VERCEL_GIT_COMMIT_REF:-unknown}' is not main"
  exit 0
fi

PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$PREV" ]; then
  echo "build: no previous deployed sha to compare against"
  exit 1
fi
git cat-file -e "${PREV}^{commit}" 2>/dev/null || git fetch --quiet --depth=200 origin main 2>/dev/null || true
if ! git cat-file -e "${PREV}^{commit}" 2>/dev/null; then
  echo "build: previous sha $PREV not in the clone"
  exit 1
fi

PATHS=()
while IFS= read -r line; do PATHS+=("$line"); done < <(bash scripts/deploy-paths.sh)
if git diff --quiet "$PREV" HEAD -- "${PATHS[@]}"; then
  echo "skip: nothing that ships changed since $PREV"
  exit 0
fi
echo "build: deploy paths changed since $PREV"
exit 1
