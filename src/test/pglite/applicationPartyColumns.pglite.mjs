#!/usr/bin/env node
/**
 * PGlite proof for 20261004190334_application_party_columns (docs/OPEN.md Q1234).
 *
 *   node src/test/pglite/applicationPartyColumns.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/applicationPartyColumns.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.applications as LIVE on 2026-10-04
 * (scripts/probes/fixtures/applications.live.sql: columns, table ACL, the
 * seven policies, lock_applications_owner_columns, the contact scan). The
 * accept RPC and mark_applications_viewed are modelled by SECURITY DEFINER
 * functions owned by the superuser that write offer_message/status and
 * poster_viewed_at, as the live ones do. `SET ROLE authenticated` with
 * request.uid set is PostgREST with a user JWT.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/applications.live.sql");
const NEW = read("../../../supabase/migrations/20261004190334_application_party_columns.sql");
const CHECK = read("../../../scripts/ci/client-insert-columns.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const HELPR2 = "f6cc3ebb-9478-473c-8eb8-62b406f0734f";
const JOB = "10000000-0000-4000-8000-000000000001";
const A1 = "20000000-0000-4000-8000-000000000001"; // HELPR's pending application
const A2 = "20000000-0000-4000-8000-000000000002"; // HELPR2's pending application
const HELPR3 = "96c9899e-87a2-49e2-bbdd-268717d52aee";
const A3 = "20000000-0000-4000-8000-000000000003"; // HELPR3's, for the poster's decline

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE TABLE public.messages (id uuid); CREATE TABLE public.job_revisions (id uuid);
CREATE FUNCTION public.zz_accept(p_app uuid, p_msg text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.applications SET status = 'accepted', offer_message = p_msg WHERE id = p_app
$f$;
CREATE FUNCTION public.zz_mark_viewed(p_job uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.applications SET poster_viewed_at = now() WHERE job_id = p_job AND poster_viewed_at IS NULL
$f$;
GRANT EXECUTE ON FUNCTION public.zz_accept(uuid, text), public.zz_mark_viewed(uuid) TO authenticated;
INSERT INTO public.jobs (id, customer_id, status, payment_status) VALUES ('${JOB}', '${POSTER}', 'open', 'escrow');
INSERT INTO public.applications (id, job_id, helper_id, message, attachment_urls) VALUES
  ('${A1}', '${JOB}', '${HELPR}', 'I can do Saturday', '{}'),
  ('${A2}', '${JOB}', '${HELPR2}', 'Weekdays only', ARRAY['${HELPR2}/${JOB}/license.jpg']),
  ('${A3}', '${JOB}', '${HELPR3}', 'Third applicant', '{}');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : who ? "authenticated" : "anon"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const snap = async (id) => JSON.stringify((await db.query(`SELECT to_jsonb(a) - 'updated_at' AS r FROM public.applications a WHERE id = '${id}'`)).rows[0].r);
const patch = (who, id, set) => as(who, `UPDATE public.applications SET ${set} WHERE id = '${id}' RETURNING id`);
const refused = async (label, who, id, set) => {
  const before = await snap(id);
  const r = await patch(who, id, set);
  const after = await snap(id);
  check(label, !(r.ok && r.rows.length) && before === after, r.ok ? `wrote ${r.rows.length} row(s)` : r.err);
};
const lands = async (label, who, id, set) => {
  const r = await patch(who, id, set);
  check(label, r.ok && r.rows.length === 1, r.ok ? `${r.rows.length} row(s)` : r.err);
};

// ── the applicant writing the poster's fields (RED on live: each lands) ───
await refused("R1 the applicant cannot write the poster's offer_message", HELPR, A1, `offer_message = 'You are hired, pay me direct'`);
await refused("R2 the applicant cannot write a decline_reason", HELPR, A1, `decline_reason = 'x'`);
await refused("R3 the applicant cannot stamp poster_viewed_at", HELPR, A1, `poster_viewed_at = now()`);
await refused("R4 the applicant cannot set closed_reason", HELPR, A1, `closed_reason = 'job_cancelled'`);
await refused("R5 the applicant cannot stake themselves", HELPR, A1, `stake_amount = 500, stake_status = 'staked'`);
// ── the poster writing the applicant's fields ─────────────────────────────
await refused("R6 the poster cannot rewrite the applicant's message", POSTER, A2, `message = 'I will work for free'`);
await refused("R7 the poster cannot strip the applicant's attachments", POSTER, A2, `attachment_urls = '{}'`);
await refused("R8 the poster cannot clear a moderation flag", POSTER, A2, `flagged_hidden = false, flag_reason = NULL`);
await refused("R9 the poster cannot write a stake", POSTER, A2, `stake_status = 'forfeited'`);
await refused("R10 the poster cannot accept by PATCH (accept_application is the door)", POSTER, A2, `status = 'accepted'`);
await refused("R11 another applicant cannot touch someone else's row", HELPR, A2, `message = 'mine now'`);

// ── each party's own writes still land ────────────────────────────────────
await lands("L1 the applicant edits their message (AppliedJobsTab)", HELPR, A1, `message = 'I can do Sunday too'`);
await lands("L2 the applicant re-attaches files (useApplyFlow / AppliedJobsTab)", HELPR, A1, `attachment_urls = ARRAY['${HELPR}/${JOB}/a.jpg']`);
{
  const r = await as(POSTER, `UPDATE public.applications SET status = 'rejected', decline_reason = 'Found someone closer' WHERE id = '${A3}' AND status = 'pending' RETURNING id`);
  check("L3 the poster declines with a reason (useOfferHandlers.declineApplication)", r.ok && r.rows.length === 1, r.ok ? `${r.rows.length} row(s)` : r.err);
}
{
  const v = await as(POSTER, `SELECT public.zz_mark_viewed('${JOB}')`);
  check("L4 mark_applications_viewed (definer) still stamps poster_viewed_at", v.ok && (await db.query(`SELECT count(*)::int n FROM public.applications WHERE poster_viewed_at IS NOT NULL`)).rows[0].n >= 2, v.ok ? "" : v.err);
  const a = await as(POSTER, `SELECT public.zz_accept('${A2}', 'See you Saturday')`);
  check("L5 accept_application (definer) still writes status and offer_message", a.ok && JSON.parse(await snap(A2)).offer_message === "See you Saturday", a.ok ? "" : a.err);
  const s = await as("service", `UPDATE public.applications SET closed_reason = 'job_cancelled' WHERE id = '${A1}' RETURNING id`);
  check("L6 the service role still writes server columns", s.ok && s.rows.length === 1, s.ok ? "" : s.err);
}

// ── a decline reason rides with the decline only (A3 is rejected by L3) ───
await refused("R12 the poster cannot rewrite a decline reason after the decline", POSTER, A3, `decline_reason = 'Changed my mind about why'`);
await refused("R13 the poster cannot attach a decline reason without declining", POSTER, A1, `decline_reason = 'pre-emptive'`);

// ── the class check ───────────────────────────────────────────────────────
{
  const rows = (await db.query(CHECK.replace(/;\s*$/, ""))).rows.filter((r) => r.table === "applications" && /UPDATE/.test(r.what));
  check("C1 scripts/ci/client-insert-columns.sql is clean for applications UPDATE", rows.length === 0, rows.map((r) => `${r.role}: ${r.what}`).join("; ") || "0 rows");
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
