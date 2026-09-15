// Probe: 20260915041247_revoke_open_jobs_browse_writes in real Postgres (PGlite).
// NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/open-jobs-browse-writes.probe.mjs
//
// Reproduces the prod shape read 2026-09-15: a `jobs` table with RLS on, and
// public.open_jobs_browse owned by a BYPASSRLS role, WITH (security_invoker=
// false), carrying the anon/authenticated write grants the default-privilege
// rule hands every postgres-owned relation in public.
//
// 1. BEFORE: anon DELETE and a stranger UPDATE through the view both land.
// 2. AFTER (migration applied 3x): both are refused, and SELECT through the
//    view still works for anon and for a signed-in user.
// 3. Broken copies each fail an expectation.
// 4. Skip path: no view -> the migration is a no-op.
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
const MIG = fs.readFileSync(new URL("../../supabase/migrations/20260915041247_revoke_open_jobs_browse_writes.sql", import.meta.url), "utf8");

const OWNER = "vbypass"; // stands in for postgres: bypasses RLS, not a superuser
const STRANGER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const JOB = "e6979a12-ee25-46c9-98f5-c088189849e5";

// Mirrors prod: postgres' default privileges GRANT arwdxm to anon/authenticated
// on every relation it creates in public, which is exactly what re-opens the
// hole on a DROP+CREATE.
const SETUP = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE ${OWNER} NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT ${OWNER} TO current_user;

CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid,
  status text, payment_status text);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_owner_rw ON public.jobs TO authenticated
  USING (auth.uid() = customer_id) WITH CHECK (auth.uid() = customer_id);
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', NULL, 'open', 'escrow');
CREATE VIEW public.open_jobs_browse WITH (security_invoker=false) AS
  SELECT id, customer_id, helper_id, status, payment_status
    FROM public.jobs WHERE payment_status IN ('escrow','payout_pending','released');
-- On prod, postgres (BYPASSRLS) owns BOTH jobs and the view, so an
-- security_invoker=false view reads/writes jobs with RLS bypassed. Mirror that:
-- ${OWNER} owns both. Base-table access through the view then uses ${OWNER}'s
-- rights, so anon/authenticated need only SELECT on the view.
ALTER TABLE public.jobs OWNER TO ${OWNER};
ALTER VIEW public.open_jobs_browse OWNER TO ${OWNER};
-- The prod ACL, as the default-privilege rule leaves it after a DROP+CREATE:
-- anon/authenticated hold the full write set on the view (arwdxm).
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON public.open_jobs_browse TO anon, authenticated;
`;

async function fresh({ migration = null, times = 1 } = {}) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times && migration; i++) await db.exec(migration);
  return db;
}

async function asRole(db, role, uid, sql) {
  await db.exec("BEGIN");
  try {
    if (uid) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role })]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    let rows, err = null;
    try { rows = (await db.query(sql)).rows; } catch (e) { err = e; }
    return { rows, err };
  } finally {
    await db.exec("ROLLBACK");
  }
}

const CASES = [
  { id: "anon DELETE via view", role: "anon", uid: null, sql: `DELETE FROM public.open_jobs_browse WHERE id='${JOB}' RETURNING id`, before: "applied", after: "refused" },
  { id: "stranger UPDATE customer_id via view", role: "authenticated", uid: STRANGER, sql: `UPDATE public.open_jobs_browse SET customer_id='${STRANGER}' WHERE id='${JOB}' RETURNING id`, before: "applied", after: "refused" },
  { id: "anon INSERT foreign job via view", role: "anon", uid: null, sql: `INSERT INTO public.open_jobs_browse (id, customer_id, status, payment_status) VALUES (gen_random_uuid(), '${POSTER}', 'open', 'escrow') RETURNING id`, before: "applied", after: "refused" },
  { id: "anon SELECT via view (must keep working)", role: "anon", uid: null, sql: `SELECT id FROM public.open_jobs_browse WHERE id='${JOB}'`, before: "applied", after: "applied" },
  { id: "authenticated SELECT via view (must keep working)", role: "authenticated", uid: STRANGER, sql: `SELECT id FROM public.open_jobs_browse WHERE id='${JOB}'`, before: "applied", after: "applied" },
];

function outcome(r, isSelect) {
  if (r.err) return r.err.code === "42501" ? "refused" : `error ${r.err.code}`;
  if (isSelect) return "applied";
  return r.rows.length ? "applied" : "noop";
}

let failures = 0;
async function suite(label, db, key) {
  console.log(`\n== ${label}`);
  for (const c of CASES) {
    const r = await asRole(db, c.role, c.uid, c.sql);
    const got = outcome(r, /^SELECT/i.test(c.sql));
    const pass = got === c[key];
    if (!pass) failures++;
    console.log(`${pass ? "ok  " : "FAIL"} ${got.padEnd(8)} ${c.id}${r.err && got !== "refused" ? `  [${r.err.message}]` : ""}`);
  }
}

{ const db = await fresh(); await suite("1. BEFORE (default-priv grants live): writes land, reads work", db, "before"); }
{
  const db = await fresh({ migration: MIG, times: 3 });
  await suite("2. AFTER (migration 3x): writes refused, reads work", db, "after");
  const acl = (await db.query(`SELECT relacl::text a FROM pg_class WHERE oid='public.open_jobs_browse'::regclass`)).rows[0].a;
  const clean = !/anon=[a-z]*[awdD]/.test(acl.replace("anon=r", "")) && /anon=r/.test(acl);
  console.log(`${/anon=r\//.test(acl) && !/anon=arw/.test(acl) ? "ok  " : "FAIL"} anon keeps SELECT, loses writes (${acl})`);
  if (!(/anon=r\//.test(acl) && !/anon=arw/.test(acl))) failures++;
}

const BROKEN = [
  ["REVOKE omits the named roles (only FROM PUBLIC — their explicit grant survives)", MIG.replace("FROM PUBLIC, anon, authenticated", "FROM PUBLIC")],
  ["REVOKE weakened to DELETE only (UPDATE/INSERT stay open)", MIG.replace("REVOKE ALL ON public.open_jobs_browse", "REVOKE DELETE ON public.open_jobs_browse")],
];
console.log("\n== 3. Broken copies (each must fail >= 1 expectation)");
for (const [name, sql] of BROKEN) {
  if (sql === MIG) { console.log(`FAIL  mutation did not apply: ${name}`); failures++; continue; }
  const db = await fresh({ migration: sql });
  let caught = [];
  for (const c of CASES) {
    const r = await asRole(db, c.role, c.uid, c.sql);
    if (outcome(r, /^SELECT/i.test(c.sql)) !== c.after) caught.push(c.id);
  }
  console.log(`${caught.length ? "ok  " : "FAIL"} ${name}: caught by ${caught.join("; ") || "NOTHING"}`);
  if (!caught.length) failures++;
}

{
  const db = new PGlite();
  let ok = true;
  try { await db.exec(MIG); await db.exec(MIG); } catch (e) { ok = false; console.log(e.message); }
  console.log(`\n== 4. Skip path\n${ok ? "ok  " : "FAIL"} no public.open_jobs_browse: migration runs twice as a no-op`);
  if (!ok) failures++;
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL EXPECTATIONS HELD");
process.exit(failures ? 1 : 0);
