// Probe: 20260915045110 (jobs.offered_to_helper_id readable by the poster and
// the offered Helpr only), in real Postgres. NOT a vitest test (pglite is not a
// dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/offer-privacy.probe.mjs
//
// Prod-shaped schema: the jobs table is built from the jobs Row of
// src/integrations/supabase/types.ts (regenerated from prod 2026-09-14), with
// prod's grants (authenticated=arwdDxtm, anon=awdxm: no SELECT). The objects
// the fix replaces are loaded VERBATIM from their latest migration:
// user_may_see_job_address (the "Selected helpers can view their job" policy),
// get_jobs_for_my_applications, get_my_pending_direct_offers, mask_job_location
// and the open_jobs_browse view. early_access_cutoff / seed_jobs_hidden_publicly
// / my_credential_tier / has_role / are_users_blocked are same-signature stubs.
//
// 1. BEFORE, on that shape: the leak must reproduce on every path (table,
//    RPC, view) for hired Helpr, roster member, applicant, stranger, anon.
// 2. The migration applied verbatim three times: every expectation holds,
//    including the app reads (poster Activity, offeree via the offer policy,
//    hired Helpr's Messages read, an UPDATE through the offer policy, an
//    INSERT ... RETURNING id).
// 3. Deliberately broken copies, each on a fresh database: every one must
//    FAIL at least one expectation, or this probe cannot fail.
// 4. Skip path: on a database without jobs the migration is a no-op.
// Exit 1 on any mismatch.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import fs from "node:fs";

const repo = (p) => new URL(`../../${p}`, import.meta.url);
const MIGRATION_PATH = process.env.MIGRATION ?? "supabase/migrations/20260915045110_hide_offered_helper_from_non_posters.sql";
const MIG = fs.readFileSync(repo(MIGRATION_PATH), "utf8");
const read = (f) => fs.readFileSync(repo(`supabase/migrations/${f}`), "utf8");

/** `CREATE [OR REPLACE] FUNCTION public.<name>(` … closing dollar tag … `;` */
function fnDef(file, name) {
  const sql = read(file);
  const start = sql.search(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "i"));
  if (start < 0) throw new Error(`${name} not in ${file}`);
  const tag = sql.slice(start).match(/\$([a-z0-9_]*)\$/i)[0];
  const bodyStart = sql.indexOf(tag, start) + tag.length;
  const bodyEnd = sql.indexOf(tag, bodyStart);
  return sql.slice(start, sql.indexOf(";", bodyEnd) + 1);
}
function viewDef(file, name) {
  const sql = read(file);
  const start = sql.search(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?VIEW\\s+public\\.${name}\\b`, "i"));
  // The view text ends at the first ';' that is not inside a -- comment.
  let i = start;
  for (;;) {
    const semi = sql.indexOf(";", i);
    const lineStart = sql.lastIndexOf("\n", semi) + 1;
    if (!sql.slice(lineStart, semi).includes("--")) return sql.slice(start, semi + 1);
    i = semi + 1;
  }
}

// ── the jobs table, from the generated Row type ─────────────────────────────
const types = fs.readFileSync(repo("src/integrations/supabase/types.ts"), "utf8");
const jobsBlock = types.slice(types.indexOf("\n      jobs: {"));
const rowBody = jobsBlock.slice(jobsBlock.indexOf("Row: {") + 6, jobsBlock.indexOf("\n        }"));
const INT_COLS = new Set(["helpers_needed", "credential_tier", "revision_count", "recurrence_weeks"]);
const DATE_COLS = new Set(["date_needed", "recurrence_end_date"]);
const columns = rowBody.trim().split("\n").map((l) => {
  const [, name, ts] = l.trim().match(/^([a-z0-9_]+):\s*(.+)$/);
  const nullable = ts.includes("| null");
  const t = ts.replace(/\s*\|\s*null/, "");
  let pg;
  if (t.includes('"job_category"')) pg = "public.job_category";
  else if (t.includes('"job_status"')) pg = "public.job_status";
  else if (t === "boolean") pg = "boolean";
  else if (t === "number[]") pg = "integer[]";
  else if (t === "string[]") pg = "text[]";
  else if (t === "number") pg = INT_COLS.has(name) ? "integer" : "numeric";
  else if (name === "id" || /_id$/.test(name) || /_by$/.test(name)) pg = "uuid";
  else if (/_at$/.test(name) || name === "expires_at") pg = "timestamptz";
  else if (DATE_COLS.has(name)) pg = "date";
  else if (name === "start_time") pg = "time";
  else pg = "text";
  const dflt = name === "id" ? " PRIMARY KEY DEFAULT gen_random_uuid()"
    : name === "status" ? " NOT NULL DEFAULT 'open'"
    : name === "created_at" || name === "updated_at" ? " NOT NULL DEFAULT now()"
    : pg === "boolean" && !nullable ? " NOT NULL DEFAULT false"
    : "";
  return `  ${name} ${pg}${dflt}`;
});
if (columns.length < 100 || !rowBody.includes("offered_to_helper_id")) throw new Error("jobs Row not parsed from types.ts");

const P = "10000000-0000-4000-8000-000000000001";   // poster of J1..J4
const O = "20000000-0000-4000-8000-000000000002";   // offered Helpr (J1 declined, J2 + J4 pending, J3 declined)
const H = "30000000-0000-4000-8000-000000000003";   // hired Helpr on J1 (after O declined), applied to J1
const R = "40000000-0000-4000-8000-000000000004";   // roster member on J1, applied to J1
const A = "50000000-0000-4000-8000-000000000005";   // applicant (pending) on J2 and J3, both open
const AA = "60000000-0000-4000-8000-000000000006";  // ACCEPTED applicant on J1 (not hired, not roster)
const S = "70000000-0000-4000-8000-000000000007";   // stranger
const ADM = "80000000-0000-4000-8000-000000000008"; // admin
const J1 = "a1000000-0000-4000-8000-0000000000a1";  // in_progress, hired H, roster R, offer to O DECLINED
const J2 = "a2000000-0000-4000-8000-0000000000a2";  // open, funded, offer to O PENDING
const J3 = "a3000000-0000-4000-8000-0000000000a3";  // open, funded, offer to O DECLINED -> back in the pool
const J4 = "a4000000-0000-4000-8000-0000000000a4";  // open, unfunded, offer to O PENDING

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
CREATE TYPE public.job_category AS ENUM ('cleaning','yard_work','moving','handyman','other');
CREATE TABLE public.jobs (
${columns.join(",\n")}
);
CREATE TABLE public.applications (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text default 'pending');
CREATE TABLE public.group_job_helpers (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid);
CREATE TABLE public.profiles (user_id uuid primary key, idv_status text);
CREATE TABLE public.user_roles (user_id uuid, role text);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_job_helpers ENABLE ROW LEVEL SECURITY;
-- prod grants on jobs: authenticated + service_role hold everything, anon holds no SELECT
GRANT ALL ON public.jobs TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.jobs TO anon;
GRANT SELECT ON public.applications, public.group_job_helpers, public.profiles TO authenticated;

CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE FUNCTION public.are_users_blocked(_a uuid, _b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT false $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT false $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT 0 $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- verbatim from the migrations
${fnDef("20260426123151_a01a6cfe-8f0a-4c02-bb3e-2812f0d07e8b.sql", "mask_job_location")}
${fnDef("20260901033219_readdress_only_when_offered.sql", "user_may_see_job_address")}
${fnDef("20260908020801_fix_rec_star_100x_reeval.sql", "get_jobs_for_my_applications")}
${fnDef("20260908020801_fix_rec_star_100x_reeval.sql", "get_my_pending_direct_offers")}
REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications(), public.get_my_pending_direct_offers(), public.mask_job_location(text), public.user_may_see_job_address(uuid, uuid) TO authenticated;
${viewDef("20260912021641_require_photo_proof_per_job.sql", "open_jobs_browse")}
-- The view starts from Supabase's DEFAULT-PRIVILEGES shape (the full grant
-- set for anon + authenticated), NOT from prod's tightened one. That is what
-- a DROP + CREATE, or a fresh view creation, produces — and it is the shape
-- F-SEC-05 (20260706140000) found and fixed: the view's owner bypasses RLS,
-- so any write through it writes public.jobs unpoliced. Starting loose is how
-- this probe can SEE the migration's restated REVOKE do its work instead of
-- assuming it.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.open_jobs_browse TO anon, authenticated;
GRANT ALL ON public.open_jobs_browse TO service_role;

-- the LIVE jobs policies (latest definition of each, replayed)
CREATE POLICY "Admins can view all jobs" ON public.jobs FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view their own jobs" ON public.jobs FOR SELECT TO authenticated USING (auth.uid() = customer_id OR auth.uid() = helper_id);
CREATE POLICY "Targeted helper can view direct offer" ON public.jobs FOR SELECT USING (offered_to_helper_id IS NOT NULL AND offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending');
CREATE POLICY "Selected helpers can view their job" ON public.jobs FOR SELECT TO authenticated USING (public.user_may_see_job_address(id, (SELECT auth.uid())));
CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs FOR UPDATE USING (auth.uid() = helper_id) WITH CHECK (auth.uid() = helper_id);
CREATE POLICY "Targeted helper can respond to direct offer" ON public.jobs FOR UPDATE USING (offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending');
CREATE POLICY "Customers can create jobs" ON public.jobs FOR INSERT WITH CHECK (
  auth.uid() = customer_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.idv_status = 'verified'::text)
  AND business_id IS NULL
  AND (offered_to_helper_id IS NULL OR NOT are_users_blocked(customer_id, offered_to_helper_id)));
CREATE POLICY apps_read ON public.applications FOR SELECT USING (true);
CREATE POLICY roster_read ON public.group_job_helpers FOR SELECT USING (true);

INSERT INTO public.profiles VALUES ('${P}', 'verified');
INSERT INTO public.user_roles VALUES ('${ADM}', 'admin');
INSERT INTO public.jobs (id, title, description, category, budget, location, status, payment_status, customer_id, helper_id, offered_to_helper_id, direct_offer_status, created_at) VALUES
  ('${J1}', 'J1 hired after a declined offer', 'd', 'cleaning', 50, '12 Oak St, Baton Rouge, LA 70801', 'in_progress', 'escrow',   '${P}', '${H}', '${O}', 'declined', now() - interval '2 days'),
  ('${J2}', 'J2 live offer',                   'd', 'cleaning', 50, '12 Oak St, Baton Rouge, LA 70801', 'open',        'escrow',   '${P}', NULL,   '${O}', 'pending',  now() - interval '2 days'),
  ('${J3}', 'J3 declined, back in the pool',   'd', 'cleaning', 50, '12 Oak St, Baton Rouge, LA 70801', 'open',        'escrow',   '${P}', NULL,   '${O}', 'declined', now() - interval '2 days'),
  ('${J4}', 'J4 live offer, unfunded',         'd', 'cleaning', 50, '12 Oak St, Baton Rouge, LA 70801', 'open',        'unpaid',   '${P}', NULL,   '${O}', 'pending',  now() - interval '2 days');
INSERT INTO public.applications (job_id, helper_id, status) VALUES
  ('${J1}', '${H}', 'accepted'), ('${J1}', '${R}', 'accepted'), ('${J1}', '${AA}', 'accepted'),
  ('${J2}', '${A}', 'pending'),  ('${J3}', '${A}', 'pending');
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${J1}', '${R}');
`;

async function fresh() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  return db;
}

/** Run `sql` as `role` with auth.uid() = uid. Returns {rows} or {error}. */
async function as(db, role, uid, sql, params = []) {
  try {
    await db.exec(`SET ROLE ${role}`);
    await db.query(`SELECT set_config('request.uid', $1, false)`, [uid ?? ""]);
    const r = await db.query(sql, params);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    // 42501 is both "permission denied" and an RLS WITH CHECK violation; keep them apart.
    return { error: /row-level security/i.test(e.message ?? "") ? "RLS" : (e.code ?? e.message) };
  } finally {
    await db.exec("RESET ROLE");
  }
}

const offereeOf = (res, jobId) => {
  if (res.error) return `ERR ${res.error}`;
  const row = res.rows.find((r) => r.id === jobId || r.job_id === jobId);
  return row === undefined ? "NO ROW" : row.offered_to_helper_id;
};

/** Every expectation: [label, async (db) => actual, expected]. */
const READABLE = "id, title, status, customer_id, helper_id, direct_offer_status, direct_offer_expires_at, location, budget";
const EXPECT_AFTER = [
  // ── the poster and the offeree CAN read it ─────────────────────────────
  ["poster: get_job_offer_targets() -> O on J1..J4", async (db) => {
    const r = await as(db, "authenticated", P, "SELECT * FROM public.get_job_offer_targets() ORDER BY job_id");
    return r.error ? `ERR ${r.error}` : r.rows.map((x) => `${x.job_id.slice(0, 2)}=${x.offered_to_helper_id === O ? "O" : x.offered_to_helper_id}`).join(",");
  }, "a1=O,a2=O,a3=O,a4=O"],
  ["poster: get_job_offer_targets([J1]) -> O", async (db) => offereeOf(await as(db, "authenticated", P, "SELECT * FROM public.get_job_offer_targets($1::uuid[])", [[J1]]), J1), O],
  ["offeree: get_job_offer_targets([J1,J2]) -> O on both", async (db) => {
    const r = await as(db, "authenticated", O, "SELECT * FROM public.get_job_offer_targets($1::uuid[]) ORDER BY job_id", [[J1, J2]]);
    return r.error ? `ERR ${r.error}` : r.rows.map((x) => x.offered_to_helper_id === O).join(",");
  }, "true,true"],
  ["offeree: get_my_pending_direct_offers() J2 -> O", async (db) => offereeOf(await as(db, "authenticated", O, "SELECT id, offered_to_helper_id FROM public.get_my_pending_direct_offers()"), J2), O],
  ["offeree: open_jobs_browse J2 (live offer) -> O", async (db) => offereeOf(await as(db, "authenticated", O, "SELECT id, offered_to_helper_id FROM public.open_jobs_browse"), J2), O],
  ["poster: open_jobs_browse J3 (own job) -> O", async (db) => offereeOf(await as(db, "authenticated", P, "SELECT id, offered_to_helper_id FROM public.open_jobs_browse"), J3), O],
  ["service_role: jobs.offered_to_helper_id J1 -> O", async (db) => offereeOf(await as(db, "service_role", null, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), O],

  // ── nobody else can ────────────────────────────────────────────────────
  ["hired Helpr: SELECT offered_to_helper_id FROM jobs -> refused", async (db) => offereeOf(await as(db, "authenticated", H, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), "ERR 42501"],
  ["hired Helpr: SELECT * FROM jobs -> refused", async (db) => offereeOf(await as(db, "authenticated", H, "SELECT * FROM public.jobs"), J1), "ERR 42501"],
  ["hired Helpr: to_jsonb(jobs row) -> refused", async (db) => { const r = await as(db, "authenticated", H, "SELECT to_jsonb(j) AS x FROM public.jobs j"); return r.error ? `ERR ${r.error}` : "READ"; }, "ERR 42501"],
  ["hired Helpr: get_job_offer_targets([J1]) -> nothing", async (db) => offereeOf(await as(db, "authenticated", H, "SELECT * FROM public.get_job_offer_targets($1::uuid[])", [[J1]]), J1), "NO ROW"],
  ["hired Helpr: get_jobs_for_my_applications() J1 -> NULL", async (db) => offereeOf(await as(db, "authenticated", H, "SELECT id, offered_to_helper_id FROM public.get_jobs_for_my_applications()"), J1), null],
  ["roster member: SELECT offered_to_helper_id FROM jobs -> refused", async (db) => offereeOf(await as(db, "authenticated", R, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), "ERR 42501"],
  ["roster member: get_jobs_for_my_applications() J1 -> NULL", async (db) => offereeOf(await as(db, "authenticated", R, "SELECT id, offered_to_helper_id FROM public.get_jobs_for_my_applications()"), J1), null],
  ["roster member: get_job_offer_targets() -> nothing", async (db) => { const r = await as(db, "authenticated", R, "SELECT * FROM public.get_job_offer_targets()"); return r.error ? `ERR ${r.error}` : r.rows.length; }, 0],
  ["accepted applicant: SELECT offered_to_helper_id FROM jobs -> refused", async (db) => offereeOf(await as(db, "authenticated", AA, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), "ERR 42501"],
  // J1 is in_progress and AA is neither hired nor on the roster, so the RPC does not return J1 to AA at all.
  ["accepted applicant: get_jobs_for_my_applications() J1 -> no row", async (db) => offereeOf(await as(db, "authenticated", AA, "SELECT id, offered_to_helper_id FROM public.get_jobs_for_my_applications()"), J1), "NO ROW"],
  ["applicant: get_jobs_for_my_applications() J3 (open) -> NULL", async (db) => offereeOf(await as(db, "authenticated", A, "SELECT id, offered_to_helper_id FROM public.get_jobs_for_my_applications()"), J3), null],
  ["applicant: get_jobs_for_my_applications() J2 (open, live offer) -> NULL", async (db) => offereeOf(await as(db, "authenticated", A, "SELECT id, offered_to_helper_id FROM public.get_jobs_for_my_applications()"), J2), null],
  ["applicant: open_jobs_browse J3 -> NULL", async (db) => offereeOf(await as(db, "authenticated", A, "SELECT id, offered_to_helper_id FROM public.open_jobs_browse"), J3), null],
  ["applicant: get_job_offer_targets() -> nothing", async (db) => { const r = await as(db, "authenticated", A, "SELECT * FROM public.get_job_offer_targets()"); return r.error ? `ERR ${r.error}` : r.rows.length; }, 0],
  ["stranger: open_jobs_browse J3 -> NULL", async (db) => offereeOf(await as(db, "authenticated", S, "SELECT id, offered_to_helper_id FROM public.open_jobs_browse"), J3), null],
  ["stranger: get_job_offer_targets([J1..J4]) -> nothing", async (db) => { const r = await as(db, "authenticated", S, "SELECT * FROM public.get_job_offer_targets($1::uuid[])", [[J1, J2, J3, J4]]); return r.error ? `ERR ${r.error}` : r.rows.length; }, 0],
  ["admin: SELECT offered_to_helper_id FROM jobs -> refused (column, not row)", async (db) => offereeOf(await as(db, "authenticated", ADM, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), "ERR 42501"],
  ["anon: open_jobs_browse J3 -> NULL", async (db) => offereeOf(await as(db, "anon", null, "SELECT id, offered_to_helper_id FROM public.open_jobs_browse"), J3), null],
  ["anon: get_job_offer_targets() -> refused", async (db) => { const r = await as(db, "anon", null, "SELECT * FROM public.get_job_offer_targets()"); return r.error ? `ERR ${r.error}` : r.rows.length; }, "ERR 42501"],
  ["anon: SELECT id FROM jobs -> refused", async (db) => { const r = await as(db, "anon", null, "SELECT id FROM public.jobs"); return r.error ? `ERR ${r.error}` : "READ"; }, "ERR 42501"],
  ["catalog: authenticated table-level SELECT on jobs", async (db) => (await db.query("SELECT has_table_privilege('authenticated','public.jobs','SELECT') AS v")).rows[0].v, false],
  ["catalog: authenticated column SELECT on offered_to_helper_id", async (db) => (await db.query("SELECT has_column_privilege('authenticated','public.jobs','offered_to_helper_id','SELECT') AS v")).rows[0].v, false],
  ["catalog: anon column SELECT on offered_to_helper_id", async (db) => (await db.query("SELECT has_column_privilege('anon','public.jobs','offered_to_helper_id','SELECT') AS v")).rows[0].v, false],
  ["catalog: anon column SELECT on title (anon had none before)", async (db) => (await db.query("SELECT has_column_privilege('anon','public.jobs','title','SELECT') AS v")).rows[0].v, false],
  ["catalog: authenticated keeps INSERT/UPDATE on jobs", async (db) => (await db.query("SELECT has_table_privilege('authenticated','public.jobs','INSERT') AND has_table_privilege('authenticated','public.jobs','UPDATE') AS v")).rows[0].v, true],
  ["catalog: every non-private column selectable by authenticated", async (db) => (await db.query(`SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid='public.jobs'::regclass AND attnum>0 AND NOT attisdropped AND attname <> 'offered_to_helper_id' AND NOT has_column_privilege('authenticated','public.jobs',attname::text,'SELECT')`)).rows[0].n, 0],
  ["catalog: get_job_offer_targets SECURITY DEFINER + search_path", async (db) => (await db.query(`SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] AS v FROM pg_proc WHERE oid='public.get_job_offer_targets(uuid[])'::regprocedure`)).rows[0].v, true],
  ["catalog: sync_jobs_select_grants not executable by authenticated", async (db) => (await db.query(`SELECT has_function_privilege('authenticated','public.sync_jobs_select_grants()','EXECUTE') AS v`)).rows[0].v, false],
  ["sync is idempotent: second call repairs nothing", async (db) => (await db.query("SELECT (public.sync_jobs_select_grants()->>'repaired') AS v")).rows[0].v, "false"],

  // ── open_jobs_browse is READ-ONLY for the client roles (F-SEC-05) ───────
  // The view is owned by a role that bypasses RLS, so a write grant on it is
  // an unpoliced write to public.jobs. This migration redefines the view, so
  // it restates the REVOKE; these assert the ACL it leaves behind.
  ["catalog: anon holds NO write privilege on open_jobs_browse", async (db) => {
    const r = await db.query(`SELECT string_agg(p, ',' ORDER BY p) AS v FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('anon','public.open_jobs_browse',p)`);
    return r.rows[0].v;
  }, null],
  ["catalog: authenticated holds NO write privilege on open_jobs_browse", async (db) => {
    const r = await db.query(`SELECT string_agg(p, ',' ORDER BY p) AS v FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('authenticated','public.open_jobs_browse',p)`);
    return r.rows[0].v;
  }, null],
  // PUBLIC is not a role has_table_privilege can name; read the ACL itself.
  // A PUBLIC entry in relacl is an aclitem whose grantee (before '=') is empty.
  ["catalog: PUBLIC holds NO privilege at all on open_jobs_browse", async (db) => {
    const r = await db.query(`SELECT coalesce(string_agg(x.privilege_type, ',' ORDER BY x.privilege_type), '') AS v FROM pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) x WHERE c.oid = 'public.open_jobs_browse'::regclass AND x.grantee = 0`);
    return r.rows[0].v;
  }, ""],
  ["catalog: CREATE OR REPLACE kept SELECT for anon + authenticated", async (db) => (await db.query(`SELECT has_table_privilege('anon','public.open_jobs_browse','SELECT') AND has_table_privilege('authenticated','public.open_jobs_browse','SELECT') AS v`)).rows[0].v, true],
  ["catalog: service_role keeps its writes on open_jobs_browse", async (db) => (await db.query(`SELECT has_table_privilege('service_role','public.open_jobs_browse','INSERT') AND has_table_privilege('service_role','public.open_jobs_browse','UPDATE') AS v`)).rows[0].v, true],
  ["authenticated cannot UPDATE public.jobs through the view", async (db) => {
    const r = await as(db, "authenticated", S, "UPDATE public.open_jobs_browse SET budget = 1 WHERE id = $1", [J3]);
    return r.error ?? "WROTE";
  }, "42501"],
  ["anon cannot DELETE public.jobs through the view", async (db) => {
    const r = await as(db, "anon", null, "DELETE FROM public.open_jobs_browse WHERE id = $1", [J3]);
    return r.error ?? "WROTE";
  }, "42501"],

  // ── the app reads still return their rows ──────────────────────────────
  ["APP poster Activity: named columns, own jobs -> 4 rows", async (db) => { const r = await as(db, "authenticated", P, `SELECT ${READABLE} FROM public.jobs WHERE customer_id = $1`, [P]); return r.error ? `ERR ${r.error}` : r.rows.length; }, 4],
  ["APP offeree: jobs row through the offer policy (J2) -> 1 row", async (db) => { const r = await as(db, "authenticated", O, `SELECT ${READABLE} FROM public.jobs WHERE id = $1`, [J2]); return r.error ? `ERR ${r.error}` : r.rows.length; }, 1],
  ["APP hired Helpr Messages read (J1) -> 1 row", async (db) => { const r = await as(db, "authenticated", H, "SELECT id, title, status, customer_id, helper_id FROM public.jobs WHERE id = $1", [J1]); return r.error ? `ERR ${r.error}` : r.rows.length; }, 1],
  ["APP roster member reads J1 -> 1 row", async (db) => { const r = await as(db, "authenticated", R, "SELECT id, title, location FROM public.jobs WHERE id = $1", [J1]); return r.error ? `ERR ${r.error}` : r.rows.length; }, 1],
  ["APP hired Helpr count(*) head read -> 1", async (db) => { const r = await as(db, "authenticated", H, "SELECT count(*)::int AS n FROM public.jobs WHERE helper_id = $1", [H]); return r.error ? `ERR ${r.error}` : r.rows[0].n; }, 1],
  ["APP realtime RLS shape: exists(select 1 from jobs where id) as hired Helpr", async (db) => { const r = await as(db, "authenticated", H, "SELECT exists(SELECT 1 FROM public.jobs WHERE id = $1) AS v", [J1]); return r.error ? `ERR ${r.error}` : r.rows[0].v; }, true],
  ["APP offeree applicant view: get_jobs_for_my_applications keeps J2 for applicant", async (db) => { const r = await as(db, "authenticated", A, "SELECT id FROM public.get_jobs_for_my_applications()"); return r.error ? `ERR ${r.error}` : r.rows.map((x) => x.id).sort().join(","); }, [J2, J3].sort().join(",")],
  ["APP applicant: get_jobs_for_my_applications masks location as before", async (db) => { const r = await as(db, "authenticated", A, "SELECT location FROM public.get_jobs_for_my_applications() WHERE id = $1", [J3]); return r.error ? `ERR ${r.error}` : r.rows[0]?.location; }, "Baton Rouge, LA"],
  ["APP hired Helpr: get_jobs_for_my_applications full location as before", async (db) => { const r = await as(db, "authenticated", H, "SELECT location FROM public.get_jobs_for_my_applications() WHERE id = $1", [J1]); return r.error ? `ERR ${r.error}` : r.rows[0]?.location; }, "12 Oak St, Baton Rouge, LA 70801"],
  ["APP stranger browse still lists J3", async (db) => { const r = await as(db, "authenticated", S, "SELECT id FROM public.open_jobs_browse"); return r.error ? `ERR ${r.error}` : r.rows.map((x) => x.id).join(","); }, J3],
  ["APP offeree writes J4 through the offer UPDATE policy, RETURNING id", async (db) => { const r = await as(db, "authenticated", O, "UPDATE public.jobs SET updated_at = now() WHERE id = $1 RETURNING id", [J4]); return r.error ? `ERR ${r.error}` : r.rows.length; }, 1],
  ["APP hired Helpr lifecycle write on J1 (WHERE id AND col IS NULL), RETURNING id", async (db) => { const r = await as(db, "authenticated", H, "UPDATE public.jobs SET helper_on_the_way_at = now() WHERE id = $1 AND helper_on_the_way_at IS NULL RETURNING id", [J1]); await db.query(`UPDATE public.jobs SET helper_on_the_way_at = NULL WHERE id = '${J1}'`); return r.error ? `ERR ${r.error}` : r.rows.length; }, 1],
  ["APP poster filter on the private column -> refused (so no client may filter on it)", async (db) => { const r = await as(db, "authenticated", P, "SELECT id FROM public.jobs WHERE offered_to_helper_id IS NOT NULL"); return r.error ? `ERR ${r.error}` : r.rows.length; }, "ERR 42501"],
  ["APP poster posts a direct offer: INSERT ... RETURNING id", async (db) => { const r = await as(db, "authenticated", P, "INSERT INTO public.jobs (title, description, category, budget, location, customer_id, offered_to_helper_id, direct_offer_status) VALUES ('new','d','cleaning',20,'Baton Rouge, LA',$1,$2,'pending') RETURNING id", [P, O]); if (!r.error) await db.query("DELETE FROM public.jobs WHERE title = 'new'"); return r.error ? `ERR ${r.error}` : r.rows.length; }, 1],
  ["APP poster RETURNING * after insert -> refused (the e2e return=representation shape)", async (db) => { const r = await as(db, "authenticated", P, "INSERT INTO public.jobs (title, description, category, budget, location, customer_id) VALUES ('new2','d','cleaning',20,'Baton Rouge, LA',$1) RETURNING *", [P]); await db.query("DELETE FROM public.jobs WHERE title = 'new2'"); return r.error ? `ERR ${r.error}` : "READ"; }, "ERR 42501"],
  ["a column added later needs the sync (then is selectable)", async (db) => {
    await db.exec("ALTER TABLE public.jobs ADD COLUMN probe_new_col text");
    const before = (await db.query("SELECT has_column_privilege('authenticated','public.jobs','probe_new_col','SELECT') AS v")).rows[0].v;
    await db.query("SELECT public.sync_jobs_select_grants()");
    const after = (await db.query("SELECT has_column_privilege('authenticated','public.jobs','probe_new_col','SELECT') AS v")).rows[0].v;
    const priv = (await db.query("SELECT has_column_privilege('authenticated','public.jobs','offered_to_helper_id','SELECT') AS v")).rows[0].v;
    await db.exec("ALTER TABLE public.jobs DROP COLUMN probe_new_col");
    return `${before}/${after}/${priv}`;
  }, "false/true/false"],
];

// BEFORE: the leak on every path. Each value is what a non-poster reads today.
const EXPECT_BEFORE = [
  ["BEFORE hired Helpr reads jobs.offered_to_helper_id (J1)", async (db) => offereeOf(await as(db, "authenticated", H, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), O],
  ["BEFORE roster member reads jobs.offered_to_helper_id (J1)", async (db) => offereeOf(await as(db, "authenticated", R, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), O],
  ["BEFORE accepted applicant reads jobs.offered_to_helper_id (J1)", async (db) => offereeOf(await as(db, "authenticated", AA, "SELECT id, offered_to_helper_id FROM public.jobs"), J1), O],
  ["BEFORE applicant reads it via get_jobs_for_my_applications (J2 live offer)", async (db) => offereeOf(await as(db, "authenticated", A, "SELECT id, offered_to_helper_id FROM public.get_jobs_for_my_applications()"), J2), O],
  ["BEFORE stranger reads it via open_jobs_browse (J3 declined)", async (db) => offereeOf(await as(db, "authenticated", S, "SELECT id, offered_to_helper_id FROM public.open_jobs_browse"), J3), O],
  ["BEFORE anon reads it via open_jobs_browse (J3 declined)", async (db) => offereeOf(await as(db, "anon", null, "SELECT id, offered_to_helper_id FROM public.open_jobs_browse"), J3), O],
  ["BEFORE poster select('*') works", async (db) => { const r = await as(db, "authenticated", P, "SELECT * FROM public.jobs WHERE customer_id = $1", [P]); return r.error ? `ERR ${r.error}` : r.rows.length; }, 4],
  // F-SEC-05's shape, which this migration must leave revoked (see above).
  ["BEFORE anon + authenticated hold writes on open_jobs_browse", async (db) => (await db.query(`SELECT has_table_privilege('anon','public.open_jobs_browse','UPDATE') AND has_table_privilege('authenticated','public.open_jobs_browse','DELETE') AS v`)).rows[0].v, true],
  ["BEFORE a stranger can UPDATE public.jobs through the view (RLS bypassed)", async (db) => {
    const r = await as(db, "authenticated", S, "UPDATE public.open_jobs_browse SET budget = 1 WHERE id = $1", [J3]);
    if (!r.error) await db.query(`UPDATE public.jobs SET budget = 50 WHERE id = '${J3}'`);
    return r.error ?? "WROTE";
  }, "WROTE"],
];

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function check(db, list) {
  const fails = [];
  for (const [label, fn, expected] of list) {
    let actual;
    try { actual = await fn(db); } catch (e) { actual = `THREW ${e.code ?? e.message}`; }
    if (!eq(actual, expected)) fails.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return fails;
}

let bad = 0;

// 1. BEFORE
{
  const db = await fresh();
  const fails = await check(db, EXPECT_BEFORE);
  console.log(`BEFORE (live shape): ${EXPECT_BEFORE.length - fails.length}/${EXPECT_BEFORE.length} leak expectations reproduce`);
  for (const f of fails) console.log(`  MISMATCH ${f}`);
  bad += fails.length;
  // The AFTER expectations must FAIL on the live shape (the probe can see the hole).
  const afterOnBefore = await check(db, EXPECT_AFTER);
  console.log(`BEFORE: ${afterOnBefore.length}/${EXPECT_AFTER.length} post-fix expectations fail on the live shape (must be > 0)`);
  if (afterOnBefore.length === 0) { console.log("  MISMATCH post-fix expectations already hold before the fix"); bad++; }
  await db.close();
}

// 2. AFTER, applied three times
{
  const db = await fresh();
  for (let i = 1; i <= 3; i++) {
    await db.exec(MIG);
    const fails = await check(db, EXPECT_AFTER);
    console.log(`AFTER apply #${i}: ${EXPECT_AFTER.length - fails.length}/${EXPECT_AFTER.length} expectations hold`);
    for (const f of fails) console.log(`  MISMATCH ${f}`);
    bad += fails.length;
  }
  await db.close();
}

// 3. Broken copies: each must fail at least one expectation.
const BROKEN = [
  ["no final sync call", (m) => m.replace(/\nSELECT public\.sync_jobs_select_grants\(\);\s*$/, "\n")],
  ["column-level REVOKE only (the 20260818070000 no-op)", (m) => m.replace("REVOKE SELECT ON public.jobs FROM PUBLIC, anon, authenticated;", "REVOKE SELECT (offered_to_helper_id) ON public.jobs FROM authenticated;")],
  ["empty private set", (m) => m.replace("ARRAY['offered_to_helper_id']::text[]", "ARRAY['no_such_column']::text[]")],
  ["accessor not scoped to the caller", (m) => m.replace("AND (j.customer_id = (SELECT auth.uid()) OR j.offered_to_helper_id = (SELECT auth.uid()))", "")],
  ["accessor also admits the hired Helpr", (m) => m.replace("OR j.offered_to_helper_id = (SELECT auth.uid()))", "OR j.offered_to_helper_id = (SELECT auth.uid()) OR j.helper_id = (SELECT auth.uid()))")],
  ["accessor granted to anon", (m) => m.replace("REVOKE ALL ON FUNCTION public.get_job_offer_targets(uuid[]) FROM PUBLIC, anon;", "GRANT EXECUTE ON FUNCTION public.get_job_offer_targets(uuid[]) TO anon;")],
  ["RPC override dropped", (m) => m.replace(/,\s*-- Offer privacy \(20260915045110\)[\s\S]*?THEN j\.offered_to_helper_id ELSE NULL END/, "")],
  ["RPC override admits everyone", (m) => m.replace("THEN j.offered_to_helper_id ELSE NULL END", "THEN j.offered_to_helper_id ELSE j.offered_to_helper_id END")],
  ["RPC override admits the hired Helpr", (m) => m.replace("CASE WHEN j.customer_id = v_uid OR j.offered_to_helper_id = v_uid", "CASE WHEN j.customer_id = v_uid OR j.offered_to_helper_id = v_uid OR j.helper_id = v_uid")],
  ["view projects the raw column", (m) => m.replace(/CASE\s+WHEN customer_id = auth\.uid\(\) OR offered_to_helper_id = auth\.uid\(\) THEN offered_to_helper_id\s+ELSE NULL::uuid\s+END AS offered_to_helper_id/, "offered_to_helper_id")],
  ["view CASE admits everyone", (m) => m.replace("ELSE NULL::uuid", "ELSE offered_to_helper_id")],
  ["sync grants anon too", (m) => m.replace("'GRANT SELECT (%s) ON public.jobs TO authenticated'", "'GRANT SELECT (%s) ON public.jobs TO authenticated, anon'")],
  ["sync revokes without re-granting", (m) => m.replace(/EXECUTE format\(\s*'GRANT SELECT \(%s\) ON public\.jobs TO authenticated',[\s\S]*?\);/, "NULL;")],
  ["sync over-privatises (title)", (m) => m.replace("ARRAY['offered_to_helper_id']::text[]", "ARRAY['offered_to_helper_id','title']::text[]")],
  ["accessor without search_path", (m) => m.replace(/(get_job_offer_targets\(p_job_ids uuid\[\] DEFAULT NULL\)[\s\S]*?STABLE SECURITY DEFINER\n) SET search_path TO 'public'\n/, "$1")],
  ["restated open_jobs_browse REVOKE ALL dropped", (m) => m.replace("  REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;\n", "")],
  ["restated REVOKE spares authenticated", (m) => m.replace("REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;", "REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon;")],
  ["restated REVOKE forgets to re-GRANT SELECT", (m) => m.replace("  GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;\n", "")],
];
for (const [name, mutate] of BROKEN) {
  const broken = mutate(MIG);
  if (broken === MIG) { console.log(`BROKEN "${name}": mutation did not apply (probe bug)`); bad++; continue; }
  const db = await fresh();
  let fails;
  try {
    await db.exec(broken);
    fails = await check(db, EXPECT_AFTER);
  } catch (e) {
    fails = [`apply threw ${e.message}`];
  }
  console.log(`BROKEN "${name}": ${fails.length} expectation(s) fail${fails.length ? ` (e.g. ${fails[0].slice(0, 110)})` : " -- NOT CAUGHT"}`);
  if (fails.length === 0) bad++;
  await db.close();
}

// 4. Skip path
{
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;");
  try {
    await db.exec(MIG);
    await db.exec(MIG);
    const objs = (await db.query("SELECT to_regprocedure('public.get_job_offer_targets(uuid[])') IS NULL AS a, to_regclass('public.open_jobs_browse') IS NULL AS b")).rows[0];
    console.log(`SKIP path: applied twice on an empty database, accessor absent=${objs.a}, view absent=${objs.b}`);
    if (!objs.a || !objs.b) bad++;
  } catch (e) {
    console.log(`SKIP path: threw ${e.message}`);
    bad++;
  }
  await db.close();
}

console.log(bad === 0 ? "\nPASS" : `\nFAIL (${bad})`);
process.exit(bad === 0 ? 0 : 1);
