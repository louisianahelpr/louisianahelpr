// Probe: 20260915101101 (no default client grants in public) and the class
// check scripts/ci/client-default-privileges.sql, in real Postgres (PGlite).
// NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/default-client-grants.probe.mjs
//
// Prod shape read 2026-09-15 (pg_default_acl, role postgres, schema public):
//   tables     postgres=arwdDxtm anon=arwdxm authenticated=arwdxm service_role=arwdDxtm
//   sequences  postgres=rwU anon=rwU authenticated=rwU service_role=rwU
// PGlite runs as the superuser `postgres`, which is the role that owns every
// relation in public on prod, so FOR ROLE postgres is exact here.
//
// 1. BEFORE: check RED; a table and a view created now are anon-writable (the
//    open_jobs_browse re-grant), a sequence anon-usable.
// 2. AFTER (3x): check GREEN; a NEW table/view/sequence carries no anon or
//    authenticated privilege; service_role keeps its default; a table that
//    existed BEFORE keeps every grant it had; the service_role entry survives.
// 3. A relation created after the fix gets exactly what its migration grants.
// 4. Broken copies (tables only / anon only): check stays red.
// 5. Replay-safety: runs 3x where no default ACL entry exists.
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
const MIG = read("../../supabase/migrations/20260915101101_no_default_client_grants.sql");
const CHECK = read("../ci/client-default-privileges.sql");

const ROLES = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`;
const PROD_DEFAULTS = `
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, MAINTAIN ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
-- An existing table, created while the defaults were live.
CREATE TABLE public.job_pets (id uuid PRIMARY KEY, name text);
`;

async function fresh(extra = [], times = 1) {
  const db = new PGlite();
  await db.exec(ROLES + PROD_DEFAULTS);
  for (let i = 0; i < times; i++) for (const m of extra) await db.exec(m);
  return db;
}

let failures = 0;
const expect = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const checkRows = async (db) => (await db.query(CHECK)).rows;
const priv = async (db, role, rel, p) => (await db.query(`SELECT has_table_privilege($1, $2, $3) v`, [role, rel, p])).rows[0].v;
const seqPriv = async (db, role, seq, p) => (await db.query(`SELECT has_sequence_privilege($1, $2, $3) v`, [role, seq, p])).rows[0].v;
let n = 0;
const createNew = async (db) => {
  n++;
  await db.exec(`CREATE TABLE public.new_t${n} (id int); CREATE VIEW public.new_v${n} AS SELECT 1 AS id; CREATE SEQUENCE public.new_s${n};`);
  return [`public.new_t${n}`, `public.new_v${n}`, `public.new_s${n}`];
};

{
  console.log("== 1. BEFORE (prod default privileges)");
  const db = await fresh();
  const rows = await checkRows(db);
  expect(rows.length >= 12, `check RED: ${rows.length} rows (${[...new Set(rows.map((r) => `${r.object_type}->${r.grantee}`))].join(", ")})`);
  const [t, v, s] = await createNew(db);
  expect(await priv(db, "anon", t, "INSERT"), `new table ${t}: anon INSERT (default grant)`);
  expect(await priv(db, "anon", v, "DELETE"), `new view ${v}: anon DELETE (the open_jobs_browse re-grant)`);
  expect(await seqPriv(db, "authenticated", s, "USAGE"), `new sequence ${s}: authenticated USAGE`);
}

{
  console.log("\n== 2. AFTER (20260915101101 applied 3x)");
  const db = await fresh([MIG], 3);
  const rows = await checkRows(db);
  expect(rows.length === 0, `check GREEN (${rows.length} rows)`);
  const [t, v, s] = await createNew(db);
  for (const role of ["anon", "authenticated"]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES"]) {
      expect(!(await priv(db, role, t, p)), `new table: ${role} has no ${p}`);
    }
    expect(!(await priv(db, role, v, "SELECT")) && !(await priv(db, role, v, "DELETE")), `new view: ${role} has no SELECT/DELETE`);
    expect(!(await seqPriv(db, role, s, "USAGE")), `new sequence: ${role} has no USAGE`);
  }
  expect(await priv(db, "service_role", t, "INSERT"), "new table: service_role keeps its default (edge functions)");
  expect(await seqPriv(db, "service_role", s, "USAGE"), "new sequence: service_role keeps its default");
  expect(await priv(db, "anon", "public.job_pets", "INSERT") && await priv(db, "authenticated", "public.job_pets", "SELECT"),
    "existing table job_pets keeps its grants (existing objects are untouched)");
  const entries = (await db.query(`SELECT count(*)::int c FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace`)).rows[0].c;
  expect(entries >= 2, `postgres default-ACL entries for public still exist (service_role) — ${entries}`);

  console.log("\n== 3. A post-fix relation gets exactly what its migration grants");
  await db.exec(`CREATE TABLE public.thread_archives2 (id int); ALTER TABLE public.thread_archives2 ENABLE ROW LEVEL SECURITY;
                 GRANT SELECT, INSERT ON public.thread_archives2 TO authenticated;`);
  expect(await priv(db, "authenticated", "public.thread_archives2", "INSERT"), "explicit GRANT INSERT to authenticated works");
  expect(!(await priv(db, "authenticated", "public.thread_archives2", "DELETE")), "…and nothing it did not grant (no DELETE)");
  expect(!(await priv(db, "anon", "public.thread_archives2", "SELECT")), "…and nothing for anon");

  console.log("\n   DROP+CREATE of a view after the fix no longer re-grants writes");
  await db.exec(`DROP VIEW public.${v.split(".")[1]}; CREATE VIEW ${v} AS SELECT 2 AS id; GRANT SELECT ON ${v} TO anon, authenticated;`);
  expect(await priv(db, "anon", v, "SELECT") && !(await priv(db, "anon", v, "DELETE")) && !(await priv(db, "anon", v, "UPDATE")),
    "recreated view: anon SELECT only");
}

{
  console.log("\n== 4. Broken copies (each must leave the check red)");
  const BROKEN = [
    ["tables only (sequences keep anon/authenticated)", MIG.replace(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\n  REVOKE ALL ON SEQUENCES FROM anon, authenticated;/, "")],
    ["anon only (authenticated keeps writes)", MIG.replaceAll("FROM anon, authenticated;", "FROM anon;")],
    ["FROM PUBLIC (named roles keep their entries)", MIG.replaceAll("FROM anon, authenticated;", "FROM PUBLIC;")],
  ];
  for (const [name, sql] of BROKEN) {
    if (sql === MIG) { expect(false, `mutation did not apply: ${name}`); continue; }
    const db = await fresh([sql]);
    const rows = await checkRows(db);
    expect(rows.length > 0, `${name}: check red with ${rows.length} rows`);
  }
}

{
  console.log("\n== 5. Replay-safety: no default-ACL entry at all, 3x");
  const db = new PGlite();
  let ok = true;
  try {
    await db.exec(ROLES);
    for (let i = 0; i < 3; i++) await db.exec(MIG);
  } catch (e) { ok = false; console.log(e.message); }
  expect(ok, "runs three times as a no-op");
  const bare = MIG.split("\n").filter((l) => !l.trim().startsWith("--") && /\bMAINTAIN\b/i.test(l));
  expect(bare.length === 0, "no PG17-only MAINTAIN keyword outside comments (replay image is PG15)");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL EXPECTATIONS HELD");
process.exit(failures ? 1 : 0);
