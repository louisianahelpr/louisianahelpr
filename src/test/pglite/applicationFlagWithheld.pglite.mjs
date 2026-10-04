#!/usr/bin/env node
/**
 * PGlite proof for 20261004191007_application_flag_reason_withheld (docs/OPEN.md Q1232),
 * the GRANT layer. (The export layer, export_my_data's `- 'flag_reason'` on the
 * applicant's own rows, is pinned by src/test/dataExportCoversEveryUserTable.test.ts
 * and its @mutate; the function needs most of the schema to run.)
 *
 *   node src/test/pglite/applicationFlagWithheld.pglite.mjs                    # AFTER: the grant statements applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/applicationFlagWithheld.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.applications as LIVE on 2026-10-04
 * (scripts/probes/fixtures/applications.live.sql). Only the migration's
 * GRANT/REVOKE statements are applied here (its export_my_data restatement
 * needs tables this fixture does not carry); they are read out of the
 * migration file, not retyped. The client reads use the app's own column list
 * (src/lib/applicationColumns.ts).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/applications.live.sql");
const MIG = read("../../../supabase/migrations/20261004191007_application_flag_reason_withheld.sql");
const GRANTS = [...MIG.matchAll(/^(REVOKE|GRANT)\s[^;]*ON public\.applications[^;]*;/gm)].map((m) => m[0]);
const COLS = [...read("../../../src/lib/applicationColumns.ts").matchAll(/^ {2}"(\w+)",$/gm)].map((m) => m[1]);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
check("I0 the migration's two grant statements and the client's 17 columns were read", GRANTS.length === 2 && COLS.length === 17, `${GRANTS.length} statements, ${COLS.length} columns`);

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "10000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
INSERT INTO public.jobs (id, customer_id, status, payment_status) VALUES ('${JOB}', '${POSTER}', 'open', 'escrow');
INSERT INTO public.applications (job_id, helper_id, message) VALUES ('${JOB}', '${HELPR}', 'call me 5045551234');
`);
const flagged = (await db.query(`SELECT flag_reason FROM public.applications`)).rows[0].flag_reason;
check("I1 the contact scan flagged the note (there is a flag_reason to withhold)", flagged === "phone number", String(flagged));
if (MODE !== "skip") for (let i = 0; i < 3; i++) for (const g of GRANTS) await db.exec(g);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}

// ── the withheld column (RED on live: both read it) ───────────────────────
{
  const p = await as(POSTER, `SELECT flag_reason FROM public.applications WHERE job_id = '${JOB}'`);
  check("R1 the poster cannot read the applicant's flag_reason", !p.ok && /permission denied/i.test(p.err), p.ok ? `read ${JSON.stringify(p.rows)}` : p.err);
  const h = await as(HELPR, `SELECT flag_reason FROM public.applications WHERE helper_id = '${HELPR}'`);
  check("R2 the applicant cannot read it either", !h.ok && /permission denied/i.test(h.err), h.ok ? `read ${JSON.stringify(h.rows)}` : h.err);
  const star = await as(POSTER, `SELECT * FROM public.applications WHERE job_id = '${JOB}'`);
  check("R3 select * is refused (so the app names its columns)", !star.ok && /permission denied/i.test(star.err), star.ok ? "read" : star.err);
  const anon = await as(null, `SELECT id FROM public.applications`);
  check("R4 anon holds no SELECT at all", !anon.ok && /permission denied/i.test(anon.err), anon.ok ? JSON.stringify(anon.rows) : anon.err);
}
// ── what the app reads still reads ────────────────────────────────────────
{
  const p = await as(POSTER, `SELECT ${COLS.join(", ")} FROM public.applications WHERE job_id = '${JOB}'`);
  check("L1 the poster's applicant list (APPLICATION_READABLE_COLUMNS) reads, flagged_hidden included", p.ok && p.rows.length === 1 && p.rows[0].flagged_hidden === true, p.ok ? `${p.rows.length} row(s)` : p.err);
  const h = await as(HELPR, `SELECT ${COLS.join(", ")} FROM public.applications WHERE helper_id = '${HELPR}'`);
  check("L2 the applicant's own list reads", h.ok && h.rows.length === 1, h.ok ? `${h.rows.length} row(s)` : h.err);
  const s = await as("service", `SELECT flag_reason FROM public.applications`);
  check("L3 the service role (admin edge functions, export) still reads flag_reason", s.ok && s.rows[0]?.flag_reason === "phone number", s.ok ? JSON.stringify(s.rows) : s.err);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
