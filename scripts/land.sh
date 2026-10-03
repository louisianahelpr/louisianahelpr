#!/usr/bin/env bash
# Land the current worktree's commits on main WITH the generated files current.
#
#   bash scripts/land.sh            # fetch, rebase, refresh, verify, PR, wait for merge
#   bash scripts/land.sh --dry-run  # everything except the push
#   bash scripts/land.sh --no-wait  # open/refresh the PR with auto-merge, don't wait
#   (--pr is accepted and ignored: the PR path is the only path.)
#
# Q44 (owner, 2026-09-27; strict turned off by the owner 2026-09-30): main is protected
# with required checks and enforce_admins (not strict), so a
# direct push to main is refused. Nothing reaches main that has not passed
# Vitest, Test and the two Playwright checks; vacuity runs on every push to
# main (not required on PRs), since owner 2026-10-01 (PR #2050's took 112 min).
# Why: main Vitest went red on 12 of 16 finished runs on 2026-09-30 and 37 on
# 2026-09-27, every time from a direct --no-verify push that skipped a check.
#
# The PR path: push the verified HEAD to land/<branch>-<worktree hash> (force:
# it is this worktree's own branch), open a PR if none is open, turn on
# auto-merge with REBASE (not squash: a squash rewrites the messages and drops
# per-commit Sensitive-Review trailers), then wait. Strict is off, but the
# script still keeps the branch current: when main moves first (BEHIND, or
# DIRTY because another landing regenerated the same files) it loops: fetch,
# rebase, refresh, re-run the guards, force-push. A failed check
# stops the script red with the check names. The work is landed only when the
# PR shows MERGED.
#
# Why the refresh (2026-09-27): agents landed with `git push --no-verify origin
# HEAD:main`, which skips the pre-commit hook that regenerates the inventories.
# One new test file moved the guard count and main went red on
# check:generated (503fd193c). The generated files depend on the REBASED tree,
# so they are refreshed after the rebase, then proven with check:generated.
#
# Commits ONLY what the refresh produced: tracked files must be clean to start
# (commit your work first; never git stash in this repo), and untracked files
# that already existed (e.g. docs/audit/morning/*.md) are never staged.
set -euo pipefail

DRY=0
WAIT=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-wait) WAIT=0 ;;
    --pr) ;;
    *) echo "land: unknown argument $arg (use --dry-run, --no-wait)" >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
  echo "land: a rebase is in progress; finish it first (git status)." >&2
  exit 1
fi

DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
  echo "land: uncommitted tracked changes; commit them (or move them out) first:" >&2
  echo "$DIRTY" | sed 's/^/  /' >&2
  exit 1
fi

# Untracked files present before the refresh are someone else's; never staged.
UNTRACKED_BEFORE=$(git ls-files --others --exclude-standard | sort)

attempt=0
while :; do
  attempt=$((attempt + 1))
  git fetch -q origin main

  # This script's own earlier refresh commits are dropped before the rebase:
  # the refresh below regenerates them from the rebased tree anyway, and they
  # are what conflicts when another landing regenerated the same files first
  # (2026-10-03: #2210 and #2211 went DIRTY the moment #2212 merged, and each
  # took a hand `git rebase --skip` and a re-run). Guard: landingPath.test.ts.
  REFRESH_SUBJECT="chore: refresh generated inventories"
  if git log --format=%s origin/main..HEAD | grep -qxF "$REFRESH_SUBJECT"; then
    if ! git log --format=%s origin/main..HEAD | grep -qvxF "$REFRESH_SUBJECT"; then
      echo "land: nothing to land but earlier refresh commits; reset to origin/main." >&2
      exit 1
    fi
    REBASE=(env GIT_SEQUENCE_EDITOR="sed -E -i.land-bak -e '/^(pick|p) [0-9a-f]+ (# )?$REFRESH_SUBJECT\$/d'" git -c rebase.instructionFormat=%s rebase -q -i origin/main)
  else
    REBASE=(git rebase -q origin/main)
  fi
  if ! "${REBASE[@]}"; then
    echo "land: the rebase onto origin/main stopped on a conflict in this branch's own work; resolve it (git status), then re-run bash scripts/land.sh." >&2
    exit 1
  fi

  # Queue numbers are taken from each lane's own base, so two lanes file the
  # same Q (Q743, Q904/Q905, Q909-Q914 collided 2026-09-30..10-01). After the
  # rebase, the item already on main keeps the number and this branch's copy
  # moves to the next number free on both; the refresh below commits it. Exits
  # 1 (stopping the land) only when main itself carries the duplicate.
  # Guard: src/test/openRenumber.test.ts.
  node scripts/open-renumber.mjs --base origin/main

  npm run -s inventories:refresh

  CHANGED=$( { git diff --name-only; comm -13 <(printf '%s\n' "$UNTRACKED_BEFORE") <(git ls-files --others --exclude-standard | sort); } | sed '/^$/d' | sort -u)
  if [ -n "$CHANGED" ]; then
    echo "land: generated files refreshed:"
    echo "$CHANGED" | sed 's/^/  /'
    echo "$CHANGED" | tr '\n' '\0' | xargs -0 git add --
    git commit -q --no-verify -m "chore: refresh generated inventories

Regenerated by scripts/land.sh after rebasing onto origin/main.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  else
    echo "land: generated files already current."
  fi

  # The same check CI runs; red here stops the push.
  npm run -s check:generated

  # A money/authz/data-model commit with no recorded review turns main red on
  # the "Sensitive review record" workflow (15921ea17, 2026-09-27). Check only
  # the commits this push adds; record the review first
  # (node scripts/check-sensitive-review.mjs record <sha> <reviewer> <verdict>).
  node scripts/check-sensitive-review.mjs --range origin/main..HEAD --strict

  # A commit that names an open docs/OPEN.md item must update that item in the
  # same landing (Q1150, owner 2026-10-03: e952452d7 fixed Q572 and Q445 and
  # neither line moved, so the open count overstated the work). Runs after the
  # refresh, so an item ticked [x] here has already moved to the archive.
  node scripts/check-fixes-update-their-items.mjs --range origin/main..HEAD --strict

  # Exact-count bookkeeping guards. Every main Vitest red on 2026-09-30 (12 of
  # 12, runs 36740238457..36787599011) was one of these: a commit moved a
  # count (unused exports, markerless [~] items, a done-when marker, an
  # unmetered prod spec, the expiry inventory) and --no-verify skipped every
  # local check; 287ab11c2 then reached main red on the component-size one.
  # They take ~4s; run them on the rebased tree on every land.
  npx vitest run \
    src/test/deadcodeRatchet.test.ts \
    src/test/openPartlyDoneItemsSayDoneWhen.test.ts \
    src/test/openUnnumberedRatchet.test.ts \
    src/test/openRenumber.test.ts \
    src/test/requestBudget.test.ts \
    src/test/expiryMonitor.test.ts \
    src/test/componentSizeRatchet.test.ts

  # db-deploy runs the moment a migration reaches main, before CI's vitest
  # does. Its two commonest reds (ledger 00fd2bd0, runs since 2026-09-24:
  # 5x "types.ts matches the live schema", 3x "no allow check says yes to a
  # NULL argument"; newest 36361411866 / 36360932660 from the Q807 migration)
  # each have a repo-only vitest twin that was already red on that commit.
  # Run the twins here whenever the push touches migrations or their inputs.
  if git diff --name-only origin/main..HEAD | grep -qE '^(supabase/migrations/|scripts/ci/|src/integrations/supabase/types\.ts$)'; then
    npx vitest run src/test/typesCoverMigrationFunctions.test.ts src/test/nullArgNeverAllows.test.ts
  fi

  if [ "$DRY" = 1 ]; then
    echo "land: --dry-run, not pushing. HEAD $(git rev-parse --short HEAD)"
    exit 0
  fi

  # One branch per worktree: a detached HEAD is "HEAD" in every worktree, so
  # the worktree path's hash keeps two sessions off each other's PR.
  WT_HASH=$(printf '%s' "$PWD" | shasum | cut -c1-8)
  BR="land/$(git rev-parse --abbrev-ref HEAD | tr '/' '-')-$WT_HASH"
  git push --no-verify --force origin "HEAD:refs/heads/$BR"
  if ! gh pr view "$BR" --json state --jq .state 2>/dev/null | grep -qx OPEN; then
    # Title/body given explicitly: --fill needs a local branch ref, and a
    # detached HEAD has none (first run, 2026-09-30).
    gh pr create --base main --head "$BR" \
      --title "$(git log -1 --format=%s)" \
      --body "$(printf 'Landed by scripts/land.sh (Q44).\n\n%s\n' "$(git log --format='- %h %s' origin/main..HEAD)")"
  fi
  gh pr merge "$BR" --rebase --auto
  # Duplicate work (2026-10-02): the same commits re-landed from another
  # worktree opened a second PR (#2063 and #2070) and both ran the full check
  # set. Any other open land/** PR whose head is already inside this HEAD is
  # superseded: close it and delete its branch so its checks stop queueing.
  # Guard: src/test/landingPath.test.ts.
  gh pr list --state open --json number,headRefName,headRefOid \
    --jq '.[] | select(.headRefName | startswith("land/")) | "\(.number) \(.headRefName) \(.headRefOid)"' |
  while read -r num ref oid; do
    [ "$ref" = "$BR" ] && continue
    git cat-file -e "$oid" 2>/dev/null || git fetch -q origin "$ref" 2>/dev/null || continue
    if git merge-base --is-ancestor "$oid" HEAD 2>/dev/null; then
      gh pr close "$num" --delete-branch --comment "Superseded by $BR (its commits are already in that head)." &&
        echo "land: closed superseded PR #$num ($ref)."
    fi
  done
  echo "land: $(git rev-parse --short HEAD) is on $BR with auto-merge on."
  if [ "$WAIT" = 0 ]; then
    echo "land: --no-wait; not landed until gh pr view $BR --json state says MERGED."
    exit 0
  fi

  # Wait for the merge (checks take ~20 min). Loop back to the rebase when
  # main moved; stop red on a failed check.
  waited=0
  while :; do
    sleep 60
    waited=$((waited + 1))
    INFO=$(gh pr view "$BR" --json state,mergeStateStatus)
    STATE=$(echo "$INFO" | jq -r .state)
    if [ "$STATE" = MERGED ]; then
      echo "land: $BR merged into main."
      exit 0
    fi
    if [ "$STATE" = CLOSED ]; then
      echo "land: $BR was closed without merging." >&2
      exit 1
    fi
    # Only the REQUIRED checks decide; an optional one (Lighthouse, Analyze)
    # failing does not block the merge, so it does not stop the wait.
    FAILED=$(gh pr checks "$BR" --required --json name,bucket --jq '[.[] | select(.bucket == "fail") | .name] | unique | join(", ")' 2>/dev/null || true)
    if [ -n "$FAILED" ]; then
      echo "land: checks failed on $BR: $FAILED" >&2
      echo "land: fix, commit, and re-run bash scripts/land.sh." >&2
      exit 1
    fi
    # Strict is off, so main moving shows as DIRTY (a conflict, usually the
    # generated files another landing refreshed), almost never BEHIND; both
    # go back to the rebase instead of waiting out the 90 minutes.
    MSS=$(echo "$INFO" | jq -r .mergeStateStatus)
    if [ "$MSS" = BEHIND ] || [ "$MSS" = DIRTY ]; then
      echo "land: main moved ($MSS); rebasing $BR again."
      break
    fi
    if [ "$waited" -ge 90 ]; then
      echo "land: $BR not merged after 90 min; re-run bash scripts/land.sh." >&2
      exit 1
    fi
  done
  if [ "$attempt" -ge 8 ]; then
    echo "land: main moved $attempt times while $BR waited; re-run." >&2
    exit 1
  fi
done
