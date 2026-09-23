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
T0=$(date +%s)
"${PSQL[@]}" -f "$DIR/roles.sql"  > "$OUT/roles.out"  2> "$OUT/roles.err"
"${PSQL[@]}" -f "$DIR/schema.sql" > "$OUT/schema.out" 2> "$OUT/schema.err"
"${PSQL[@]}" -c 'SET session_replication_role = replica' -f "$DIR/data.sql" > "$OUT/data.out" 2> "$OUT/data.err"
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
for f in roles schema data; do
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
  public.dispute_settlement_claims public.referral_credits cron.job storage.objects
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
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "## Restore drill"; cat "$OUT/counts.md"; } >> "$GITHUB_STEP_SUMMARY"
fi
exit "$FAIL"
