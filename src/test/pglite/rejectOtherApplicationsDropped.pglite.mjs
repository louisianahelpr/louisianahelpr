#!/usr/bin/env node
/**
 * PGlite proof for 20261004193221_drop_reject_other_applications_on_accept (docs/OPEN.md Q1216).
 *
 *   node src/test/pglite/rejectOtherApplicationsDropped.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/rejectOtherApplicationsDropped.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The function is created from its newest definition on main
 * (20261003193541, md5(prosrc) live 77d8801353cd9d70d69066fb06810af7 per
 * src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs) with its live
 * grant (EXECUTE to authenticated). RED: a signed-in client can call it.
 * AFTER: it is gone, the drop replays cleanly, and nothing else in the
 * fixture depends on it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261004193221_drop_reject_other_applications_on_accept.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, helper_confirmed_at timestamptz, status text);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, helper_id uuid, status public.application_status, updated_at timestamptz);
`);
await db.exec(cut("20261003193541_accept_completes_after_stripe_setup.sql", "reject_other_applications_on_accept"));
await db.exec(`REVOKE ALL ON FUNCTION public.reject_other_applications_on_accept(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_other_applications_on_accept(uuid, uuid) TO authenticated;`);
let replay = "ok";
if (MODE !== "skip") {
  try { for (let i = 0; i < 3; i++) await db.exec(NEW); } catch (e) { replay = e.message; }
}
check("A1 the drop replays 3x without error", replay === "ok", replay);
const fn = (await db.query(`SELECT to_regprocedure('public.reject_other_applications_on_accept(uuid, uuid)') IS NOT NULL AS present`)).rows[0].present;
check("R1 the uncalled definer RPC is gone", fn === false, `present=${fn}`);
await db.exec(`SELECT set_config('request.uid', '437de07d-1bd7-46c8-a451-6b46aa3bcad5', false); SET ROLE authenticated;`);
let call;
try { await db.query(`SELECT public.reject_other_applications_on_accept(gen_random_uuid(), gen_random_uuid())`); call = "callable"; }
catch (e) { call = e.message; }
await db.exec("RESET ROLE");
check("R2 a signed-in client can no longer call it", /does not exist/.test(call), call);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
