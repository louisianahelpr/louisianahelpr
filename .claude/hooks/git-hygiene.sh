#!/bin/bash
# SessionStart hook — prune worktrees and local branches that provably hold no work.
#
# Runs scripts/prune-git-hygiene.mjs --auto in the BACKGROUND and returns at once.
# --auto means: --apply, at most once per 6h (stamp in ~/.lh-hygiene/last-run),
# single-flight lock, 5-minute time box, output appended to ~/.lh-hygiene/hygiene.log.
# The safety rules (never main, never locked/dirty/unmerged/busy/young, no --force,
# `git branch -d` only) live in the script; read its header before changing them.
#
# A hook that can fail or slow a session start is a hook that gets removed, so
# every path here exits 0 and nothing is waited on.

dir="${CLAUDE_PROJECT_DIR:-.}"
script="$dir/scripts/prune-git-hygiene.mjs"
[ -f "$script" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
mkdir -p "$HOME/.lh-hygiene" 2>/dev/null || exit 0

(cd "$dir" && nohup node "$script" --auto >>"$HOME/.lh-hygiene/hygiene.log" 2>&1 </dev/null &) >/dev/null 2>&1

# Stranded work on THIS machine (docs/OPEN.md Q1146): branches, worktree HEADs,
# uncommitted and untracked worktree files, stash entries whose CONTENT is not
# on main. Written at most every 3h, in the background; session-start.sh prints
# the last report, so every session sees it. GitHub's half runs in CI
# (branch-prune.yml, job `stranded`).
stranded="$dir/scripts/stranded-work.mjs"
report="$HOME/.lh-hygiene/stranded.json"
if [ -f "$stranded" ] && [ -z "$(find "$report" -mmin -180 2>/dev/null)" ]; then
  (cd "$dir" && nohup nice node "$stranded" --local --report "$report" >>"$HOME/.lh-hygiene/stranded.log" 2>&1 </dev/null &) >/dev/null 2>&1
fi
exit 0
