#!/bin/bash
# SessionStart hook — delete worktrees and branches that can no longer hold anything.
#
# WHY THIS EXISTS
# On 2026-09-22 the repo had 39 worktrees (~3 GB) and 189 local branches; 166 of
# the branches and 22 of the worktrees were already fully in main. Agents create a
# worktree per lane and nothing ever removed them, so every session paid for it
# in disk, in `git worktree list` noise, and in the owner having to ask.
#
# WHAT IT DELETES — only things that provably hold no work:
#   worktree: no uncommitted/untracked changes, HEAD already in origin/main,
#             untouched for $LH_PRUNE_HOURS, and no running process inside it.
#             A locked worktree is only taken once it is 3x that age.
#   branch:   `git branch -d` (git itself refuses anything unmerged), merged into
#             origin/main, last commit older than $LH_PRUNE_HOURS.
# Anything with unmerged or uncommitted work is LISTED, never touched.
#
# Runs in the background and always exits 0: a hook that can fail or slow a
# session start is a hook that gets removed. Log: .git/lh-prune.log

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

main_tree=$(git rev-parse --show-toplevel)
log="$(git rev-parse --git-common-dir)/lh-prune.log"

(
  set -uo pipefail
  hours="${LH_PRUNE_HOURS:-24}"
  now=$(date +%s)
  min_age=$((hours * 3600))
  base=origin/main
  git rev-parse -q --verify "$base" >/dev/null || exit 0
  echo "== $(date '+%F %T') prune (age >= ${hours}h)"

  # Every directory some live process is sitting in.
  cwds=$(lsof -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')

  git worktree list --porcelain | awk '
    /^worktree /{w=substr($0,10)} /^locked/{l=1}
    /^$/{print (l?"L":"-") "\t" w; w=""; l=0}
    END{if(w!="")print (l?"L":"-") "\t" w}' |
  while IFS=$'\t' read -r locked w; do
    [ "$w" = "$main_tree" ] && continue
    [ -d "$w" ] || continue
    if [ -n "$(git -C "$w" status --porcelain 2>/dev/null)" ]; then echo "keep (uncommitted) $w"; continue; fi
    head=$(git -C "$w" rev-parse HEAD 2>/dev/null) || continue
    if ! git merge-base --is-ancestor "$head" "$base" 2>/dev/null; then echo "keep (unmerged) $w"; continue; fi
    age=$((now - $(stat -f %m "$w")))
    need=$min_age; [ "$locked" = L ] && need=$((min_age * 3))
    [ "$age" -lt "$need" ] && continue
    if printf '%s\n' "$cwds" | grep -q -F -e "$w"; then echo "keep (process inside) $w"; continue; fi
    [ "$locked" = L ] && git worktree unlock "$w" 2>/dev/null
    git worktree remove "$w" 2>&1 && echo "removed worktree $w"
  done
  git worktree prune

  git for-each-ref --merged "$base" --format='%(committerdate:unix) %(refname:short)' refs/heads |
  while read -r ts b; do
    [ "$b" = main ] && continue
    [ $((now - ts)) -lt "$min_age" ] && continue
    git branch -d "$b" >/dev/null 2>&1 && echo "deleted branch $b"
  done
) >>"$log" 2>&1 &

exit 0
