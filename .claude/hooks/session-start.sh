#!/bin/bash
set -euo pipefail

# Open alerts FIRST (CLAUDE.md: every alert is fixed AND verified fixed; read
# them first each session). Prints the open count + top 5 from
# public.ops_alert_ledger (docs/OPEN.md Q1). Read-only, capped at ~8s inside
# the script, and it can never fail session start.
LH_DIR="${CLAUDE_PROJECT_DIR:-.}"
if command -v node >/dev/null 2>&1 && [ -f "$LH_DIR/scripts/ops-alert-ledger.mjs" ]; then
  # The Supabase CLI link lives in the MAIN checkout's supabase/.temp; a
  # worktree session has none, so fall back to the main checkout.
  LH_LINKED="$LH_DIR"
  if [ ! -f "$LH_DIR/supabase/.temp/project-ref" ]; then
    LH_COMMON="$(git -C "$LH_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [ -n "$LH_COMMON" ] && [ -f "$(dirname "$LH_COMMON")/supabase/.temp/project-ref" ]; then
      LH_LINKED="$(dirname "$LH_COMMON")"
    fi
  fi
  LH_SUPABASE_WORKDIR="${LH_SUPABASE_WORKDIR:-$LH_LINKED}" \
    node "$LH_DIR/scripts/ops-alert-ledger.mjs" list --brief 2>/dev/null || true
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
