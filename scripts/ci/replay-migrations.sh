#!/usr/bin/env bash
# Replay every migration into a throwaway Supabase Postgres — the ONE way CI
# does it. Extracted verbatim from db-smoke.yml (which now calls this) so the
# race runner (race-runner.yml) replays exactly what the deploy gate replays.
#
# Needs PGHOST/PGUSER/PGPASSWORD/PGDATABASE in the environment.
#
# EXCLUDE_MIGRATIONS (optional, space-separated timestamp prefixes) leaves
# those files out. It exists for ONE purpose: proving a check red against the
# pre-fix migration set (e.g. EXCLUDE_MIGRATIONS=20260913014328). The deploy
# gate never sets it.
set -euo pipefail

echo "::group::bootstrap"
psql -v ON_ERROR_STOP=1 <<'SQL'
-- 1. supabase_realtime publication
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication shim skipped: %', SQLERRM;
END $$;

-- 2. Reserved roles (newer images already have them)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'role shim skipped: %', SQLERRM;
END $$;

-- 3. storage.buckets columns (idempotent ADD COLUMN IF NOT EXISTS)
DO $$ BEGIN
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    owner uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );
  ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS public boolean DEFAULT false;
  ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS avif_autodetection boolean DEFAULT false;
  ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint;
  ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[];
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'storage shim skipped: %', SQLERRM;
END $$;

-- 4. Realtime shims. The supabase/postgres image creates the
-- realtime schema owned by supabase_admin; postgres can't write
-- in it without ownership. Reassign + grant first, then create.
DO $$ BEGIN
  CREATE SCHEMA IF NOT EXISTS realtime;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  EXECUTE 'ALTER SCHEMA realtime OWNER TO postgres';
  EXECUTE 'GRANT ALL ON SCHEMA realtime TO postgres';
  EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA realtime TO postgres';
  EXECUTE 'GRANT ALL ON ALL FUNCTIONS IN SCHEMA realtime TO postgres';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime ownership reassign skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS realtime.messages (
    id bigserial PRIMARY KEY,
    topic text,
    extension text,
    payload jsonb,
    event text,
    private boolean,
    updated_at timestamptz DEFAULT now(),
    inserted_at timestamptz DEFAULT now()
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime.messages shim skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE AS $rt$ SELECT current_setting('realtime.topic', true) $rt$;
  CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT false)
    RETURNS void LANGUAGE sql AS $rt$ SELECT NULL::void $rt$;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime function shim skipped: %', SQLERRM;
END $$;

-- 4b. auth.jwt() shim.
--
-- The CI image ships auth.uid()/auth.role() but NOT auth.jwt(), so
-- any policy that reads a JWT claim dies with "function auth.jwt()
-- does not exist" and takes the whole replay down with it. That is a
-- gap in this harness, not a defect in the migration — on real
-- Supabase the function exists — so shim it to the same definition
-- Supabase uses.
--
-- Created only when absent: CREATE OR REPLACE would silently
-- overwrite the real implementation if a future image does ship one,
-- which would turn a passing smoke run into a meaningless one.
DO $$ BEGIN
  IF to_regprocedure('auth.jwt()') IS NULL THEN
    CREATE FUNCTION auth.jwt() RETURNS jsonb
      LANGUAGE sql STABLE
      AS $jwt$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $jwt$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'auth.jwt() shim skipped: %', SQLERRM;
END $$;

-- 5. auth.users column shims (older image schemas).
DO $$ BEGIN
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb DEFAULT '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'auth.users column shim skipped: %', SQLERRM;
END $$;
SQL
echo "::endgroup::"

# <timestamp-prefix>|<extended regex the error output MUST match>
# 2026-09-02: four patterns widened, and the reason matters more
# than the change. The condition did NOT move — the CI Postgres
# image did. It used to ship a `realtime` schema that was
# permission-gated, so every one of these failed with "permission
# denied for schema realtime". It now ships no realtime schema at
# all, so the same migrations fail with `relation
# "realtime.messages" does not exist` instead, and the allowlist
# stopped matching its own known gap. (20260412002759 additionally
# gained a `public.` prefix in the relation name.) These are the
# same CI-only absences, reworded by the image — not new failures,
# and prod is unaffected: prod HAS realtime, and all of these
# applied there in April.
#
# This is still the narrow read of "do not widen the pattern to get
# green": each addition names a specific missing object, so a real
# regression in these files would still fail the job.
#
# HEALED, left in place deliberately — 20260505220000, 20260505224500
# and 20260506030000 (storage.objects policies) and 20260506162229
# applied cleanly on 2026-09-02 and no longer soft-fail. They are NOT
# pruned because the first three say "perms vary by image" and that
# is exactly what just bit the realtime entries: one green run on one
# image is not evidence a permission gap is gone for good. Prune them
# after they stay clean across an image change, not before.
KNOWN_CI_FLAKY=(
  "20260412002746|permission denied for schema realtime|relation \"realtime\.messages\" does not exist"    # uses realtime.messages
  "20260412002759|permission denied for schema realtime|relation \"(public\.)?jobs_helper_safe\" does not exist"  # depends on jobs_helper_safe (cascades from the above)
  "20260412011520|permission denied for schema realtime|function realtime\.topic\(\) does not exist"    # uses realtime.topic()
  "20260412070714|permission denied for schema realtime|relation \"realtime\.messages\" does not exist"    # uses realtime.messages
  "20260505220000|must be owner of table objects|permission denied for table objects|permission denied for schema storage"   # creates storage.objects policies (perms vary by image)
  "20260505224500|must be owner of table objects|permission denied for table objects|permission denied for schema storage"   # drops storage.objects policies
  "20260506001000|permission denied for schema realtime|must be owner of relation messages|relation \"realtime\.messages\" does not exist"   # ALTER POLICY on realtime.messages
  "20260506030000|must be owner of table objects|permission denied for table objects|permission denied for schema storage"   # message-attachments storage.objects policies
  "20260506162229|function .* does not exist"                                             # REVOKE on auto_escalate_reports/set_broadcast_pending_fan_out/fan_out_broadcast — these exist in prod from earlier history but are first CREATEd in CI by later migrations (175324 / 210000), so the REVOKE runs before the function exists
)

# Returns 0 and echoes the allowed pattern if this file is
# allowlisted; returns 1 otherwise.
flaky_pattern() {
  local base; base="$(basename "$1")"
  local entry prefix pattern
  for entry in "${KNOWN_CI_FLAKY[@]}"; do
    prefix="${entry%%|*}"
    pattern="${entry#*|}"
    if [[ "$base" == "$prefix"* ]]; then
      printf '%s' "$pattern"
      return 0
    fi
  done
  return 1
}

FAIL=0
FIRST_FAIL=""
SOFT_FAILS=0
MATCHED_PREFIXES=""
for f in $(ls supabase/migrations/*.sql | sort); do
  skip=0
  for ex in ${EXCLUDE_MIGRATIONS:-}; do
    [[ "$(basename "$f")" == "$ex"* ]] && skip=1
  done
  if [ "$skip" -eq 1 ]; then
    echo "::warning file=$f::EXCLUDED by EXCLUDE_MIGRATIONS (red-proof replay) — not applied"
    continue
  fi
  echo "::group::$(basename "$f")"
  # Capture stderr as well as stdout so the error text can be
  # matched, and tee it so the run log still shows everything.
  if ! psql -v ON_ERROR_STOP=1 -f "$f" > /tmp/psql-out.txt 2>&1; then
    cat /tmp/psql-out.txt
    if PATTERN="$(flaky_pattern "$f")"; then
      if grep -qiE "$PATTERN" /tmp/psql-out.txt; then
        echo "::warning file=$f::known CI-only failure (matched: $PATTERN) — soft-allowed"
        SOFT_FAILS=$((SOFT_FAILS + 1))
        MATCHED_PREFIXES="$MATCHED_PREFIXES $(basename "$f")"
      else
        # Allowlisted file, UNEXPECTED error. This is the case the
        # old filename-only check silently swallowed.
        echo "::error file=$f::Allowlisted migration failed for an UNEXPECTED reason."
        echo "::error file=$f::Expected the error to match: $PATTERN"
        echo "::error file=$f::This is a real regression, not the known CI permission gap. Do not widen the pattern to get green."
        FAIL=1
        [ -z "$FIRST_FAIL" ] && FIRST_FAIL="$f"
      fi
    else
      echo "::error file=$f::Migration failed"
      FAIL=1
      [ -z "$FIRST_FAIL" ] && FIRST_FAIL="$f"
    fi
  else
    cat /tmp/psql-out.txt
  fi
  echo "::endgroup::"
done

echo ""
echo "Soft-failed (CI-only): $SOFT_FAILS of ${#KNOWN_CI_FLAKY[@]} allowlisted"
echo "Soft-failed files:$MATCHED_PREFIXES"

# Gate the COUNT, not just the individual matches.
if [ "$SOFT_FAILS" -gt "${#KNOWN_CI_FLAKY[@]}" ]; then
  echo "::error::More soft-fails ($SOFT_FAILS) than allowlist entries (${#KNOWN_CI_FLAKY[@]}) — the prefix matcher is over-matching. Failing rather than trusting it."
  FAIL=1
elif [ "$SOFT_FAILS" -lt "${#KNOWN_CI_FLAKY[@]}" ]; then
  echo "::warning::Only $SOFT_FAILS of ${#KNOWN_CI_FLAKY[@]} allowlisted migrations failed. Some entries have healed (or the file was renamed/removed) — prune KNOWN_CI_FLAKY so the exemption list does not silently grow back into a blanket pass."
fi

if [ "$FAIL" -eq 1 ]; then
  echo "::error::Real migration failure. First: $FIRST_FAIL"
  exit 1
fi
echo "✅ All migrations applied (or soft-allowed for their one expected, matched reason)"
