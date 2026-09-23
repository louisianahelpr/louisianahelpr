#!/usr/bin/env bash
# Restore drill (docs/OPEN.md Q45). Restores a DECRYPTED nightly backup
# (roles.sql, schema.sql, data.sql from .github/workflows/db-backup.yml) into a
# THROWAWAY Postgres and proves it came back: every statement error is
# collected and classified, the key tables are counted and compared with prod,
# and the known restore gaps (docs/runbooks/restore-from-backup.md §3) are
# measured rather than assumed.
#
# NEVER point TARGET_DB_URL at prod. The script refuses any URL containing the
# prod ref or a supabase.co / pooler host.
#
# Usage: scripts/db-restore-drill.sh <dir containing roles.sql schema.sql data.sql>
# Env:
#   TARGET_DB_URL          throwaway database (default: local `supabase start` db)
#   SUPABASE_ACCESS_TOKEN  } for the read-only prod row counts via the Management
#   SUPABASE_PROJECT_REF   } API. Both unset -> the drill FAILS (no comparison is
#                            not a pass).
#   DRILL_OUT              where logs go (default ./drill-out). Contains no row
#                          data: counts and error lines only.
#
# Exit: 0 = restored and within tolerance; 1 = anything else.
set -euo pipefail

DIR="${1:?usage: db-restore-drill.sh <dir with roles.sql schema.sql data.sql>}"
TARGET="${TARGET_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
OUT="${DRILL_OUT:-drill-out}"
KNOWN="$(dirname "$0")/db-restore-drill-known-errors.txt"
mkdir -p "$OUT"
FAIL=0

case "$TARGET" in
  *fncmgoasalhdgfwzhsqa*|*supabase.co*|*pooler.supabase*)
    echo "::error::TARGET_DB_URL points at a hosted Supabase database. The drill only ever restores into a throwaway local Postgres."
    exit 1 ;;
esac
for f in roles schema data; do
  [ -s "$DIR/$f.sql" ] || { echo "::error::$DIR/$f.sql missing or empty"; exit 1; }
done
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "::error::SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF unset — cannot compare with prod, and an uncompared restore is not a pass"
  exit 1
fi

# ── 1. Restore, the way Supabase documents it for a new project ─────────────
# One file at a time and NOT --single-transaction, so a failing statement is
# recorded and the rest still load: the drill's job is to enumerate every
# failure, not stop at the first. data.sql is one multi-row INSERT per table,
# so a failed statement loses a whole table — which the counts below catch.
PSQL=(psql "$TARGET" -X -q -v ON_ERROR_STOP=0)
# Every restore step runs through here: output to <name>.out/.err, and a
# non-zero psql exit is recorded as a failure instead of killing the script
# before it can report which step broke.
step() {
  local name=$1 rc=0; shift
  "${PSQL[@]}" "$@" > "$OUT/$name.out" 2> "$OUT/$name.err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "::error::restore step '$name' exited $rc: $(tail -n 3 "$OUT/$name.err" | tr '\n' ' ')"
    FAIL=1
  fi
}

# What the dump contains, by NAME only (no row data): which tables carry rows.
echo "--- data.sql INSERT targets by schema ---"
{ grep -oE '^INSERT INTO "[a-z_0-9]+"\."[a-zA-Z_0-9]+"' "$DIR/data.sql" || [ $? -eq 1 ]; } \
  | sed -E 's/^INSERT INTO //; s/"//g' | sort -u > "$OUT/data-targets.txt"
cut -d. -f1 "$OUT/data-targets.txt" | sort | uniq -c
echo "non-public targets: $(grep -v '^public\.' "$OUT/data-targets.txt" | tr '\n' ' ')"
echo "storage policies inside schema.sql: $( { grep -cE '^CREATE POLICY .* ON "storage"\.' "$DIR/schema.sql" || [ $? -eq 1 ]; } )"
echo "event triggers inside schema.sql (uncommented): $( { grep -cE '^CREATE EVENT TRIGGER' "$DIR/schema.sql" || [ $? -eq 1 ]; } )"

T0=$(date +%s)
step roles -f "$DIR/roles.sql"
# STEP 1b — close the default-privileges trap BEFORE loading the schema.
# Every Supabase project's pg_default_acl grants anon/authenticated/
# service_role on each new public function, table and sequence. pg_dump
# writes the SOURCE's ACLs as GRANT/REVOKE statements relative to the Postgres
# default, never `REVOKE ... FROM anon`, so a plain load leaves every function
# anon-executable (measured on the first drill, 2026-09-23: 306 of 306, prod
# had 17 of 321). With the defaults revoked for the restoring role, the dump's
# own GRANTs are the only grants, i.e. exactly prod's; the dump's trailing
# ALTER DEFAULT PRIVILEGES statements then put prod's defaults back.
step acl <<'SQL'
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
SQL
step schema -f "$DIR/schema.sql"
# STEP 2b — pgmq queues. schema.sql is `public` only, so the email queues'
# tables (pgmq.q_<name>, pgmq.a_<name>) do not exist in a new project and their
# rows and sequence positions fail to load. Create each queue the dump names
# first. pgmq.create() also writes pgmq.meta, which data.sql restores itself,
# so those rows are cleared to avoid duplicate-key failures.
QUEUES=$( { grep -oE 'pgmq"?\."?[qa]_[a-z0-9_]+' "$DIR/data.sql" || [ $? -eq 1 ]; } \
  | sed -E 's/^pgmq"?\."?[qa]_//; s/_msg_id_seq$//' | sort -u | tr '\n' ' ')
echo "pgmq queues named by the dump: ${QUEUES:-none}"
{
  echo "CREATE EXTENSION IF NOT EXISTS pgmq;"
  for q in $QUEUES; do
    echo "SELECT pgmq.create('$q') WHERE NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = '$q');"
  done
  if grep -q '^INSERT INTO "pgmq"\."meta"' "$DIR/data.sql"; then echo "DELETE FROM pgmq.meta;"; fi
} > "$OUT/pgmq.sql"
step pgmq -f "$OUT/pgmq.sql"
# STEP 2c — the ensure_rls event trigger. The CLI's schema dump comments event
# triggers out, and this one is ours (created from the dashboard, in no
# migration): it turns RLS on for every new public table. Measured on the
# first drill: 6 event triggers restored, prod has 7, ensure_rls the missing one.
step evt <<'SQL'
DO $$ BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
END $$;
SQL
# DRILL-VENUE ONLY: the local `supabase start` storage image lags hosted
# storage, and prod's storage.buckets has two columns it lacks — so the dump's
# single buckets INSERT fails and every bucket is lost. A hosted project being
# restored into is at least as new as prod and has them; adding them here keeps
# the drill measuring the BACKUP, not the CLI's image version. Types measured
# on prod 2026-09-23 (information_schema.columns).
# storage.buckets is owned by the storage admin, so this one runs as the local
# stack's supabase_admin (default local password; never a hosted role).
PSQL_TARGET_SAVED=("${PSQL[@]}")
PSQL=(psql "${TARGET/postgres:postgres@/supabase_admin:postgres@}" -X -q -v ON_ERROR_STOP=0)
step venue <<'SQL'
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS lifecycle_configuration jsonb;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS lifecycle_configuration_generation uuid;
SQL
PSQL=("${PSQL_TARGET_SAVED[@]}")
step data -c 'SET session_replication_role = replica' -f "$DIR/data.sql"
# STEP 4 — cron schedules (db-backup.yml exports them as cron.sql; the data
# dump carries none). Loaded, then ALL deactivated in the same transaction: on
# a real restore they are switched back on only after the vault secrets they
# call through exist (runbook §4). Required: a backup without them is a
# restore that silently stops releasing payments.
if [ -s "$DIR/cron.sql" ]; then
  step cron -1 -f "$DIR/cron.sql" -c 'SELECT cron.alter_job(jobid, active := false) FROM cron.job'
else
  echo "::error::backup has no cron.sql — the $(date -u +%F) restore would bring back zero cron schedules"
  : > "$OUT/cron.err"
  FAIL=1
fi
# STEP 5 — storage RLS policies (db-backup.yml exports them as
# storage-policies.sql; schema.sql is `public` only). storage.objects is owned
# by the storage admin, so locally this runs as supabase_admin; on a hosted
# project the dashboard SQL editor's role can create them.
EXPECT_SPOL=0
if [ -s "$DIR/storage-policies.sql" ]; then
  EXPECT_SPOL=$( { grep -c '^CREATE POLICY ' "$DIR/storage-policies.sql" || [ $? -eq 1 ]; } )
  PSQL=(psql "${TARGET/postgres:postgres@/supabase_admin:postgres@}" -X -q -v ON_ERROR_STOP=0)
  step spol -f "$DIR/storage-policies.sql"
  PSQL=("${PSQL_TARGET_SAVED[@]}")
else
  echo "::error::backup has no storage-policies.sql — a restore would leave every private bucket unreadable"
  : > "$OUT/spol.err"
  FAIL=1
fi
T1=$(date +%s)
RESTORE_SECS=$((T1 - T0))
echo "restore wall time: ${RESTORE_SECS}s"

# ── 2. Classify every error ──────────────────────────────────────────────────
# Known-benign errors are listed, each with a reason, in
# scripts/db-restore-drill-known-errors.txt as `<file>|<regex>|<reason>`.
# Anything not listed fails the drill — a new restore error is exactly what
# this exists to notice.
: > "$OUT/errors-unexpected.txt"
: > "$OUT/errors-known.txt"
for f in roles acl schema pgmq evt venue data cron spol; do
  # grep exits 1 on no match, which is a legitimate "no errors".
  { grep -E '(ERROR|FATAL):' "$OUT/$f.err" || [ $? -eq 1 ]; } | while IFS= read -r line; do
    matched=""
    while IFS='|' read -r kf kre _reason; do
      case "$kf" in ''|\#*) continue ;; esac
      if [ "$kf" = "$f" ] && printf '%s' "$line" | grep -qE "$kre"; then matched=1; break; fi
    done < "$KNOWN"
    if [ -n "$matched" ]; then echo "$f: $line" >> "$OUT/errors-known.txt"
    else echo "$f: $line" >> "$OUT/errors-unexpected.txt"; fi
  done
done
N_KNOWN=$(wc -l < "$OUT/errors-known.txt" | tr -d ' ')
N_UNEXP=$(wc -l < "$OUT/errors-unexpected.txt" | tr -d ' ')
echo "errors: $N_KNOWN known-benign, $N_UNEXP unexpected"
if [ "$N_UNEXP" -gt 0 ]; then
  echo "::error::$N_UNEXP unexpected restore error(s):"
  cat "$OUT/errors-unexpected.txt"
  FAIL=1
fi

# ── 3. Key tables: restored vs prod ──────────────────────────────────────────
# The money record lives here and nowhere else (Stripe knows what it charged,
# only this DB knows what the platform promised whom), so the ledger tables are
# in the list beside the marketplace ones.
TABLES=(
  auth.users public.profiles public.jobs public.applications public.messages
  public.notifications public.reviews public.disputes public.payout_transfers
  public.payment_refunds public.instant_payouts public.gift_cards
  public.dispute_settlement_claims public.referral_credits cron.job storage.buckets storage.objects
)
SQL=""
for t in "${TABLES[@]}"; do
  [ -n "$SQL" ] && SQL="$SQL union all "
  SQL="${SQL}select '$t' as t, count(*)::bigint as n from $t"
done
PROD_JSON=$(curl -sS --fail-with-body -X POST \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H 'Content-Type: application/json' \
  --data "$(jq -n --arg q "$SQL" '{query: $q}')")
printf '%s' "$PROD_JSON" | jq -e 'type == "array" and length > 0' > /dev/null \
  || { echo "::error::prod count query returned no rows: $PROD_JSON"; exit 1; }

printf '| table | prod now | restored | verdict |\n|---|---:|---:|---|\n' > "$OUT/counts.md"
for t in "${TABLES[@]}"; do
  p=$(printf '%s' "$PROD_JSON" | jq -r --arg t "$t" '.[] | select(.t == $t) | .n')
  if r=$(psql "$TARGET" -X -At -c "select count(*) from $t" 2>> "$OUT/counts.err"); then :; else r="MISSING"; fi
  verdict="ok"
  if [ "$r" = "MISSING" ]; then verdict="FAIL: table did not restore"; FAIL=1
  elif [ "$p" -gt 0 ] && [ "$r" -eq 0 ]; then verdict="FAIL: prod has rows, restore has none"; FAIL=1
  else
    diff=$(( r > p ? r - p : p - r ))
    tol=$(( p / 2 > 50 ? p / 2 : 50 ))
    if [ "$diff" -gt "$tol" ]; then verdict="FAIL: off by $diff (tolerance $tol)"; FAIL=1
    elif [ "$diff" -gt 0 ]; then verdict="ok (drift $diff since the backup)"; fi
  fi
  printf '| %s | %s | %s | %s |\n' "$t" "$p" "$r" "$verdict" >> "$OUT/counts.md"
done
cat "$OUT/counts.md"

# ── 4. The known gaps, measured on the restored copy (reported, not failed) ──
# These are the runbook's §3 traps. They are expected to be wrong after a raw
# restore; the numbers say how wrong, so the runbook's repair steps stay true.
gap() { psql "$TARGET" -X -At -c "$1" 2>> "$OUT/counts.err" || echo "n/a"; }
ANON_EXEC=$(gap "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and array_to_string(p.proacl,',') like '%anon=X%'")
FUNCS=$(gap "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'")
PUB=$(gap "select count(*) from pg_publication_tables where pubname='supabase_realtime'")
EVT=$(gap "select count(*) from pg_event_trigger")
LEDGER=$(gap "select count(*) from supabase_migrations.schema_migrations")
PUBTABLES=$(gap "select count(*) from pg_tables where schemaname='public'")
POLICIES=$(gap "select count(*) from pg_policies where schemaname='public'")
{
  echo
  echo "| restored-copy gap | value |"
  echo "|---|---|"
  echo "| restore wall time (roles+schema+data) | ${RESTORE_SECS}s |"
  echo "| public tables | $PUBTABLES |"
  echo "| public RLS policies | $POLICIES |"
  echo "| public functions anon can EXECUTE (runbook §3.1 trap) | $ANON_EXEC of $FUNCS |"
  echo "| supabase_realtime publication tables | $PUB |"
  echo "| event triggers | $EVT |"
  echo "| migration ledger rows | $LEDGER |"
  echo "| restore errors known-benign / unexpected | $N_KNOWN / $N_UNEXP |"
} >> "$OUT/counts.md"
tail -n 11 "$OUT/counts.md"

# ── 5. The ACL trap is a FAILURE, not a note ────────────────────────────────
# A restore that makes admin_* functions callable by anyone is not a restore.
# The dump itself says which functions anon may execute: one GRANT per
# function to "anon". The restored copy must not exceed it.
EXPECT_ANON=$( { grep -cE '^GRANT ALL ON FUNCTION .* TO "anon";' "$DIR/schema.sql" || [ $? -eq 1 ]; } )
echo "functions the dump grants to anon: ${EXPECT_ANON:-0}; anon-executable after restore: $ANON_EXEC"
if [ "$ANON_EXEC" = "n/a" ] || [ "$ANON_EXEC" -gt "${EXPECT_ANON:-0}" ]; then
  echo "::error::restored copy lets anon EXECUTE $ANON_EXEC public functions; the backup grants anon only ${EXPECT_ANON:-0} (default-privileges trap, runbook step 1b)"
  FAIL=1
fi

SPOL=$(gap "select count(*) from pg_policies where schemaname='storage'")
echo "storage policies in the backup: $EXPECT_SPOL; on the restored copy: $SPOL"
if [ "$SPOL" = "n/a" ] || [ "$SPOL" -lt "$EXPECT_SPOL" ] || [ "$EXPECT_SPOL" -eq 0 ]; then
  echo "::error::storage RLS policies did not restore ($SPOL of $EXPECT_SPOL) — private buckets would be unreadable"
  FAIL=1
fi

# ── 6. Diagnostics by NAME (no row data) ─────────────────────────────────────
echo "--- event triggers on the restored copy ---"
gap "select string_agg(evtname, ', ' order by evtname) from pg_event_trigger"
echo "--- public tables in prod but not restored (includes tables added after the backup) ---"
PROD_TABLES=$(curl -sS --fail-with-body -X POST \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H 'Content-Type: application/json' \
  --data '{"query":"select tablename from pg_tables where schemaname = '"'"'public'"'"' order by 1"}' \
  | jq -r '.[].tablename')
REST_TABLES=$(gap "select tablename from pg_tables where schemaname='public' order by 1")
echo "prod public tables: $(printf '%s\n' "$PROD_TABLES" | grep -c .); restored: $(printf '%s\n' "$REST_TABLES" | grep -c .)"
comm -23 <(printf '%s\n' "$PROD_TABLES" | sort) <(printf '%s\n' "$REST_TABLES" | sort)
echo "--- default privileges on the restored copy ---"
gap "select pg_get_userbyid(defaclrole)||' '||defaclobjtype::text||' '||array_to_string(defaclacl, ',') from pg_default_acl"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "## Restore drill"; cat "$OUT/counts.md"; } >> "$GITHUB_STEP_SUMMARY"
fi
exit "$FAIL"
