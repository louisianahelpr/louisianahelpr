#!/usr/bin/env node
/**
 * PGlite proof for 20261004192410_application_flags_per_direction (docs/OPEN.md Q1206).
 *
 *   node src/test/pglite/applicationFlagsPerDirection.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/applicationFlagsPerDirection.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.applications as LIVE on 2026-10-04
 * (scripts/probes/fixtures/applications.live.sql, with the live scan trigger
 * and its stub detector: ten digits in a row), plus the Q1232 column grants
 * (read out of 20261004191007, which this migration builds on). The new
 * migration is applied up to its export_my_data restatement (that function
 * needs most of the schema; its two changes are pinned by
 * dataExportCoversEveryUserTable.test.ts). The accept RPC and the applicant's
 * own note edit are modelled as the live writers are: a SECURITY DEFINER
 * function for the poster's offer message, the applicant's own PATCH (Q1234
 * grants message) for the note.
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
const NEW = FULL.slice(0, FULL.indexOf("-- The no-argument door stays closed (Q408)"));
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
check("I0 the migration's pre-export part and the Q1232 grants were read", NEW.includes("CREATE OR REPLACE FUNCTION public.scan_application_contact_info()") && !NEW.includes("export_my_data(p_user_id") && Q1232_GRANTS.includes("GRANT SELECT ("));

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "10000000-0000-4000-8000-000000000001";
const APP = "20000000-0000-4000-8000-000000000001";
const PHONE = "call me 5045551234";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(Q1232_GRANTS);
// The Q1234 column UPDATE grant the applicant's note edit rides on.
await db.exec(`REVOKE UPDATE ON public.applications FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status, decline_reason, message, attachment_urls) ON public.applications TO authenticated;`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
await db.exec(`
CREATE FUNCTION public.zz_offer(p_app uuid, p_msg text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.applications SET offer_message = p_msg WHERE id = p_app
$f$;
GRANT EXECUTE ON FUNCTION public.zz_offer(uuid, text) TO authenticated;
INSERT INTO public.jobs (id, customer_id, status, payment_status) VALUES ('${JOB}', '${POSTER}', 'open', 'escrow');
INSERT INTO public.applications (id, job_id, helper_id, message) VALUES ('${APP}', '${JOB}', '${HELPR}', '${PHONE}');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false); SET ROLE authenticated;`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const col = async (c) => {
  try { return (await db.query(`SELECT ${c} AS v FROM public.applications WHERE id = '${APP}'`)).rows[0].v; }
  catch { return "<no such column>"; }
};

// ── the applicant's flagged note never reaches the poster's client (RED: it does) ──
{
  const r = await as(POSTER, `SELECT message FROM public.applications WHERE id = '${APP}'`);
  check("R1 the poster's read of the flagged note carries no text", r.ok && r.rows[0]?.message == null, r.ok ? JSON.stringify(r.rows[0]) : r.err);
  check("R2 ...the flag still says why (flagged_hidden)", (await col("flagged_hidden")) === true);
  const w = await as(POSTER, `SELECT message_withheld FROM public.applications WHERE id = '${APP}'`);
  check("R3 the withheld copy is not readable by a client", !w.ok && /permission denied|does not exist/i.test(w.err), w.ok ? JSON.stringify(w.rows) : w.err);
  check("R4 the server keeps the text (moderation, the author's export)", (await col("message_withheld")) === PHONE, String(await col("message_withheld")));
}
// ── the poster's CLEAN offer is not hidden by the applicant's flag (RED: one flag hides both) ──
{
  const o = await as(POSTER, `SELECT public.zz_offer('${APP}', 'See you Saturday at 9')`);
  const h = await as(HELPR, `SELECT offer_message, offer_message_flagged_hidden AS f FROM public.applications WHERE id = '${APP}'`);
  check("R5 the Helpr reads the poster's clean offer, unflagged in its own direction", o.ok && h.ok && h.rows[0]?.offer_message === "See you Saturday at 9" && h.rows[0]?.f === false, h.ok ? JSON.stringify(h.rows[0]) : h.err);
  check("R6 the later offer write did not un-flag the note", (await col("flagged_hidden")) === true && (await col("message_withheld")) === PHONE);
}
// ── the poster's flagged offer never reaches the Helpr's client ───────────
{
  await as(POSTER, `SELECT public.zz_offer('${APP}', 'pay me on venmo 5045559999')`);
  const t = await as(HELPR, `SELECT offer_message FROM public.applications WHERE id = '${APP}'`);
  check("R7a the Helpr's read of the poster's flagged offer carries no text", t.ok && t.rows[0]?.offer_message == null, t.ok ? JSON.stringify(t.rows[0]) : t.err);
  const h = await as(HELPR, `SELECT offer_message, offer_message_flagged_hidden AS f FROM public.applications WHERE id = '${APP}'`);
  check("R7 the Helpr's read of a flagged offer carries no text, and its own flag is set", h.ok && h.rows[0]?.offer_message == null && h.rows[0]?.f === true, h.ok ? JSON.stringify(h.rows[0]) : h.err);
  check("R8 the server keeps the poster's text", (await col("offer_message_withheld")) === "pay me on venmo 5045559999");
}
// ── a corrected note un-flags itself; the other direction stays as it is ──
{
  const e = await as(HELPR, `UPDATE public.applications SET message = 'I can do Saturday' WHERE id = '${APP}' RETURNING id`);
  check("L1 the applicant's clean edit lands, un-flags the note and drops the withheld copy",
    e.ok && (await col("message")) === "I can do Saturday" && (await col("flagged_hidden")) === false && (await col("message_withheld")) === null, e.ok ? "" : e.err);
  check("L2 ...and leaves the poster's flagged offer flagged", (await col("offer_message_flagged_hidden")) === true && (await col("offer_message")) === null);
  check("L3 flag_reason now names the offer's leak", (await col("flag_reason")) === "phone number", String(await col("flag_reason")));
}

// ── an explicit NULL clears a withheld note (AppliedJobsTab sends null) ──
{
  const f = await as(HELPR, `UPDATE public.applications SET message = 'text me 5045550000' WHERE id = '${APP}' RETURNING id`);
  check("L4 a flagged note written again is withheld again", f.ok && (await col("flagged_hidden")) === true && (await col("message")) === null);
  const c = await as(HELPR, `UPDATE public.applications SET message = NULL WHERE id = '${APP}' RETURNING id`);
  check("L5 the applicant clears the withheld note with an explicit NULL: unflagged, the withheld copy dropped",
    c.ok && (await col("flagged_hidden")) === false && (await col("message_withheld")) === null && (await col("message")) === null,
    c.ok ? JSON.stringify({ f: await col("flagged_hidden"), w: await col("message_withheld") }) : c.err);
  check("L6 ...and the poster's flagged offer is untouched by it", (await col("offer_message_flagged_hidden")) === true && (await col("offer_message_withheld")) === "pay me on venmo 5045559999");
  const a = await as(HELPR, `UPDATE public.applications SET attachment_urls = ARRAY['x.jpg'] WHERE id = '${APP}' RETURNING id`);
  check("L7 a write of another column re-judges nothing", a.ok && (await col("offer_message_flagged_hidden")) === true);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
