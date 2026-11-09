#!/bin/bash
# Remove the Helpr TEST LAB (every row scripts/test-lab/seed-test-lab.mjs built, the notices
# they caused, and the photos it uploaded). Lab ids only; it refuses unless both accounts
# are the pinned, is_seed, enrolled test accounts. A copy lives at ~/Desktop/Helpr-test-lab/.
#
#   bash cleanup-lab.sh --dry-run   list what would be deleted
#   bash cleanup-lab.sh             delete it and prove nothing is left
#
# Runs from a throwaway worktree of branch ready/b7-test-lab (never the shared checkout).
set -euo pipefail
REPO=/Users/lexilombas/louisianahelpr
BRANCH=ready/b7-test-lab
WT="$HOME/.lh-wt/test-lab-cleanup-$$"
if ! git -C "$REPO" rev-parse --verify --quiet "$BRANCH" >/dev/null; then
  git -C "$REPO" fetch -q origin "$BRANCH:$BRANCH"
fi
git -C "$REPO" worktree add -q --detach "$WT" "$BRANCH"
trap 'git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT
cp "$REPO/.env" "$WT/.env"
cd "$WT"
if [ "${1:-}" = "--dry-run" ]; then
  node --env-file=.env scripts/test-lab/seed-test-lab.mjs --teardown --dry-run
else
  node --env-file=.env scripts/test-lab/seed-test-lab.mjs --teardown
fi
