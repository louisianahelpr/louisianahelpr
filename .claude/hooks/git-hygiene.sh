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
exit 0
