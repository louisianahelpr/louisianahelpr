#!/usr/bin/env node
/**
 * PGlite proof for Q140 (docs/OPEN.md): scripts/ci/null-arg-validators.sql, the
 * class check db-smoke runs on every replay, run here against the NEWEST
 * migration definition of every `allow` function it probes.
 *
 *   node src/test/pglite/nullArgNeverAllows.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/nullArgNeverAllows.pglite.mjs   # RED: pre-fix definitions
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: the tables and columns those functions read (shapes as live,
 * 2026-09-23), the 17 `allow` functions and the 4 helpers they call taken
 * VERBATIM from their newest definition in supabase/migrations (any dollar-quote
 * tag), and a stub of the right arity/volatility for every other classified
 * boolean function (the inventory half of the check needs them to exist).
 * 20260923123701 is then applied 3x (replay-safe), and the class check must
 * print zero rows. With NEW_MIGRATION=skip the newest definitions are the
 * pre-fix ones and the check must name all five offenders.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const ROOT = new URL("../../../", import.meta.url).pathname;
const FIX = "20260923123701_null_argument_never_allows.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the pre-fix definitions (expect FAILs)`);

const migFiles = readdirSync(`${ROOT}supabase/migrations`).filter((f) => f.endsWith(".sql")).sort()
  // Skip mode drops the fix AND everything after it: a later migration (Q141,
  // 20260923130457) restates helper_credential_document_ok with the fix in it.
  .filter((f) => !(MODE && f >= FIX));
const migText = new Map(migFiles.map((f) => [f, readFileSync(`${ROOT}supabase/migrations/${f}`, "utf8")]));

/** The newest `CREATE [OR REPLACE] FUNCTION public.<name>(` statement, verbatim, any dollar tag. */
function newest(name) {
  let found = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  for (const f of migFiles) {
    const sql = migText.get(f);
    for (const m of sql.matchAll(head)) {
      // Skip a match inside a -- comment line.
      const lineStart = sql.lastIndexOf("\n", m.index) + 1;
      if (/--/.test(sql.slice(lineStart, m.index))) continue;
      const rest = sql.slice(m.index);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      found = { file: f, sql: rest.slice(0, close + tag[1].length) + ";" };
    }
  }
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
-- Supabase's auth.uid(): the sub claim, from either GUC.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.job_category AS ENUM ('cleaning', 'other');
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE,
  subscription_tier text, subscription_expires_at timestamptz, ban_status text, auto_suspended_until timestamptz,
  is_seed boolean DEFAULT false);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL,
  UNIQUE (user_id, role));
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL,
  category public.job_category NOT NULL DEFAULT 'other', budget numeric NOT NULL, location text, parish text, date_needed date NOT NULL,
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  status text NOT NULL DEFAULT 'open', payment_status text DEFAULT 'unpaid',
  poster_completed_at timestamptz, helper_completed_at timestamptz, revision_completed_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  has_active_dispute boolean NOT NULL DEFAULT false, dispute_resolved_at timestamptz, disputed_by uuid, disputed_at timestamptz,
  -- The CI fixture inserts start_time (jobs.start_time is NOT NULL on prod since Q-start-time).
  start_time time);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL,
  status text DEFAULT 'pending', UNIQUE (job_id, helper_id));
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.messages (job_id uuid, sender_id uuid, receiver_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.reviews (job_id uuid, reviewer_id uuid);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text);
CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text, name text, owner uuid, UNIQUE (bucket_id, name));
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
`);

// Real definitions: every allow function (18 on 2026-09-25) plus the helpers they call.
const ALLOW = ["can_message_in_job", "can_review_job", "can_send_message_in_job", "can_send_message_to_in_job",
  "check_dispute_velocity", "credential_document_path_ok", "dispute_evidence_url_ok", "has_role",
  "helper_credential_document_ok", "helper_has_advanced_analytics", "identity_is_verified", "is_party_to_job",
  "is_party_to_job_folder", "job_is_funded", "job_payment_is_funded", "user_has_pending_application",
  "user_may_see_job_address", "is_crew_member_of_job_folder"];
const HELPERS = ["job_legacy_completed_at", "job_messaging_closes_at", "is_caller_banned", "are_users_blocked", "is_off_job"];
// Load order: a SQL body is validated at CREATE, so a callee comes first.
const ORDER = [...HELPERS, "job_payment_is_funded", ...ALLOW.filter((f) => f !== "job_payment_is_funded")];
const loaded = [];
for (const name of ORDER) {
  const def = newest(name);
  await db.exec(def.sql);
  loaded.push(`${name}@${def.file.slice(0, 14)}`);
}
console.log(`loaded newest definitions: ${loaded.join(" ")}`);

// Stubs for the rest of the classified inventory (right arity + volatility).
const sqlFile = readFileSync(`${ROOT}scripts/ci/null-arg-validators.sql`, "utf8");
const classRows = [...sqlFile.matchAll(/^\s*\('([a-z_0-9]+)',\s*'(allow|absent|deny|classify|noarg|action)',/gm)].map((m) => ({ fn: m[1], kind: m[2] }));
check("the class list parses (55 entries)", classRows.length === 55, `${classRows.length}`);
const real = new Set([...ALLOW, ...HELPERS]);
for (const { fn, kind } of classRows) {
  if (real.has(fn)) continue;
  const args = kind === "noarg" ? "" : "x text";
  const vol = kind === "action" ? "VOLATILE" : "STABLE";
  await db.exec(`CREATE FUNCTION public.${fn}(${args}) RETURNS boolean LANGUAGE sql ${vol} AS $$ SELECT false $$;`);
}

if (!MODE) {
  const fix = readFileSync(`${ROOT}supabase/migrations/${FIX}`, "utf8");
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(fix); check(`20260923123701 applies (pass ${i}/3)`, true); }
    catch (e) { check(`20260923123701 applies (pass ${i}/3)`, false, e.message); }
  }
}

// The class check, as db-smoke runs it (psql meta-commands dropped).
const runCheck = async () => {
  const res = await db.exec(sqlFile.split("\n").filter((l) => !l.startsWith("\\")).join("\n"));
  const rows = res.find((r) => r.fields?.length === 1 && r.rows.length >= 0 && r.fields[0].name === "?column?");
  return rows ? rows.rows.map((r) => r["?column?"]) : null;
};
const out = await runCheck();
check("the class check ran and returned its result set", out !== null);
for (const line of out ?? []) console.log(`      ${line}`);
check("class check is clean: zero rows", (out ?? ["?"]).length === 0, `${(out ?? []).length} rows`);

// Each of the five named offenders, by name, so the red run says which one.
for (const [fn, arg] of [["helper_credential_document_ok", 2], ["credential_document_path_ok", 2],
  ["check_dispute_velocity", 1], ["identity_is_verified", 1], ["job_is_funded", 1]]) {
  const hit = (out ?? []).find((l) => l.startsWith(`${fn}|NULL_ARG_ALLOWS|argument ${arg} `));
  check(`${fn}: argument ${arg} NULL returns false`, !hit, hit ?? "");
}

// Fail-closed self-tests of the check itself (each on a scratch copy of the state).
const plant = async (name, sql, expect) => {
  await db.exec("BEGIN;");
  await db.exec(sql);
  const o = await runCheck();
  await db.exec("ROLLBACK;");
  const hit = (o ?? []).some((l) => l.includes(expect));
  check(`self-test: ${name} -> ${expect}`, hit, (o ?? []).join(" ; "));
};
if (!MODE) {
  await plant("an unclassified boolean function", "CREATE FUNCTION public.q140_new_ok(x uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;", "q140_new_ok|UNCLASSIFIED");
  await plant("a classified function that is gone", "DROP FUNCTION public.is_seed_email(text);", "is_seed_email|STALE");
  await plant("a NULL-true allow function", "CREATE OR REPLACE FUNCTION public.job_payment_is_funded(p_payment_status text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_payment_status IS NULL OR p_payment_status = 'escrow' $$;", "job_payment_is_funded|NULL_ARG_ALLOWS");
  await plant("a NULL-NULL allow function", "CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT CASE WHEN _user_id IS NULL THEN NULL ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) END $$;", "has_role|NULL_ARG_ALLOWS");
  await plant("a baseline that is not true", "CREATE OR REPLACE FUNCTION public.is_party_to_job(_job_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;", "is_party_to_job|BASELINE_NOT_TRUE");
  await plant("a volatile check classified allow", "ALTER FUNCTION public.has_role(uuid, public.app_role) VOLATILE;", "has_role|WRONG_KIND");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
