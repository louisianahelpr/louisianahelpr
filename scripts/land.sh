#!/usr/bin/env bash
# Land the current worktree's commits on main WITH the generated files current.
#
#   bash scripts/land.sh            # fetch, rebase, refresh, verify, PR, wait for merge
#   bash scripts/land.sh --dry-run  # everything except the push
#   bash scripts/land.sh --no-wait  # open/refresh the PR with auto-merge, don't wait
#   (--pr is accepted and ignored: the PR path is the only path.)
#   bash scripts/land.sh --claim-override="<reason>"  # take a branch another session has claimed
#
# Q44 (owner, 2026-09-27; strict turned off 2026-09-30, back ON in the "main" ruleset 2026-10-05): main is protected
# with required checks and enforce_admins (strict up-to-date ON again since 2026-10-05), so a
# direct push to main is refused. Nothing reaches main that has not passed
# Vitest, Test and the two Playwright checks; vacuity runs on every push to
# main (not required on PRs), since owner 2026-10-01 (PR #2050's took 112 min).
# Why: main Vitest went red on 12 of 16 finished runs on 2026-09-30 and 37 on
# 2026-09-27, every time from a direct --no-verify push that skipped a check.
#
# The PR path: push the verified HEAD to land/<branch>-<worktree hash> (force:
# it is this worktree's own branch), open a PR if none is open, turn on
# auto-merge with REBASE (not squash: a squash rewrites the messages and drops
# per-commit Sensitive-Review trailers), label it `land-queue`, then wait.
# Strict is on again (2026-10-05). A PR left BEHIND by another merge waits for
# the land queue (scripts/land-queue.mjs, .github/workflows/land-queue.yml),
# which rebases only the head of the queue; a DIRTY one (another landing
# regenerated the same files) loops here: fetch, rebase, refresh, re-run the
# guards, force-push. A failed check stops the script red with the check
# names. The work is landed only when the PR shows MERGED.
#
# Why the refresh (2026-09-27): agents landed with `git push --no-verify origin
# HEAD:main`, which skips the pre-commit hook that regenerates the inventories.
# One new test file moved the guard count and main went red on
# check:generated (503fd193c). The generated files depend on the REBASED tree,
# so they are refreshed after the rebase, then proven with check:generated.
#
# Before the push it also builds the bundle (`npx vite build`, borrowing the
# main checkout's .env when the worktree has none) and runs the critical-path
# budget (`node scripts/perf/critical-path.mjs --check`, Q178); a route over
# budget stops the land red with the route and its KB. CI's "Bundle Size
# Check" is not a required check, so before this a regression was seen only
# after auto-merge was on (PR #2406, 2026-10-05: /login 293 KB gz vs 271).
# Skipped, and said so, when the push changes nothing the bundle is built
# from (src/, public/, index.html, vite.config.*, package*.json) or the budget.
#
# Commits ONLY what the refresh produced: tracked files must be clean to start
# (commit your work first; never git stash in this repo), and untracked files
# that already existed (e.g. docs/audit/morning/*.md) are never staged.
set -euo pipefail

# RUN FROM A FROZEN COPY. The rebase below rewrites the working tree commit by
# commit, this script and its resolver tools included, and bash reads a script
# as it runs: a landing that changes land.sh (or lands the resolver itself)
# would execute a half-old file, and the resolver did not exist in the tree
# mid-rebase (2026-10-07: "Cannot find module .../landRebaseResolve.mjs").
# So: copy land.sh and the tools it runs during the rebase to a temp dir once,
# and run from there. Guard: src/test/landRebaseResolve.test.ts.
if [ -z "${LAND_FROZEN_DIR:-}" ]; then
  LAND_FROZEN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/land-frozen.XXXXXX")
  cp "$0" "$LAND_FROZEN_DIR/land.sh"
  for t in landRebaseResolve.mjs openItemMerge.mjs landRecount.mjs landGh.mjs landClaims.mjs; do
    cp "$(dirname "$0")/lib/$t" "$LAND_FROZEN_DIR/$t"
  done
  export LAND_FROZEN_DIR
  exec bash "$LAND_FROZEN_DIR/land.sh" "$@"
fi

DRY=0
WAIT=1
CLAIM_OVERRIDE=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-wait) WAIT=0 ;;
    --pr) ;;
    --claim-override=*) CLAIM_OVERRIDE="${arg#--claim-override=}" ;;
    *) echo "land: unknown argument $arg (use --dry-run, --no-wait, --claim-override=\"<reason>\")" >&2; exit 1 ;;
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

# LANDING CLAIMS (owner 2026-10-17 sweep spec): one session lands a branch.
# The claim (owner session, since, PR) is written to refs/lh/landing-claims on
# origin by compare-and-swap; a branch another session has claimed is refused
# unless --claim-override="<reason>" (recorded on the claim). A store that
# cannot be reached warns and carries on, so no landing breaks on it; no
# claims (a missing ref) means every branch is free. `npm run sweep` prints the
# table. Guard: src/test/landClaims.test.ts.
CLAIM_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CLAIM_BRANCH" = HEAD ]; then CLAIM_BRANCH="detached-$(printf '%s' "$PWD" | shasum | cut -c1-8)"; fi
CLAIM_ARGS=()
if [ -n "$CLAIM_OVERRIDE" ]; then CLAIM_ARGS=(--override "$CLAIM_OVERRIDE"); fi
CLAIM_CMD=claim
case "$DRY" in 1) CLAIM_CMD=check ;; esac # --dry-run only checks, writes no claim
node "$LAND_FROZEN_DIR/landClaims.mjs" "$CLAIM_CMD" "$CLAIM_BRANCH" ${CLAIM_ARGS[@]+"${CLAIM_ARGS[@]}"} || exit 1

# Where a landing's minutes go (owner, 2026-10-12: "fix the bottleneck
# before"): each phase prints its own seconds, so a slow landing names its
# slow step instead of being guessed at.
phase_t=$SECONDS
phase() { echo "land: [$((SECONDS - phase_t))s] $1"; phase_t=$SECONDS; }

attempt=0
while :; do
  attempt=$((attempt + 1))
  # The head this run starts from. When the rebase and refresh below land on
  # the very same tree, it is pushed again unchanged (same SHA), so a re-run
  # never restarts the checks for nothing (dropping and regenerating the
  # refresh commit would otherwise mint a new SHA every time).
  START_HEAD=$(git rev-parse HEAD)
  git fetch -q origin main

  # This script's own earlier refresh commits are dropped before the rebase:
  # the refresh below regenerates them from the rebased tree anyway, and they
  # are what conflicts when another landing regenerated the same files first
  # (2026-10-03: #2210 and #2211 went DIRTY the moment #2212 merged, and each
  # took a hand `git rebase --skip` and a re-run). Guard: landingPath.test.ts.
  # Counted from a here-string, never `cmd | grep -q`: under pipefail, grep -q
  # exiting early can SIGPIPE the writer and fail the test at random
  # (2026-10-03: it once reported six real commits as "nothing to land").
  # Every grep in this script reads a variable for the same reason.
  REFRESH_SUBJECT="chore: refresh generated inventories"
  SUBJECTS=$(git log --format=%s origin/main..HEAD)
  N_REFRESH=$(grep -cxF "$REFRESH_SUBJECT" <<<"$SUBJECTS" || true)
  N_ALL=$(grep -c . <<<"$SUBJECTS" || true)
  if [ "$N_REFRESH" -gt 0 ]; then
    if [ "$N_ALL" -eq "$N_REFRESH" ]; then
      echo "land: nothing to land but earlier refresh commits; reset to origin/main." >&2
      exit 1
    fi
    REBASE=(env GIT_SEQUENCE_EDITOR="sed -E -i.land-bak -e '/^(pick|p) [0-9a-f]+ (# )?$REFRESH_SUBJECT\$/d'" git -c rebase.instructionFormat=%s rebase -q -i origin/main)
  else
    REBASE=(git rebase -q origin/main)
  fi
  if ! "${REBASE[@]}"; then
    # With seven lanes landing at once (2026-10-07) every rebase stopped on the
    # same files and looped: docs/OPEN.md and its archive, the generated docs,
    # and the exact-count constants. scripts/lib/landRebaseResolve.mjs settles
    # those (items merged keeping both sides, a tick wins, notes appended;
    # generated files take main's copy and are regenerated below; a count
    # takes main's value and landRecount.mjs measures the real one after the
    # rebase). Any other conflicted file still stops for a person.
    # Guards: src/test/landRebaseResolve.test.ts, src/test/openItemMerge.test.ts.
    steps=0
    while [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; do
      steps=$((steps + 1))
      if [ "$steps" -gt 400 ]; then
        echo "land: the rebase did not finish after $steps steps; resolve it by hand (git status)." >&2
        exit 1
      fi
      UNMERGED=$(git diff --name-only --diff-filter=U)
      if [ -z "$UNMERGED" ]; then
        # Resolved to exactly what main has: the replayed commit is empty now.
        if git diff --cached --quiet; then
          git rebase --skip >/dev/null 2>&1 || true
        else
          GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 || true
        fi
        continue
      fi
      if node "$LAND_FROZEN_DIR/landRebaseResolve.mjs"; then
        # stops again if the next replayed commit conflicts; the loop looks again
        GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 || true
        continue
      fi
      echo "land: the rebase onto origin/main stopped on a conflict in this branch's own work; resolve it (git status), then re-run bash scripts/land.sh." >&2
      exit 1
    done
  fi

  phase "fetched and rebased onto origin/main (attempt $attempt)"

  # An exact-count constant the rebase settled with main's value gets the
  # value measured on the rebased tree (its own guard prints it).
  node "$LAND_FROZEN_DIR/landRecount.mjs"

  # New items filed as Q?<tag> placeholders get their numbers HERE, above
  # everything on origin/main and this tree, so a number is never taken from a
  # stale base and never sits in a commit subject (2026-10-12: subjects naming
  # a renumbered Q turned check-fixes-update-their-items red after landing).
  # Guard: src/test/openAssignNumbers.test.ts.
  node scripts/open-assign-numbers.mjs --base origin/main

  # Queue numbers are taken from each lane's own base, so two lanes file the
  # same Q (Q743, Q904/Q905, Q909-Q914 collided 2026-09-30..10-01). After the
  # rebase, the item already on main keeps the number and this branch's copy
  # moves to the next number free on both; the refresh below commits it. Exits
  # 1 (stopping the land) only when main itself carries the duplicate.
  # Guard: src/test/openRenumber.test.ts.
  node scripts/open-renumber.mjs --base origin/main

  # A merge may REPLACE an item main already has (2026-10-04: a batch merge put
  # the branches' new items over main's Q1208/Q1209/Q1210 and nothing moved the
  # count). Every item on origin/main must still be here as itself.
  # Guard: src/test/openItemsKept.test.ts.
  node scripts/check-open-items-kept.mjs --base origin/main

  # The whole-tree totals (postMerge generators: scoreboard, burn-down, vacuity
  # report, queue score, audit surface/coverage/rollup) go back to main's
  # bytes, whatever the branch's own commits did to them: they are what every
  # landing touched and what sent 27 of 60 land PRs (2026-10-09..12) back
  # DIRTY. staleness-watch.yml regenerates them on main after the merge.
  # Guard: src/test/landPostMergeReset.test.ts.
  node scripts/lib/landPostMergeReset.mjs --base origin/main

  node scripts/check-generated-current.mjs --fix --skip-post-merge

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
  node scripts/check-generated-current.mjs --skip-post-merge

  phase "bookkeeping and generated inventories"

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

  # A closing keyword in a commit message (fixes #N, closes owner/repo#N, an
  # issue URL) must never close a nightly-red issue: an alert closes when its
  # own workflow goes green (Q1184, #2200 closed by 584eef85c's body
  # 2026-10-03). Reads the full messages of origin/main..HEAD, asks
  # `gh issue view N --json labels` for each referenced issue, and fails closed
  # when gh cannot answer. Guard: src/test/closingKeywordNightlyRed.test.ts.
  node scripts/check-closing-keywords.mjs --range origin/main..HEAD

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

  phase "commit-range and exact-count guards"

  # FIRST-TRY PASS (owner, 2026-10-05: "how can we make this go faster"). On
  # 2026-10-05 most landings took 2-4 GitHub rounds (~20 min each), and every
  # extra round was a check that runs in seconds here: ESLint on a changed
  # file (no-regex-spaces), check:counts (an undated number in a comment), a
  # test that reads a changed file by path (socialAuthButtonGap,
  # countCachesArePerUser), fixtureSchemaContract, the workflow-shape guards.
  # Run them on the rebased tree before the push. Guard: landingPath.test.ts.
  CHANGED_ALL=$(git diff --name-only --diff-filter=ACMR origin/main..HEAD)
  CHANGED_LINT=$(printf '%s\n' "$CHANGED_ALL" | grep -E '\.(ts|tsx|mjs|js)$' | grep -vE '^supabase/functions/' || true)
  if [ -n "$CHANGED_LINT" ]; then
    # shellcheck disable=SC2086
    npx eslint --quiet $CHANGED_LINT
  fi
  npm run -s check:counts
  # Tests that import a changed file (vitest's own graph) and tests that name
  # a changed file's basename (the ones that read source by path), plus the
  # repo-wide guards that went red only on GitHub on 2026-10-05.
  NAMED_TESTS=""
  for f in $CHANGED_ALL; do
    b=$(basename "$f")
    case "$b" in *.md|*.json|*.snap) continue ;; esac
    # git grep exits 1 on no match; under pipefail that ended land.sh silently.
    NAMED_TESTS="$NAMED_TESTS $( { git grep -l -F -- "$b" -- 'src/**/*.test.ts' 'src/**/*.test.tsx' || [ $? -eq 1 ]; } | tr '\n' ' ')"
  done
  # Tests that READ a changed migration or the queue files by path (a whole
  # directory, a fixed path): neither the import graph nor the basename grep
  # finds them. 2026-10-07: cronLivenessCoverage, offerDeadlineBeforeStart,
  # openFeedsMirrored and hireRefusedAcrossBlock went red only on GitHub.
  # Guard: src/test/landPathReaders.test.ts.
  # shellcheck disable=SC2086
  NAMED_TESTS="$NAMED_TESTS $(node scripts/lib/landPathReaders.mjs $CHANGED_ALL | tr '\n' ' ')"
  # Two runs: vitest intersects file filters with --changed, so they cannot share one.
  # The --changed set runs in chunks of 60 files: one process for a big set
  # (162 files, fix-land/no-poster-fee, 2026-10-12) ran out of node's ~2 GB
  # heap. Guard: src/test/landVitestChangedChunks.test.ts.
  # A batch TRAIN (cherry-picked keepers in one branch) is tested once, on
  # GitHub (owner, 2026-10-12: the 8 GB Mac building trains one after another
  # was the bottleneck while CI merged each train in 8-18 min). Run it as
  # `LAND_TRAIN=1 bash scripts/land.sh`: every other step still runs (eslint,
  # counts, generated, review records, closing keywords, the migration twins,
  # the critical-path build); only these two vitest runs are left to CI.
  if [ "${LAND_TRAIN:-}" = 1 ]; then
    echo "land: LAND_TRAIN=1: the --changed and named vitest runs are left to GitHub CI (batch train, owner 2026-10-12)."
  else
  node scripts/land-vitest-changed.mjs origin/main
  # shellcheck disable=SC2086
  # In chunks too: one process for this set ran out of node's heap on the
  # 2026-10-12 money batch. Guard: src/test/landVitestChangedChunks.test.ts.
  node scripts/land-vitest-changed.mjs --files $NAMED_TESTS \
    src/test/fixtureSchemaContract.test.ts \
    src/test/workflowFalseGreenShapes.test.ts \
    src/test/prodLoadQueue.test.ts \
    src/test/workflowInstallsMatchLockfile.test.ts \
    src/test/baselinesAreTwoWay.test.ts \
    src/test/mutateRegistrationsResolve.test.ts
  fi

  # db-deploy runs the moment a migration reaches main, before CI's vitest
  # does. Its two commonest reds (ledger 00fd2bd0, runs since 2026-09-24:
  # 5x "types.ts matches the live schema", 3x "no allow check says yes to a
  # NULL argument"; newest 36361411866 / 36360932660 from the Q807 migration)
  # each have a repo-only vitest twin that was already red on that commit.
  # Run the twins here whenever the push touches migrations or their inputs.
  phase "eslint, check:counts and related vitest"
  PUSHED_FILES=$(git diff --name-only origin/main..HEAD)
  if grep -qE '^(supabase/migrations/|scripts/ci/|src/integrations/supabase/types\.ts$)' <<<"$PUSHED_FILES"; then
    npx vitest run src/test/typesCoverMigrationFunctions.test.ts src/test/nullArgNeverAllows.test.ts
  fi

  # db-deploy's `supabase db push --include-all` applies a migration OLDER than
  # prod's newest AFTER the newer ones, so an older branch file restating a
  # function/view/trigger that a newer main file already restates leaves prod
  # on the OLDER body while a replay ends on the newer one (2026-10-15:
  # ready/declutter-4 restated export_my_data in three files older than main's
  # 20261015052622 and would have dropped its category_suggestions export).
  # On the rebased tree, against the land base. Guard: src/test/outOfOrderRestatements.test.ts.
  node scripts/check-out-of-order-restatements.mjs --base origin/main

  # The edge type check (`deno check` of every edge function, the required
  # "Lint, type-check, build, test" job's "Edge function type check" step).
  # land.sh never ran it, so PR #3294 (2026-10-17, declutter moving-out) went
  # red in CI on 2 x TS2345 in declutter-ai-draft after a green land, and sat
  # BLOCKED with auto-merge off. Run it whenever the push touches an edge
  # function or the checker itself; any error stops the land before the push.
  # Guard: src/test/landTypechecksEdge.test.ts (Q?land-typecheck-edge).
  if grep -qE '^(supabase/functions/|scripts/typecheck-edge\.mjs$|scripts/edge-typecheck\.deno\.json$)' <<<"$PUSHED_FILES"; then
    echo "land: edge functions changed; running the edge type check (npm run typecheck:edge)."
    if ! npm run -s typecheck:edge; then
      echo "land: the edge type check failed (errors above); not pushing. CI's required Test job runs the same check." >&2
      exit 1
    fi
  else
    echo "land: no edge function changed; skipping the edge type check."
  fi
  phase "edge type check"

  # The critical-path budget (Q178: scripts/perf/critical-path-budget.json),
  # checked on the BUILT bundle before the push. CI's "Bundle Size Check" runs
  # the same command but is NOT a required check, so a regression showed only
  # after auto-merge was already on: batch PR #2406 (2026-10-05) took /login
  # from 274 to 293 KB gz against a 271 KB budget (+5% = 284.55) and would have
  # merged with it. One build, after the vitest runs above have exited (8 GB
  # Mac). Skipped only when the push changes nothing the bundle or the budget
  # is made from. Guard: src/test/landingPath.test.ts.
  if grep -qE '^(src/|public/|index\.html$|vite\.config\.[^/]+$|package(-lock)?\.json$|scripts/perf/critical-path)' <<<"$PUSHED_FILES"; then
    # vite.config.ts refuses to build without the VITE_* boot env; a fresh
    # worktree has no .env, so borrow the main checkout's (gitignored).
    MAIN_TREE=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
    if [ ! -e .env ] && [ -f "$MAIN_TREE/.env" ]; then
      ln -s "$MAIN_TREE/.env" .env
      echo "land: linked $MAIN_TREE/.env for the build."
    fi
    # No .env anywhere (a cloud session): build with the values CI's own
    # budget run uses (bundle-size.yml), so the measurement is the same one.
    if [ ! -e .env ] && [ -z "${VITE_SUPABASE_URL:-}" ]; then
      export VITE_SUPABASE_PROJECT_ID=fncmgoasalhdgfwzhsqa
      export VITE_SUPABASE_URL=https://fncmgoasalhdgfwzhsqa.supabase.co
      export VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_key_for_e2e_only
      echo "land: no .env; building with bundle-size.yml's env for the budget."
    fi
    echo "land: building the bundle for the critical-path budget (Q178)."
    BUILD_LOG=$(mktemp "${TMPDIR:-/tmp}/land-vite-build.XXXXXX")
    if ! npx vite build >"$BUILD_LOG" 2>&1; then
      tail -40 "$BUILD_LOG" >&2
      echo "land: npx vite build failed (full log: $BUILD_LOG); not pushing." >&2
      exit 1
    fi
    rm -f "$BUILD_LOG"
    if ! node scripts/perf/critical-path.mjs --check; then
      echo "land: the critical-path budget failed (Q178; routes and KB above); not pushing. Shrink that route's critical path; if the growth is deliberate, change scripts/perf/critical-path-budget.json and say why in the commit." >&2
      exit 1
    fi
  else
    echo "land: nothing the bundle is built from changed (src/, public/, index.html, vite.config.*, package*.json, scripts/perf/critical-path*); skipping the build and the critical-path budget (Q178)."
  fi

  phase "bundle build and critical-path budget"

  if [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "$START_HEAD^{tree}")" ] &&
     git merge-base --is-ancestor origin/main "$START_HEAD"; then
    git reset -q --hard "$START_HEAD"
    echo "land: same tree as the last push; keeping $(git rev-parse --short HEAD)."
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
  # Every GitHub call from here on reads REST through scripts/lib/landGh.mjs
  # (or tries gh first and falls back to it): `gh pr view/create/edit/list/
  # checks` are GraphQL, which Claude Code cloud sessions are refused (HTTP
  # 403), and a refused `gh pr view` once kept a wait asking "again in a
  # minute" for 19 h while PR #2672 sat DIRTY (2026-10-09..11).
  # Title/body given explicitly: a detached HEAD has no branch to --fill from.
  BODY_FILE=$(mktemp "${TMPDIR:-/tmp}/land-body.XXXXXX")
  printf 'Landed by scripts/land.sh (Q44).\n\n%s\n' "$(git log --format='- %h %s' origin/main..HEAD)" >"$BODY_FILE"
  PR_NUM=$(node "$LAND_FROZEN_DIR/landGh.mjs" ensure-pr "$BR" "$(git log -1 --format=%s)" "$BODY_FILE")
  rm -f "$BODY_FILE"
  echo "land: PR #$PR_NUM is $BR."
  node "$LAND_FROZEN_DIR/landClaims.mjs" set-pr "$CLAIM_BRANCH" "$PR_NUM" || true
  gh pr merge "$BR" --rebase --auto 2>/dev/null || node "$LAND_FROZEN_DIR/landGh.mjs" auto-merge "$PR_NUM"
  # The land queue (owner, 2026-10-05; scripts/land-queue.mjs): the label puts
  # this PR in line. Only the head of the queue is rebased onto main and
  # re-checked, so a merge no longer sends every open PR back for a re-run; a
  # head whose required check fails leaves the queue and the next moves up.
  gh pr edit "$BR" --remove-label land-queue-failed --add-label land-queue >/dev/null 2>&1 ||
    node "$LAND_FROZEN_DIR/landGh.mjs" queue "$PR_NUM"
  echo "land: $BR is in the land queue (label land-queue)."
  # Wake the queue now (it has no pull_request trigger); the wait below nudges
  # it again every 10 minutes. A failed dispatch only delays: the next merge or
  # required-check completion wakes it too.
  gh workflow run land-queue.yml --ref main >/dev/null 2>&1 || echo "land: could not dispatch land-queue.yml; it runs on the next merge or check." >&2
  # Duplicate work (2026-10-02): the same commits re-landed from another
  # worktree opened a second PR (#2063 and #2070) and both ran the full check
  # set. Any other open land/** PR whose head is already inside this HEAD is
  # superseded: close it and delete its branch so its checks stop queueing.
  # Guard: src/test/landingPath.test.ts.
  OPEN_LAND=$(node "$LAND_FROZEN_DIR/landGh.mjs" open-land-prs || true)
  while read -r num ref oid; do
    [ -z "$num" ] && continue
    [ "$ref" = "$BR" ] && continue
    git cat-file -e "$oid" 2>/dev/null || git fetch -q origin "$ref" 2>/dev/null || continue
    if git merge-base --is-ancestor "$oid" HEAD 2>/dev/null; then
      { gh pr close "$num" --delete-branch --comment "Superseded by $BR (its commits are already in that head)." 2>/dev/null ||
        node "$LAND_FROZEN_DIR/landGh.mjs" close-superseded "$num" "$ref" "$BR"; } &&
        echo "land: closed superseded PR #$num ($ref)."
    fi
  done <<<"$OPEN_LAND"
  echo "land: $(git rev-parse --short HEAD) is on $BR with auto-merge on."
  phase "pushed; PR #$PR_NUM open with auto-merge and in the land queue"
  if [ "$WAIT" = 0 ]; then
    echo "land: --no-wait; not landed until PR #$PR_NUM ($BR) shows merged."
    exit 0
  fi

  # Wait for the merge (required checks take ~7 min, a queue wait several PRs'
  # worth). One REST read a minute; scripts/lib/landGh.mjs decidePoll says
  # what it means. DIRTY (a conflict, usually a file another landing changed)
  # the queue cannot resolve: it passes this PR over, so it loops back to the
  # local rebase at once. BEHIND is the land queue's job (it rebases only the
  # head of the queue), so it waits. A GitHub that does not answer (HTTP 503,
  # 2026-10-03; GraphQL refused, #2672) is asked again next minute, but only
  # for UNANSWERED_LIMIT_MIN minutes in a row, and the 180-minute limit holds
  # through it. Only REQUIRED checks decide (an optional one failing does not
  # block the merge). Guard: src/test/landGh.test.ts.
  waited=0
  UNANSWERED=0
  while :; do
    sleep 60
    waited=$((waited + 1))
    POLL=$(node "$LAND_FROZEN_DIR/landGh.mjs" poll "$PR_NUM" "$waited" "$UNANSWERED" 2>/dev/null) || POLL=$(printf 'unanswered\t-\tlandGh.mjs exited non-zero')
    VERDICT=$(cut -f1 <<<"$POLL")
    MSS=$(cut -f2 <<<"$POLL")
    DETAIL=$(cut -f3- <<<"$POLL")
    if [ "$UNANSWERED" -gt 0 ] && [ "$VERDICT" != unanswered ]; then UNANSWERED=0; fi
    # The landing is over either way: its claim goes (landing claims, above).
    if [ "$VERDICT" = merged ] || [ "$VERDICT" = closed ]; then
      node "$LAND_FROZEN_DIR/landClaims.mjs" release "$CLAIM_BRANCH" || true
    fi
    case "$VERDICT" in
      merged)
        echo "land: $BR merged into main."
        # The recount record (landRecount.mjs) lives until the landing merges.
        rm -f "$(git rev-parse --git-path land-recount.json)"
        exit 0
        ;;
      closed)
        echo "land: $BR was closed without merging." >&2
        exit 1
        ;;
      failed)
        echo "land: checks failed on $BR: $DETAIL" >&2
        echo "land: fix, commit, and re-run bash scripts/land.sh." >&2
        exit 1
        ;;
      rebase)
        echo "land: $BR $DETAIL; rebasing it here (the queue skips it until then)."
        break
        ;;
      timeout)
        echo "land: $BR: $DETAIL (PR #$PR_NUM, last state $MSS); stopping. Look at the PR, then re-run bash scripts/land.sh." >&2
        exit 1
        ;;
      unanswered)
        UNANSWERED=$((UNANSWERED + 1))
        echo "land: GitHub did not answer ($DETAIL); $UNANSWERED min in a row, asking again in a minute."
        ;;
      wait)
        [ $((waited % 5)) -eq 0 ] && echo "land: waiting on PR #$PR_NUM ($MSS), $waited min."
        ;;
      *)
        echo "land: unexpected answer from landGh.mjs poll: $POLL" >&2
        exit 1
        ;;
    esac
    # Advance the queue from HERE every 10 minutes, then also wake the
    # workflow. The workflow's own advancer is an Actions job, and on GitHub
    # Free's 20 runners it starves behind the queued PRs' checks: 2026-10-12
    # its 5-minute job waited ~60 min for a runner (run created 06:07, done
    # 07:11), 99 of 100 runs since 05:00 were cancelled pending, and the
    # queue merged 2 PRs in 3 h with 50 waiting. The same script run here
    # needs no runner. It speaks GraphQL (gh pr update-branch --rebase,
    # server-side, no force-push from this machine), so in a cloud session
    # it fails and only the dispatch remains. Guard: src/test/landQueue.test.ts.
    if [ $((waited % 10)) -eq 0 ]; then
      if ADV=$(node scripts/land-queue.mjs 2>/dev/null); then
        echo "land: advanced the land queue from here: $(tr '\n' ' ' <<<"$ADV" | cut -c1-200)"
      fi
      gh workflow run land-queue.yml --ref main >/dev/null 2>&1 || true
    fi
  done
  phase "PR went DIRTY; back to the rebase"
  if [ "$attempt" -ge 8 ]; then
    echo "land: main moved $attempt times while $BR waited; re-run." >&2
    exit 1
  fi
done
