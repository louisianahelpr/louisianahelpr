#!/usr/bin/env bash
#
# Fail if two migration files share a timestamp prefix.
#
# Supabase keys schema_migrations on the VERSION (the numeric prefix), not the
# filename. Two files with the same prefix therefore cannot both apply: the
# first inserts the version, the second dies on a primary-key conflict —
#
#   ERROR: duplicate key value violates unique constraint
#   "schema_migrations_pkey" (SQLSTATE 23505)
#
# and because `supabase db push` is sequential, EVERY migration queued behind
# it is blocked too. That is not a one-file problem, it takes the whole prod
# deploy pipeline down until someone renames the file.
#
# This happened on 2026-08-25 (20260826040000 used by both
# cancellation_ladder_and_job_field_lock and cron_http_failure_watcher) and it
# went unnoticed because the guard that checks for it only ran on
# pull_request — and this repo commits straight to main.
#
# Lives in a script, not inline YAML, so the PR guard and the deploy pre-flight
# cannot drift apart.

set -euo pipefail

MIGRATIONS_DIR="${1:-supabase/migrations}"

if ! compgen -G "$MIGRATIONS_DIR/*.sql" > /dev/null; then
  echo "No migration files in $MIGRATIONS_DIR — nothing to check."
  exit 0
fi

# Conventional filename is <timestamp>_<description>.sql; the prefix alone is
# the version key. Anything that doesn't match is reported separately rather
# than silently skipped, because an unparseable name is its own problem.
PREFIXES=$(ls "$MIGRATIONS_DIR"/*.sql | sed -E 's|.*/([0-9]+)_.*|\1|' | sort)
DUPLICATES=$(echo "$PREFIXES" | uniq -d)

if [ -n "$DUPLICATES" ]; then
  echo "❌ Duplicate migration timestamps: $(echo "$DUPLICATES" | tr '\n' ' ')"
  echo ""
  echo "Supabase versions migrations by this prefix, so only ONE of these can"
  echo "ever apply. The other will fail with a schema_migrations primary-key"
  echo "conflict and block every migration queued behind it."
  echo ""
  echo "Files involved:"
  for D in $DUPLICATES; do
    ls "$MIGRATIONS_DIR"/${D}_*.sql 2>/dev/null || true
  done
  echo ""
  echo "Fix: rename the newer file with a later timestamp, e.g."
  echo "  git mv $MIGRATIONS_DIR/<file>.sql $MIGRATIONS_DIR/$(date -u +%Y%m%d%H%M%S)_<description>.sql"
  exit 1
fi

echo "✅ No duplicate migration timestamps ($(echo "$PREFIXES" | wc -l | tr -d ' ') migrations checked)."
