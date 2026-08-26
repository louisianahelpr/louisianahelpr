#!/usr/bin/env sh
# Reject two migrations sharing one version prefix.
#
# `version` is the primary key of supabase_migrations.schema_migrations, so if
# two files carry the same timestamp git merges them happily and then
# `supabase db push` dies inserting the second — taking every LATER migration
# down with it. That is not hypothetical: on 2026-08-25 two sessions both
# stamped 20260825190000, the deploy pipeline went red for three consecutive
# runs, and three unrelated migrations sat stranded behind the collision until
# someone re-timestamped the loser by hand.
#
# Parallel work makes this likely rather than unlucky: everyone reaches for a
# round timestamp, so collisions cluster on the hour. Cheap to check, expensive
# to discover in CI.
set -e

MIG_DIR="supabase/migrations"
[ -d "$MIG_DIR" ] || exit 0

dupes=$(ls "$MIG_DIR" | grep -E '^[0-9]{14}_' | sed 's/_.*//' | sort | uniq -d)

if [ -n "$dupes" ]; then
  echo "✗ Duplicate migration version(s) — the deploy will fail on the second one:"
  for v in $dupes; do
    echo ""
    echo "  version $v is claimed by:"
    ls "$MIG_DIR" | grep "^${v}_" | sed 's/^/    /'
  done
  echo ""
  echo "  Fix: rename all but one to a free timestamp (a later minute is fine)."
  echo "  If one of them is ALREADY applied in prod, the applied file keeps the"
  echo "  version and the other one moves — check with:"
  echo "    select version, name from supabase_migrations.schema_migrations"
  echo "    where version = '<version>';"
  exit 1
fi
