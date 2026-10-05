#!/usr/bin/env node
/**
 * PGlite proof for 20261005070359_decline_reason_contact_details_withheld (Q1285).
 *
 *   node src/test/pglite/declineReasonContactWithheld.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declineReasonContactWithheld.pglite.mjs # RED: prod's state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = applicationFlagsPerDirection.pglite.mjs's (public.applications as
 * live, scripts/probes/fixtures/applications.live.sql, the Q1232/Q1234 column
 * grants) with 20261004192410's pre-export part applied (= prod: md5 of
 * scan_application_contact_info live a905d83f… = that file). The fixture's stub
 * detector is replaced by the REAL contact_leak_reason (20260915030812, md5 =
 * live). The poster's decline is their own PATCH, as useOfferHandlers sends it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/applications.live.sql");
const Q1232 = read("../../../supabase/migrations/20261004191007_application_flag_reason_withheld.sql");
const Q1232_GRANTS = [...Q1232.matchAll(/^(REVOKE|GRANT)\s[^;]*ON public\.applications[^;]*;/gm)].map((m) => m[0]).join("\n");
const FULL = read("../../../supabase/migrations/20261004192410_application_flags_per_direction.sql");
const PROD = FULL.slice(0, FULL.indexOf("-- The no-argument door stays closed (Q408)"));
const NEW = read("../../../supabase/migrations/20261005070359_decline_reason_contact_details_withheld.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against PROD's state (expect FAILs)`);

function cut(file, name) {
  const sql = read(`../../../supabase/migrations/${file}`);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
  return sql.slice(m.index, close + open[1].length) + ";";
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "10000000-0000-4000-8000-000000000001";
const app = (n) => `20000000-0000-4000-8000-00000000000${n}`;
const helper = (n) => `30000000-0000-4000-8000-00000000000${n}`;

const db = new PGlite();
await db.exec(LIVE);
await db.exec(Q1232_GRANTS);
await db.exec(`REVOKE UPDATE ON public.applications FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status, decline_reason, message, attachment_urls) ON public.applications TO authenticated;`);
await db.exec(`DROP FUNCTION IF EXISTS public.contact_leak_reason(text) CASCADE;`);
await db.exec(cut("20260915030812_contact_leak_reason_exempts_location_shares.sql", "contact_leak_reason"));
await db.exec(PROD);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
await db.exec(`
INSERT INTO public.jobs (id, customer_id, status, payment_status) VALUES ('${JOB}', '${POSTER}', 'open', 'escrow');
INSERT INTO public.applications (id, job_id, helper_id, message) VALUES
  ('${app(1)}', '${JOB}', '${HELPR}', 'I can help'),
  ('${app(2)}', '${JOB}', '${helper(2)}', 'I can help'),
  ('${app(3)}', '${JOB}', '${helper(3)}', 'I can help'),
  ('${app(4)}', '${JOB}', '${helper(4)}', 'I can help');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false); SET ROLE authenticated;`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const row = async (id) => (await db.query(`SELECT status, decline_reason, flagged_hidden, flag_reason FROM public.applications WHERE id = '${id}'`)).rows[0];
const decline = (id, reason) =>
  as(POSTER, `UPDATE public.applications SET status = 'rejected', decline_reason = '${reason}' WHERE id = '${id}' AND status = 'pending' RETURNING id`);

for (const [n, label, text] of [
  [1, "a phone number", "Found someone else. Text me at 504 555 1234 for the next one"],
  [2, "an email address", "Not the right fit, but email me: jo@example.com"],
  [3, "a payment handle", "Job is on hold. Venmo me a deposit to hold your spot"],
]) {
  const r = await decline(app(n), text);
  const after = await row(app(n));
  check(`R${n} a decline reason carrying ${label} never reaches the Helpr (stored NULL)`, r.ok && after.decline_reason === null, r.ok ? JSON.stringify(after) : r.err);
  check(`L${n} ...and the decline itself still lands`, after.status === "rejected", after.status);
}
{
  const r = await decline(app(4), "Found someone else. Thanks for applying!");
  const after = await row(app(4));
  check("L4 a clean reason is kept as written", r.ok && after.decline_reason === "Found someone else. Thanks for applying!", JSON.stringify(after));
  check("L5 the applicant-side flags are not touched by the decline", after.flagged_hidden === false && after.flag_reason === null, JSON.stringify(after));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
