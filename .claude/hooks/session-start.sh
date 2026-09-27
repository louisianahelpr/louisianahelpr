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
  LH_SUPABASE_WORKDIR="${LH_SUPABASE_WORKDIR:-$LH_LINKED0}" \
    node "$LH_DIR0/scripts/scoreboard.mjs" --open-block 2>/dev/null || true
  echo
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
