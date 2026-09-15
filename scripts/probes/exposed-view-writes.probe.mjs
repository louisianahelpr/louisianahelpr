// Probe: 20260915041247 + 20260915043245 and the class check
// scripts/ci/client-writable-views.sql, in real Postgres (PGlite, PG17).
// NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/exposed-view-writes.probe.mjs
//
// Prod shape read 2026-09-15: jobs with RLS on; both views owned by a BYPASSRLS
// role; open_jobs_browse security_invoker=false, jobs_helper_safe
// security_invoker=on; and the default-privilege rule that hands anon/
// authenticated arwdxm on every relation that role creates in public.
//
// 1. BEFORE: class check is RED (both views listed); anon UPDATE of
//    payment_status+customer_id and anon DELETE through open_jobs_browse land.
// 2. AFTER (both migrations, each 3x): class check GREEN; every write through
//    either view refused for anon and authenticated; SELECT still works.
// 3. DROP+CREATE of a view after the fix: class check goes RED again (the
//    reason the check reads the catalog, not the migration).
// 4. Broken copies of the new migration each leave the check red.
// 5. Skip path: no views -> both migrations run twice as no-ops.
// 6. PG15 parse-safety: MAINTAIN appears only inside a string literal.
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
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const MIG_A = read("../../supabase/migrations/20260915041247_revoke_open_jobs_browse_writes.sql");
const MIG_B = read("../../supabase/migrations/20260915043245_revoke_writes_on_exposed_views.sql");
const CHECK = read("../ci/client-writable-views.sql");

const OWNER = "vbypass"; // stands in for postgres: BYPASSRLS, not a superuser
const STRANGER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const JOB = "e6979a12-ee25-46c9-98f5-c088189849e5";

const VIEWS = `
CREATE VIEW public.open_jobs_browse WITH (security_invoker=false) AS
  SELECT id, customer_id, helper_id, status, payment_status, title
    FROM public.jobs WHERE payment_status IN ('escrow','payout_pending','released');
CREATE VIEW public.jobs_helper_safe WITH (security_invoker=on) AS
  SELECT id, customer_id, helper_id, status, payment_status, title FROM public.jobs;
GRANT SELECT ON public.open_jobs_browse, public.jobs_helper_safe TO anon, authenticated;
`;

const SETUP = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE ${OWNER} NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, ${OWNER};
GRANT CREATE ON SCHEMA public TO ${OWNER};
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, ${OWNER};
GRANT ${OWNER} TO current_user;
-- prod: ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public -> anon/authenticated arwdxm
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, MAINTAIN ON TABLES TO anon, authenticated;
SET ROLE ${OWNER};
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid,
  helper_id uuid, status text, payment_status text, title text);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_read ON public.jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY jobs_owner_write ON public.jobs FOR UPDATE TO authenticated
  USING (auth.uid() = customer_id) WITH CHECK (auth.uid() = customer_id);
CREATE POLICY jobs_owner_delete ON public.jobs FOR DELETE TO authenticated USING (auth.uid() = customer_id);
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', NULL, 'open', 'escrow', 'Deep clean');
${VIEWS}
RESET ROLE;
`;

async function fresh(migrations = [], times = 1) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times; i++) for (const m of migrations) await db.exec(m);
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

const checkRows = async (db) => (await db.query(CHECK)).rows;

const W = (rel) => [
  { id: `anon UPDATE payment_status+customer_id via ${rel}`, role: "anon", uid: null, sql: `UPDATE public.${rel} SET payment_status='refunded', customer_id='${STRANGER}' WHERE id='${JOB}' RETURNING id` },
  { id: `anon DELETE via ${rel}`, role: "anon", uid: null, sql: `DELETE FROM public.${rel} WHERE id='${JOB}' RETURNING id` },
  { id: `anon INSERT via ${rel}`, role: "anon", uid: null, sql: `INSERT INTO public.${rel} (customer_id, status, payment_status) VALUES ('${POSTER}', 'open', 'escrow') RETURNING id` },
  { id: `stranger UPDATE customer_id via ${rel}`, role: "authenticated", uid: STRANGER, sql: `UPDATE public.${rel} SET customer_id='${STRANGER}' WHERE id='${JOB}' RETURNING id` },
  { id: `stranger DELETE via ${rel}`, role: "authenticated", uid: STRANGER, sql: `DELETE FROM public.${rel} WHERE id='${JOB}' RETURNING id` },
  { id: `stranger INSERT via ${rel}`, role: "authenticated", uid: STRANGER, sql: `INSERT INTO public.${rel} (customer_id, status, payment_status) VALUES ('${STRANGER}', 'open', 'unpaid') RETURNING id` },
];
const WRITES = [...W("open_jobs_browse"), ...W("jobs_helper_safe")];
const READS = [
  { id: "anon SELECT open_jobs_browse", role: "anon", uid: null, sql: `SELECT id FROM public.open_jobs_browse WHERE id='${JOB}'` },
  { id: "authenticated SELECT open_jobs_browse", role: "authenticated", uid: STRANGER, sql: `SELECT id FROM public.open_jobs_browse WHERE id='${JOB}'` },
  { id: "authenticated SELECT jobs_helper_safe", role: "authenticated", uid: STRANGER, sql: `SELECT id FROM public.jobs_helper_safe WHERE id='${JOB}'` },
];

function outcome(r) {
  if (r.err) return r.err.code === "42501" ? "refused" : `error ${r.err.code}`;
  return r.rows.length ? "applied" : "noop";
}

let failures = 0;
const expect = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

{
  console.log("== 1. BEFORE (prod shape, default-priv grants live)");
  const db = await fresh();
  const rows = await checkRows(db);
  const views = [...new Set(rows.map((r) => r.view))].sort();
  expect(views.join(",") === "jobs_helper_safe,open_jobs_browse", `class check RED: ${rows.length} offending grants on ${views.join(", ")}`);
  for (const c of W("open_jobs_browse").slice(0, 2)) {
    const got = outcome(await asRole(db, c.role, c.uid, c.sql));
    expect(got === "applied", `${got.padEnd(8)} ${c.id}`);
  }
  const s = outcome(await asRole(db, "authenticated", STRANGER, W("open_jobs_browse")[3].sql));
  expect(s === "applied", `${s.padEnd(8)} stranger UPDATE customer_id via open_jobs_browse (RLS bypassed)`);
}

{
  console.log("\n== 2. AFTER (20260915041247 + 20260915043245, 3x)");
  const db = await fresh([MIG_A, MIG_B], 3);
  const rows = await checkRows(db);
  expect(rows.length === 0, `class check GREEN (${rows.length} rows)`);
  for (const c of WRITES) {
    const got = outcome(await asRole(db, c.role, c.uid, c.sql));
    expect(got === "refused", `${got.padEnd(8)} ${c.id}`);
  }
  for (const c of READS) {
    const got = outcome(await asRole(db, c.role, c.uid, c.sql));
    expect(got === "applied", `${got.padEnd(8)} ${c.id} (must keep working)`);
  }
  const intact = (await db.query(`SELECT customer_id, payment_status FROM public.jobs WHERE id='${JOB}'`)).rows[0];
  expect(intact.customer_id === POSTER && intact.payment_status === "escrow", "job row untouched");

  console.log("\n== 2b. A column-level grant alone is still a write door; the check sees it");
  await db.exec(`GRANT UPDATE (payment_status) ON public.open_jobs_browse TO anon`);
  const col = await checkRows(db);
  const colWrite = outcome(await asRole(db, "anon", null, `UPDATE public.open_jobs_browse SET payment_status='refunded' WHERE id='${JOB}' RETURNING id`));
  expect(colWrite === "applied", `${colWrite.padEnd(8)} anon column-level UPDATE via open_jobs_browse (the door is real)`);
  expect(col.some((r) => r.view === "open_jobs_browse" && r.role === "anon" && r.priv === "UPDATE"), `class check RED on a column-only UPDATE grant (${col.length} rows)`);
  await db.exec(MIG_B);
  expect((await checkRows(db)).length === 0, "re-running 20260915043245 removes the column-level grant too");

  console.log("\n== 3. DROP+CREATE after the fix re-opens it; the check sees it");
  await db.exec(`SET ROLE ${OWNER}; DROP VIEW public.open_jobs_browse; CREATE VIEW public.open_jobs_browse WITH (security_invoker=false) AS SELECT id, customer_id, payment_status FROM public.jobs; RESET ROLE;`);
  const again = await checkRows(db);
  expect(again.some((r) => r.view === "open_jobs_browse" && r.role === "anon" && r.priv === "DELETE"), `class check RED again after recreation (${again.length} rows)`);
}

{
  console.log("\n== 4. Broken copies of 20260915043245 (each must leave the check red)");
  const BROKEN = [
    ["only FROM PUBLIC (named roles keep their explicit grants)", MIG_B.replaceAll("FROM PUBLIC, anon, authenticated", "FROM PUBLIC")],
    ["DELETE dropped from the privilege list", MIG_B.replace("'INSERT, UPDATE, DELETE, TRUNCATE", "'INSERT, UPDATE, TRUNCATE")],
    ["jobs_helper_safe name and the loop both gone", MIG_B.replace("to_regclass('public.jobs_helper_safe')", "NULL").replace("c.relkind IN ('v', 'm')", "false")],
  ];
  for (const [name, sql] of BROKEN) {
    if (sql === MIG_B) { expect(false, `mutation did not apply: ${name}`); continue; }
    const db = await fresh([MIG_A, sql]);
    const rows = await checkRows(db);
    expect(rows.length > 0, `${name}: check red with ${rows.length} rows`);
  }
}

{
  console.log("\n== 5. Skip path");
  const db = new PGlite();
  let ok = true;
  try {
    await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
    for (let i = 0; i < 2; i++) { await db.exec(MIG_A); await db.exec(MIG_B); }
  } catch (e) { ok = false; console.log(e.message); }
  expect(ok, "no views: both migrations run twice as no-ops");
}

{
  console.log("\n== 6. PG15 parse-safety (the replay gate runs supabase/postgres:15)");
  for (const [name, sql] of [["20260915041247", MIG_A], ["20260915043245", MIG_B], ["client-writable-views.sql", CHECK]]) {
    const bare = sql.split("\n").filter((l) => !l.trim().startsWith("--") && /\bMAINTAIN\b/.test(l) && !/'[^']*\bMAINTAIN\b[^']*'/.test(l));
    expect(bare.length === 0, `${name}: MAINTAIN only inside a string literal${bare.length ? ` — bare: ${bare.join(" | ")}` : ""}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL EXPECTATIONS HELD");
process.exit(failures ? 1 : 0);
