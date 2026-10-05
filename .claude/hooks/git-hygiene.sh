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
# Weekly disk cleanup (owner, 2026-10-04: "make this automatic"). At most once a
# week (stamp ~/.lh-hygiene/disk-last-run), in the background:
#   - screenshots in ~/.lh-shots older than 7 days (recent review evidence stays);
#   - the npm download cache (it re-downloads on demand);
#   - worktree FOLDERS of finished work: unlocked, nothing uncommitted, last
#     commit older than 3 days. `git worktree remove` keeps the branch, so no
#     commit is lost; a folder with uncommitted changes is never touched (the
#     stranded report above names it instead).
disk_stamp="$HOME/.lh-hygiene/disk-last-run"
if [ -z "$(find "$disk_stamp" -mtime -7 2>/dev/null)" ]; then
  touch "$disk_stamp"
  (
    find "$HOME/.lh-shots" -type f -mtime +7 -delete 2>/dev/null
    find "$HOME/.lh-shots" -type d -empty -delete 2>/dev/null
    command -v npm >/dev/null 2>&1 && npm cache clean --force >/dev/null 2>&1
    cd "$dir" && git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r w; do
      [ "$w" = "$(git rev-parse --show-toplevel)" ] && continue
      git worktree list --porcelain | grep -A3 "^worktree $w\$" | grep -q '^locked' && continue
      [ -n "$(git -C "$w" status --porcelain 2>/dev/null)" ] && continue
      [ -z "$(git -C "$w" log -1 --since='3 days ago' --format=%h 2>/dev/null)" ] || continue
      git worktree remove "$w" 2>/dev/null && echo "$(date -u +%FT%TZ) disk-cleanup removed worktree folder $w (branch kept)"
    done
  ) >>"$HOME/.lh-hygiene/hygiene.log" 2>&1 </dev/null &
fi
# Weekly backup of every LOCAL branch and stash entry (owner, 2026-10-04: 62 of
# 99 branches existed only on this Mac; "be sure it never happens again").
# One git bundle per week in ~/.lh-backups (the newest 4 kept), so work that
# never reached GitHub survives a lost worktree or a bad prune. Off-Mac copy:
# the owner decides after the triage (docs/OPEN.md Q1304).
bak_stamp="$HOME/.lh-hygiene/branch-backup-last-run"
if [ -z "$(find "$bak_stamp" -mtime -7 2>/dev/null)" ]; then
  touch "$bak_stamp"
  (
    cd "$dir" || exit 0
    mkdir -p "$HOME/.lh-backups"
    i=0
    git stash list --format=%H 2>/dev/null | while read -r h; do git update-ref "refs/stash-backup/s$i" "$h"; i=$((i+1)); done
    out="$HOME/.lh-backups/local-branches-$(date +%Y-%m-%d).bundle"
    git bundle create "$out" --branches $(git for-each-ref --format='%(refname)' refs/stash-backup) >/dev/null 2>&1 \
      && git bundle verify "$out" >/dev/null 2>&1 \
      && echo "$(date -u +%FT%TZ) branch-backup wrote $out" \
      && ls -1t "$HOME"/.lh-backups/local-branches-*.bundle 2>/dev/null | tail -n +5 | while read -r old; do rm -f "$old"; done
  ) >>"$HOME/.lh-hygiene/hygiene.log" 2>&1 </dev/null &
fi
exit 0
