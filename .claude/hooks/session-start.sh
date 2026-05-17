#!/bin/bash
set -euo pipefail

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
