#!/bin/bash
# SessionStart hook — surface half-landed work before anyone builds on top of it.
#
# WHY THIS EXISTS
# On 2026-09-02, seven files of uncommitted work sat in the shared main tree for
# roughly ten hours while `main` stayed green the whole time. It was a schema
# regeneration (types.ts) plus two of the seventeen files that needed fixing to
# match — real, valuable, and half-done. Nobody noticed, because nothing looks.
# `git status` reports it only if you happen to run it, CI never sees it, and a
# parallel session that resets the tree destroys it silently.
#
# Two sessions then spent real time on forensics — file timestamps and
# error-count fingerprinting — just to work out WHOSE it was, because a working
# tree records no ownership.
#
# This prints a warning and never blocks. A hook that can fail a session start
# is a hook that gets removed, so every path here exits 0.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Hours after which uncommitted work stops being "in progress" and starts being
# "forgotten". Deliberately generous: this should catch rot, not interrupt work.
THRESHOLD_HOURS="${LH_STALE_WIP_HOURS:-3}"
now=$(date +%s)
stale_list=""
stale_count=0
oldest_hours=0

# Tracked-but-modified files only. Untracked files are noisy (scratch dirs,
# editor droppings) and gitignored paths are intentional.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  mtime=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo "$now")
  age_h=$(( (now - mtime) / 3600 ))
  if [ "$age_h" -ge "$THRESHOLD_HOURS" ]; then
    stale_count=$((stale_count + 1))
    [ "$age_h" -gt "$oldest_hours" ] && oldest_hours=$age_h
    [ "$stale_count" -le 10 ] && stale_list="${stale_list}    ${f}  (${age_h}h)"$'\n'
  fi
done < <(git diff --name-only 2>/dev/null; git diff --cached --name-only 2>/dev/null)

[ "$stale_count" -eq 0 ] && exit 0

echo "⚠️  STALE UNCOMMITTED WORK in the shared tree — ${stale_count} file(s), oldest ${oldest_hours}h."
echo
printf '%s' "$stale_list"
[ "$stale_count" -gt 10 ] && echo "    … and $((stale_count - 10)) more"
echo
echo "  This is how SI-012 happened: a schema regeneration and two of its seventeen"
echo "  dependent fixes sat here for ~10h with main green, owned by nobody."
echo
echo "  Before building on top of it, find out what it IS — it may be half-landed"
echo "  work whose remaining half you are about to duplicate or overwrite:"
echo "    git diff --stat                 # what changed"
echo "    npm run typecheck               # does it even compile? half-done work often won't"
echo "    ListAgents / SendMessage        # ask the other sessions if it is theirs"
echo
echo "  Do NOT commit work you did not write, and do NOT reset the tree to clear it."
echo "  Back it up first — 'git diff > backup.patch' — then decide."

exit 0
