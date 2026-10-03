#!/bin/bash
set -euo pipefail

# OPEN WORK, first of all (docs/OPEN.md Q58c): the block that heads
# docs/OPEN.md, with ONE open-work number (owner, 2026-09-27). The alert
# ledger, nightly-red issues and the audit bus are feeds mirrored into OPEN.md
# by scripts/open-sync-trackers.mjs; a source not yet mirrored is named.
# Never fails session start.
LH_DIR0="${CLAUDE_PROJECT_DIR:-.}"
if command -v node >/dev/null 2>&1 && [ -f "$LH_DIR0/scripts/scoreboard.mjs" ]; then
  LH_LINKED0="$LH_DIR0"
  if [ ! -f "$LH_DIR0/supabase/.temp/project-ref" ]; then
    LH_COMMON0="$(git -C "$LH_DIR0" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [ -n "$LH_COMMON0" ] && [ -f "$(dirname "$LH_COMMON0")/supabase/.temp/project-ref" ]; then
      LH_LINKED0="$(dirname "$LH_COMMON0")"
    fi
  fi
  # The queue is read from ORIGIN/MAIN after a fetch, never from this checkout:
  # on 2026-10-02 the shared checkout sat on a stale branch and printed
  # "111 open" while origin/main had 182 + 48 partly done. The scripts that
  # count it are also taken from origin/main (a stale checkout's scoreboard.mjs
  # counts the old way), extracted once per main sha into the git dir.
  # Guard: src/test/openBlockReadsRef.test.ts.
  LH_SHA0=""
  perl -e 'alarm shift; exec @ARGV' 10 git -C "$LH_DIR0" fetch -q origin main 2>/dev/null || true
  LH_SHA0="$(git -C "$LH_DIR0" rev-parse --verify -q 'origin/main^{commit}' 2>/dev/null || true)"
  LH_RAN0=""
  if [ -n "$LH_SHA0" ] && [ -n "${LH_COMMON0:=$(git -C "$LH_DIR0" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)}" ]; then
    LH_CACHE0="$LH_COMMON0/lh-open-block/$LH_SHA0"
    if [ ! -f "$LH_CACHE0/scripts/scoreboard.mjs" ]; then
      rm -rf "$LH_COMMON0/lh-open-block" 2>/dev/null || true
      mkdir -p "$LH_CACHE0" && git -C "$LH_DIR0" archive "$LH_SHA0" scripts 2>/dev/null | tar -x -C "$LH_CACHE0" 2>/dev/null || true
    fi
    if [ -f "$LH_CACHE0/scripts/scoreboard.mjs" ] && grep -q -- '--ref' "$LH_CACHE0/scripts/scoreboard.mjs"; then
      LH_SUPABASE_WORKDIR="${LH_SUPABASE_WORKDIR:-$LH_LINKED0}" \
        node "$LH_CACHE0/scripts/scoreboard.mjs" --open-block --ref "$LH_SHA0" --repo "$LH_DIR0" 2>/dev/null && LH_RAN0=1
    fi
  fi
  if [ -z "$LH_RAN0" ]; then
    echo "(open block: origin/main unreadable or predates --ref; counts below are THIS checkout's and may be stale)"
    LH_SUPABASE_WORKDIR="${LH_SUPABASE_WORKDIR:-$LH_LINKED0}" \
      node "$LH_DIR0/scripts/scoreboard.mjs" --open-block 2>/dev/null || true
  fi
  echo
fi

# STRANDED WORK on this machine (docs/OPEN.md Q1146; owner 2026-10-03: "nothing
# should ever be left stranded"): the last background report written by
# git-hygiene.sh (scripts/stranded-work.mjs --local). Land each item with
# bash scripts/land.sh, or back it up and delete it once its content is on
# main. Never fails session start.
LH_STRANDED="$HOME/.lh-hygiene/stranded.json"
if [ -f "$LH_STRANDED" ] && command -v node >/dev/null 2>&1; then
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const idle = (r.local || []).filter((i) => !i.active);
    if (!idle.length) process.exit(0);
    console.log(`STRANDED WORK on this machine: ${idle.length} item(s) not on main (report ${r.checkedAt.slice(0, 16)}Z; npm run stranded):`);
    for (const i of idle.slice(0, 8)) console.log(`  ${i.kind} ${i.id}`);
    if (idle.length > 8) console.log(`  ... ${idle.length - 8} more`);
    console.log("");
  ' "$LH_STRANDED" 2>/dev/null || true
fi

# SessionStart hook — installs npm dependencies so Claude Code on the web
# can run the typecheck, linter, and tests during the session.
#
# Only needed in the remote (web) environment; on a local machine the
# developer already has node_modules, so this is a no-op there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# `npm install` (not `npm ci`) so the cached container layer is reused
# across sessions. The package.json `prepare` script tolerates a missing
# git-hooks setup (`husky || true`), so it is safe in a fresh container.
npm install
