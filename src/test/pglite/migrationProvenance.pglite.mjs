/**
 * PGlite proof for Q117: 20260923103737_migration_deploy_ledger +
 * scripts/lib/migrationProvenance.mjs, on a real Postgres.
 *
 *   node src/test/pglite/migrationProvenance.pglite.mjs
 *   PLANT=none node ...   (no out-of-band version planted: the red cases below FAIL)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Proves: the migration applies 3x; anon/authenticated cannot read or write the
 * ledger even under Supabase's default privileges; the receipt INSERT the
 * workflow sends is accepted and is idempotent; the CHECKs reject a malformed
 * version/sha; with every post-cutoff version receipted the check is clean; a
 * version planted in schema_migrations with no receipt (an out-of-band apply)
 * is reported; a receipt naming a non-db-deploy run is reported as forged.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { provenanceFindings, receiptInsertSql, DEPLOY_WORKFLOW_PATH } from "../../../scripts/lib/migrationProvenance.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20260923103737_migration_deploy_ledger.sql", import.meta.url).pathname,
  "utf8",
);
const CUTOFF = "20260923103737";

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
-- Supabase's default privileges: every new relation in public is granted to the client roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
INSERT INTO supabase_migrations.schema_migrations (version)
  SELECT to_char(timestamp '2026-01-01' + make_interval(hours => g), 'YYYYMMDDHH24MISS') FROM generate_series(1, 400) g;
INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('${CUTOFF}');
`);

for (let i = 1; i <= 3; i++) {
  try {
    await db.exec(MIGRATION);
    check(`migration applies (pass ${i})`, true);
  } catch (e) {
    check(`migration applies (pass ${i})`, false, e.message);
  }
}

for (const role of ["anon", "authenticated"]) {
  for (const [what, sql] of [
    ["SELECT", "SELECT count(*) FROM public.migration_deploy_ledger"],
    ["INSERT", `INSERT INTO public.migration_deploy_ledger (version, run_id, head_sha) VALUES ('20991231000000', 1, '${"a".repeat(40)}')`],
  ]) {
    let denied = false;
    try {
      await db.exec(`SET ROLE ${role}; ${sql};`);
    } catch (e) {
      denied = /permission denied/.test(e.message);
    } finally {
      await db.exec("RESET ROLE");
    }
    check(`${role} cannot ${what} the ledger`, denied);
  }
}

// A db-deploy run applies two new migrations and records them.
const A = "20260924000000";
const B = "20260924000100";
await db.exec(`INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('${A}'), ('${B}')`);
const sha = "0123456789abcdef0123456789abcdef01234567";
const ins = receiptInsertSql([A, B], { runId: 35848225652, runAttempt: 1, headSha: sha });
const first = await db.query(ins);
const again = await db.query(ins);
check("receipt insert writes one row per version", first.rows.length === 2, `${first.rows.length}`);
check("receipt insert is idempotent (re-run writes nothing)", again.rows.length === 0, `${again.rows.length}`);

for (const [what, sql] of [
  ["malformed version", `INSERT INTO public.migration_deploy_ledger (version, run_id, head_sha) VALUES ('2026', 1, '${sha}')`],
  ["malformed sha", `INSERT INTO public.migration_deploy_ledger (version, run_id, head_sha) VALUES ('20260924000200', 1, 'main')`],
  ["run id 0", `INSERT INTO public.migration_deploy_ledger (version, run_id, head_sha) VALUES ('20260924000200', 0, '${sha}')`],
]) {
  let refused = false;
  try {
    await db.exec(sql);
  } catch (e) {
    refused = /check constraint/.test(e.message);
  }
  check(`ledger refuses a ${what}`, refused);
}

const deployRun = { path: DEPLOY_WORKFLOW_PATH, head_branch: "main" };
async function judge(runs) {
  const prodVersions = (await db.query("SELECT version FROM supabase_migrations.schema_migrations")).rows.map((r) => r.version);
  const ledger = (await db.query("SELECT version, run_id FROM public.migration_deploy_ledger")).rows;
  return provenanceFindings({ prodVersions, ledger, cutoff: CUTOFF, acknowledged: [], runs });
}

const clean = await judge(new Map([["35848225652", deployRun]]));
check("every post-cutoff version receipted -> clean", !clean.unrecorded.length && !clean.forged.length, JSON.stringify(clean));
check("the pre-cutoff history is not judged", clean.judged === 2, `${clean.judged}`);

// The Q117 shape: something other than db-deploy applies a migration.
const OUT_OF_BAND = "20260924000300";
if (process.env.PLANT !== "none") {
  await db.exec(`INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('${OUT_OF_BAND}')`);
}
const red = await judge(new Map([["35848225652", deployRun]]));
check("an out-of-band version (no receipt) is reported", red.unrecorded.includes(OUT_OF_BAND), JSON.stringify(red.unrecorded));

// A receipt that points at some other workflow's run is not a receipt.
const forged = await judge(new Map([["35848225652", { path: ".github/workflows/functions-deploy.yml", head_branch: "main" }]]));
check("a receipt from a non-db-deploy run is reported as forged", forged.forged.length === 2, JSON.stringify(forged.forged));
const missing = await judge(new Map([["35848225652", null]]));
check("a receipt whose run does not exist is reported as forged", missing.forged.length === 2, JSON.stringify(missing.forged));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
