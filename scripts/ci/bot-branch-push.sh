#!/usr/bin/env bash
# The ONLY way a workflow pushes a bot/* branch (src/test/botBranchPushKeepsHumanCommits.test.ts).
#
# Why (2026-09-30): .github/actions/refresh-pr rebuilt bot/refresh/<id> from
# latest main and `git push --force`d it every run. A person who pushed a fix
# onto the refresh PR to make it green (90fa25368 on bot/refresh/loading-states:
# EntryChoiceSkeleton -> shared <Skeleton>, 3 stale baseline entries dropped)
# had it wiped by the next bot run (926ebcbe0), so the PR could never go green.
#
# Rule: the bot never discards a commit it did not author.
#   - Every commit on the remote branch ahead of BASE is the bot's own (or a
#     clean "merge main in" whose tree is exactly what git's merge produces):
#     the branch is replaced, with --force-with-lease=<ref>:<sha it read>.
#   - Otherwise the non-bot commits are replayed onto BASE, the bot's fresh
#     commit (HEAD, if any) goes on top of them, and that is pushed with the
#     same lease. A merge commit whose own edits (its tree vs git's merge of
#     its parents) all fall inside --regenerated (the refresh's declared paths,
#     which the bot rebuilds every run) is the bot's to replace: GitHub's
#     "Update branch" resolving a conflict in a generated file left
#     bot/refresh/open-auto-tick un-pushable for every run of 2026-10-05/06, so
#     nothing was auto-ticked. A conflict anywhere else, or a merge carrying
#     edits outside those paths, pushes NOTHING: exit 3, ::error:: naming every commit it would have
#     dropped, and a PR comment when --pr is given.
#
# Usage (run in a checkout whose HEAD is BASE, or BASE plus ONE bot commit):
#   bot-branch-push.sh push    --remote R --branch B --base REF --bot-email E [--pr N --repo O/R] [--regenerated "<paths, newline or space separated>"]
#   bot-branch-push.sh foreign --remote R --branch B --base REF --bot-email E
#     (prints the non-bot commits on the remote branch, one "sha<TAB>author<TAB>subject" a line)
# Exit: 0 pushed / nothing to do, 2 usage, 3 refused (nothing pushed).
set -euo pipefail

CMD="${1:-}"; shift || true
REMOTE="" BRANCH="" BASE="" BOT_EMAIL="" PR="" REPO="${GITHUB_REPOSITORY:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --remote) REMOTE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --bot-email) BOT_EMAIL="$2"; shift 2 ;;
    --pr) PR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --regenerated) REGENERATED="$2"; shift 2 ;;
    *) echo "bot-branch-push: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$CMD" in push|foreign) ;; *) echo "bot-branch-push: command must be push or foreign" >&2; exit 2 ;; esac
if [ -z "$REMOTE" ] || [ -z "$BRANCH" ] || [ -z "$BASE" ] || [ -z "$BOT_EMAIL" ]; then
  echo "bot-branch-push: --remote, --branch, --base and --bot-email are required" >&2
  exit 2
fi
case "$BRANCH" in bot/*) ;; *) echo "bot-branch-push: refusing to push '$BRANCH' (only bot/* branches)" >&2; exit 2 ;; esac

GITX=(git -c http.https://github.com/.extraheader=)
REF="refs/heads/$BRANCH"
TRACK="refs/bot-branch-push/remote"
BASE_SHA=$(git rev-parse --verify "$BASE^{commit}")
HEAD_SHA=$(git rev-parse HEAD)

REMOTE_SHA=$("${GITX[@]}" ls-remote "$REMOTE" "$REF" | cut -f1)

# Classify every commit on the remote branch that BASE does not have.
# Is every path in the list (stdin) inside the declared regenerated paths?
in_regenerated() {
  local f p
  [ -n "${REGENERATED:-}" ] || return 1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    local hit=0
    for p in $REGENERATED; do
      p="${p%/}"
      if [ "$f" = "$p" ] || [ "${f#"$p"/}" != "$f" ]; then hit=1; break; fi
    done
    [ "$hit" = 1 ] || return 1
  done
  return 0
}
FOREIGN=()   # non-bot, non-merge: replayed
EVIL=()      # merge commits whose tree is not git's own merge result: refused
if [ -n "$REMOTE_SHA" ]; then
  # A depth-1 checkout (actions/checkout's default) gives BASE no parents, so
  # BASE..TRACK would be the repo's whole history and a clean main-merge would
  # have no merge base (morning page run 36904833835: exit 3 on a bot-only
  # branch). Classify against complete history.
  UNSHALLOW=()
  [ "$(git rev-parse --is-shallow-repository)" = true ] && UNSHALLOW=(--unshallow)
  "${GITX[@]}" fetch -q --no-tags ${UNSHALLOW[@]+"${UNSHALLOW[@]}"} "$REMOTE" "+$REF:$TRACK"
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    parents=$(git rev-list --parents -n 1 "$c" | wc -w)
    if [ "$parents" -gt 2 ]; then
      if [ "$parents" -eq 3 ]; then
        p1=$(git rev-parse "$c^1"); p2=$(git rev-parse "$c^2")
        if auto=$(git merge-tree --write-tree "$p1" "$p2" 2>/dev/null | head -n1) \
          && [ "$auto" = "$(git rev-parse "$c^{tree}")" ]; then
          continue   # a clean merge of main: rebasing onto BASE replaces it
        fi
        # A conflicted merge still writes a tree (markers in the conflicted
        # files): its own edits are the files that differ from that tree.
        auto=$(git merge-tree --write-tree "$p1" "$p2" 2>/dev/null | head -n1 || true)
        if [ -n "$auto" ] && git diff --name-only "$auto" "$c^{tree}" | in_regenerated; then
          continue   # only regenerated files differ: the bot rebuilds them
        fi
      fi
      EVIL+=("$c")
    elif [ "$(git log -1 --format=%ae "$c")" != "$BOT_EMAIL" ]; then
      FOREIGN+=("$c")
    fi
  done < <(git rev-list --reverse "$BASE_SHA..$TRACK")
fi

describe() { for c in "$@"; do git log -1 --format=$'%h\t%an <%ae>\t%s' "$c"; done; }

if [ "$CMD" = "foreign" ]; then
  [ ${#FOREIGN[@]} -gt 0 ] && describe "${FOREIGN[@]}"
  [ ${#EVIL[@]} -gt 0 ] && describe "${EVIL[@]}"
  exit 0
fi

refuse() {
  local why="$1"
  git cherry-pick --abort >/dev/null 2>&1 || true
  git checkout -q --force "$HEAD_SHA"
  local list
  list=$( { [ ${#FOREIGN[@]} -gt 0 ] && describe "${FOREIGN[@]}"; [ ${#EVIL[@]} -gt 0 ] && describe "${EVIL[@]}"; } || true)
  echo "::error::bot-branch-push: NOT pushing $BRANCH — $why. Pushing would drop these non-bot commits:"
  printf '%s\n' "$list"
  if [ -n "$PR" ] && [ -n "$REPO" ] && command -v gh >/dev/null 2>&1; then
    gh pr comment "$PR" --repo "$REPO" --body "$(printf 'The refresh bot did **not** push a new measurement to `%s`: %s.\n\nIt will not discard these commits, which are not its own:\n\n```\n%s\n```\n\nRebase them onto main (or fold them into one commit that does not touch the regenerated files) and the next run lands the fresh numbers on top of them.%s\n' \
      "$BRANCH" "$why" "$list" "${RUN_URL:+ Run: $RUN_URL}")" || echo "::warning::bot-branch-push: could not comment on PR #$PR"
  fi
  exit 3
}

if [ ${#EVIL[@]} -gt 0 ]; then
  refuse "a merge commit on it carries edits of its own, which a rebase cannot replay"
fi

if [ ${#FOREIGN[@]} -gt 0 ]; then
  BOT_COMMIT=""
  [ "$HEAD_SHA" != "$BASE_SHA" ] && BOT_COMMIT="$HEAD_SHA"
  git checkout -q --detach "$BASE_SHA"
  for c in "${FOREIGN[@]}"; do
    if ! git cherry-pick --allow-empty "$c" >/dev/null 2>&1; then
      if [ -z "$(git ls-files -u)" ] && git diff --cached --quiet; then
        git cherry-pick --skip   # already on BASE (e.g. its PR merged): nothing is lost
      else
        refuse "replaying $(git rev-parse --short "$c") onto ${BASE_SHA:0:9} conflicts"
      fi
    fi
  done
  if [ -n "$BOT_COMMIT" ] && ! git cherry-pick "$BOT_COMMIT" >/dev/null 2>&1; then
    if [ -z "$(git ls-files -u)" ] && git diff --cached --quiet; then
      git cherry-pick --skip
    else
      refuse "the fresh measurement conflicts with the non-bot commits"
    fi
  fi
  echo "bot-branch-push: kept ${#FOREIGN[@]} non-bot commit(s) on $BRANCH, the bot's commit on top:"
  describe "${FOREIGN[@]}"
fi

if [ -z "$REMOTE_SHA" ]; then
  "${GITX[@]}" push --force-with-lease="$REF:" "$REMOTE" "HEAD:$REF"
else
  "${GITX[@]}" push --force-with-lease="$REF:$REMOTE_SHA" "$REMOTE" "HEAD:$REF"
fi
WAS="${REMOTE_SHA:-none}"
echo "bot-branch-push: $BRANCH -> $(git rev-parse --short HEAD) (was ${WAS:0:9})"
