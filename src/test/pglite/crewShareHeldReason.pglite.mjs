#!/usr/bin/env node
/**
 * PGlite proof for 20261103014109_crew_share_held_reason.sql (Q2440): crew_cancellation_fee_shares gains a
 * failure_reason column that only the service role can read. The crew member and the poster keep reading exactly the
 * 12 columns they read before; Download My Data gives the member their own share's reason and never gives it to the
 * poster.
 *
 *   node src/test/pglite/crewShareHeldReason.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/crewShareHeldReason.pglite.mjs  # RED (prod today: no column)
 *   MIGRATION_PATH=<planted copy> node ...                                   # RED on a planted defect
 *
 * World: the table as prod has it (20260925154606 + failed_transfer_ids from 20261023151810), its prod RLS policy
 * and its prod table-level SELECT for authenticated; export_my_data from 20261102161715 (the newest CREATE, body md5
 * printed and checked against prod's prosrc md5 47d09c2805adeb3937bd9fca13e927a0, read 2026-11-02); then this
 * migration 3x. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261102161715_export_my_data_manager_mode.sql";
const NEW_FILE = "20261103014109_crew_share_held_reason.sql";
const PROD_EXPORT_SRC_MD5 = "47d09c2805adeb3937bd9fca13e927a0";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);

// The base export_my_data (prod's), with the md5 of its body checked against prod's prosrc.
const baseSql = readFileSync(`${MIG_DIR}${BASE}`, "utf8");
const baseBody = (() => {
  const i = baseSql.indexOf("AS $function$") + "AS $function$".length;
  return baseSql.slice(i, baseSql.indexOf("$function$", i));
})();
const baseMd5 = createHash("md5").update(baseBody).digest("hex");
ok(baseMd5 === PROD_EXPORT_SRC_MD5, "the base export_my_data body is prod's live one (md5 of prosrc)", baseMd5);
await db.exec(baseSql.slice(baseSql.indexOf("DROP FUNCTION IF EXISTS public.export_my_data();")));
const defOf = async () => (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
const oldDef = await defOf();

// Stub every table the body reads with the columns it reads (exportPlaceCityOnly's method), then the two real ones.
const body = oldDef.slice(oldDef.indexOf("BEGIN"));
const tables = new Map();
for (const chunk of body.split(/;\s*\n/)) {
  const alias = new Map();
  for (const m of chunk.matchAll(/\b(?:FROM|JOIN)\s+(public|auth|storage)\.(\w+)\s+(?:AS\s+)?(\w+)/gi)) {
    const t = `${m[1]}.${m[2]}`;
    if (!tables.has(t)) tables.set(t, new Set());
    if (!alias.has(m[3])) alias.set(m[3], new Set());
    alias.get(m[3]).add(t);
  }
  for (const m of chunk.matchAll(/\b([a-z]\w*)\.([a-z_]\w*)\b/g)) for (const t of alias.get(m[1]) ?? []) tables.get(t).add(m[2]);
}
const BOOL = new Set([...body.matchAll(/coalesce\(\w+\.(\w+),\s*(?:true|false)\)|\w+\.(\w+) IS (?:NOT )?(?:TRUE|FALSE)\b/gi)].map((m) => m[1] ?? m[2]));
const TEXT_COLS = new Set([...body.matchAll(/\w+\.(\w+)\s*(?:=|<>|IN)\s*\(?'[a-z_]+'/g)].map((m) => m[1]));
const typeOf = (c) =>
  TEXT_COLS.has(c) ? "text"
  : BOOL.has(c) ? "boolean"
  : c === "id" || c.endsWith("_id") || c.endsWith("_by") ? "uuid"
  : c.endsWith("_at") || c === "slot_start" || c === "slot_end" ? "timestamptz"
  : c.endsWith("_on") || c === "pickup_day" ? "date"
  : c.startsWith("is_") ? "boolean"
  : c.endsWith("_cents") || c === "rating" || c === "slot_no" ? "integer"
  : c === "weekdays" ? "smallint[]"
  : "text";
const stubs = [];
for (const [t, cols] of tables) {
  if (t === "public.crew_cancellation_fee_shares" || t === "auth.users") continue;
  cols.delete("id");
  const colSql = ["id uuid PRIMARY KEY DEFAULT gen_random_uuid()", ...[...cols].map((c) => `${c} ${typeOf(c)}`)];
  stubs.push(`CREATE SCHEMA IF NOT EXISTS ${t.split(".")[0]}; CREATE TABLE IF NOT EXISTS ${t} (${colSql.join(", ")});`);
}
await db.exec(stubs.join("\n"));
// ended_by is compared with a word elsewhere in the body ('seller'), so the stub typed it text; here it is a member id.
await db.exec("ALTER TABLE public.declutter_manager_grants ALTER COLUMN ended_by TYPE uuid USING NULL");
await db.exec(`
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;
GRANT SELECT ON public.jobs TO authenticated;
-- The share ledger as prod has it (20260925154606 + 20261023151810), its prod policy and its prod table grant.
CREATE TABLE public.crew_cancellation_fee_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  helper_id uuid,
  committed boolean NOT NULL,
  share_basis_cents integer NOT NULL,
  fee_percent integer NOT NULL,
  share_amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  stripe_transfer_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  failed_transfer_ids text[] NOT NULL DEFAULT '{}');
ALTER TABLE public.crew_cancellation_fee_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Crew member or poster reads a fee share" ON public.crew_cancellation_fee_shares FOR SELECT TO authenticated
  USING ((helper_id = (SELECT auth.uid())) OR (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = crew_cancellation_fee_shares.job_id AND j.customer_id = (SELECT auth.uid()))));
REVOKE ALL ON TABLE public.crew_cancellation_fee_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crew_cancellation_fee_shares TO authenticated;
GRANT ALL ON TABLE public.crew_cancellation_fee_shares TO service_role;`);

const COLS_BEFORE = (await db.query(`SELECT string_agg(column_name, ',' ORDER BY column_name) c FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'crew_cancellation_fee_shares'`)).rows[0].c;

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(sql);
      ok(true, `the migration applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration applies (run ${i + 1} of 3)`, e.message);
    }
  }
}
const def = await defOf();

// 1. The column, writable by the service role.
const POSTER = "00000000-0000-0000-0000-0000000000aa";
const MEMBER = "00000000-0000-0000-0000-0000000000bb";
const OTHER = "00000000-0000-0000-0000-0000000000cc";
const JOB = "00000000-0000-0000-0000-0000000000d1";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${POSTER}', 'p@example.com', now()), ('${MEMBER}', 'm@example.com', now()), ('${OTHER}', 'o@example.com', now());
INSERT INTO public.jobs (id, customer_id) VALUES ('${JOB}', '${POSTER}');
INSERT INTO public.crew_cancellation_fee_shares (job_id, helper_id, committed, share_basis_cents, fee_percent, share_amount, status)
  VALUES ('${JOB}', '${MEMBER}', true, 10000, 50, 50.00, 'pending');
UPDATE public.crew_cancellation_fee_shares SET failed_transfer_ids = ARRAY['tr_failed_once'];`);
let wrote = false;
try {
  await db.exec(`SET ROLE service_role; UPDATE public.crew_cancellation_fee_shares SET failure_reason = 'payee_not_payable: rejected'; RESET ROLE;`);
  wrote = true;
} catch (e) {
  await db.exec("RESET ROLE");
  ok(false, "the service role writes failure_reason", e.message);
}
if (wrote) ok(true, "the service role writes failure_reason");

// 2. Who reads what, as authenticated with RLS.
const asUser = async (uid, sql) => {
  await db.exec(`SET test.uid = '${uid}'; SET ROLE authenticated;`);
  try {
    return { rows: (await db.query(sql)).rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("RESET ROLE; RESET test.uid;");
  }
};
const SEEN = "id, job_id, helper_id, committed, share_basis_cents, fee_percent, share_amount, status, stripe_transfer_id, paid_at, created_at, failed_transfer_ids";
for (const [who, uid] of [["the poster", POSTER], ["the crew member", MEMBER]]) {
  const r = await asUser(uid, `SELECT failure_reason FROM public.crew_cancellation_fee_shares`);
  ok(!skip && /permission denied/i.test(r.error ?? ""), `${who} cannot read failure_reason`, JSON.stringify(r));
  const s = await asUser(uid, `SELECT ${SEEN} FROM public.crew_cancellation_fee_shares`);
  ok(s.rows?.length === 1 && s.rows[0].status === "pending", `  ${who} still reads the 12 columns they read before, on their row`, JSON.stringify(s));
}
const stranger = await asUser(OTHER, `SELECT ${SEEN} FROM public.crew_cancellation_fee_shares`);
ok(stranger.rows?.length === 0, "a stranger still reads no share row", JSON.stringify(stranger));
const grants = (await db.query(`SELECT string_agg(column_name, ',' ORDER BY column_name) c FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'crew_cancellation_fee_shares' AND grantee = 'authenticated' AND privilege_type = 'SELECT'`)).rows[0].c;
ok(grants === COLS_BEFORE, "authenticated may SELECT exactly the columns the table had before (no new column readable)", `${grants} vs ${COLS_BEFORE}`);
const anonAny = (await db.query(`SELECT count(*)::int n FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'crew_cancellation_fee_shares' AND grantee = 'anon'`)).rows[0].n;
ok(anonAny === 0, "anon still reads nothing");

// 3. export_my_data: verbatim except one key; the member gets their reason, the poster never does.
const CHANGE = [
  "ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t",
  "ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' - 'failure_reason' - 'failed_transfer_ids' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t",
];
ok(oldDef.split(CHANGE[0]).length === 2 && def === oldDef.replace(CHANGE[0], CHANGE[1]),
  "export_my_data is 20261102161715's verbatim except the poster's copy of a share drops 'failure_reason' and 'failed_transfer_ids'", skip ? "skip" : "");
const acl = (await db.query(`SELECT
    has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth,
    has_function_privilege('service_role', 'public.export_my_data(uuid)', 'EXECUTE') AS svc,
    (SELECT count(*)::int FROM pg_proc WHERE proname = 'export_my_data') AS overloads`)).rows[0];
ok(acl.overloads === 1 && acl.svc && !acl.anon && !acl.auth, "still the one (uuid) overload, EXECUTE for service_role only", JSON.stringify(acl));
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, `${e.message} ${e.where ?? ""}`.slice(0, 600));
    return null;
  }
};
const member = (await exportOf(MEMBER))?.crew_cancellation_fee_shares?.[0];
const poster = (await exportOf(POSTER))?.crew_cancellation_fee_shares?.[0];
ok(member?.failure_reason === "payee_not_payable: rejected", "the member's export has their own share's reason", JSON.stringify(member));
ok(poster && !("failure_reason" in poster) && !JSON.stringify(poster).includes("payee_not_payable"),
  "the poster's export of the member's share never carries the reason", JSON.stringify(poster));
ok(member?.failed_transfer_ids?.[0] === "tr_failed_once", "the member's export keeps their own failed transfer ids", JSON.stringify(member));
ok(poster && !("failed_transfer_ids" in poster) && !JSON.stringify(poster).includes("tr_failed_once"),
  "the poster's export of the member's share never carries the member's failed Stripe transfer ids", JSON.stringify(poster));
ok(poster && poster.share_amount !== undefined && !("stripe_transfer_id" in poster), "  and is otherwise what it was (amount yes, transfer id no)", JSON.stringify(poster));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
