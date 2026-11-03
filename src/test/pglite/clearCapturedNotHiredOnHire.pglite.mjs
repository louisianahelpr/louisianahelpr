#!/usr/bin/env node
/**
 * Q2447 (PGlite proof for 20261103110232_clear_captured_not_hired_on_hire): a 'captured_not_hired' mark on a
 * job's card hold (the card charged by our own capture-then-refused-hire race) is cleared the moment a hire
 * completes on the job, so a Helpr hired and later removed is an ordinary cancel (card fee kept) and never the
 * own-mistake full refund.
 *   (a) jobs.helper_confirmed_at NULL -> a time clears the mark;
 *   (b) a crew seat confirmed (UPDATE) clears it;  (c) a crew seat INSERTed confirmed clears it;
 *   (d) another failure_code is left alone;  (e) an update that does not set helper_confirmed_at keeps the mark;
 *   (f) helper_confirmed_at moving from one time to another (already hired) does not fire;
 *   (g) anon/authenticated cannot execute the trigger function; the file replays 3x.
 *
 *   node src/test/pglite/clearCapturedNotHiredOnHire.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/clearCapturedNotHiredOnHire.pglite.mjs  # RED: the mark survives the hire
 *
 * Stubbed, said so: the tables reduced to the columns read. pglite is loaded from ~/.lh-pglite (not a dependency).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261103110232_clear_captured_not_hired_on_hire.sql", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, helper_confirmed_at timestamptz);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, helper_confirmed_at timestamptz);
CREATE TABLE public.job_card_holds (job_id uuid PRIMARY KEY, state text, failure_code text, failure_message text, updated_at timestamptz);
`);
if (!skip) { const sql = readFileSync(MIG, "utf8"); for (let k = 1; k <= 3; k++) await db.exec(sql); }

const q = async (s, p = []) => (await db.query(s, p)).rows;
async function jobWithMark(code = "captured_not_hired", confirmed = null) {
  const [{ id }] = await q(`INSERT INTO public.jobs (title, helper_confirmed_at) VALUES ('t', $1) RETURNING id`, [confirmed]);
  await q(`INSERT INTO public.job_card_holds VALUES ($1, 'captured', $2, 'why', now() - interval '1 hour')`, [id, code]);
  return id;
}
const mark = async (id) => (await q(`SELECT failure_code FROM public.job_card_holds WHERE job_id = $1`, [id]))[0]?.failure_code ?? null;

const a = await jobWithMark();
await q(`UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = $1`, [a]);
check(await mark(a) === null, "(a) a hire on the job clears the captured_not_hired mark", await mark(a));

const b = await jobWithMark();
await q(`INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ($1, gen_random_uuid())`, [b]);
check(await mark(b) === "captured_not_hired", "(b0) an unconfirmed crew seat keeps the mark", await mark(b));
await q(`UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE job_id = $1`, [b]);
check(await mark(b) === null, "(b) a crew seat confirmed clears the mark", await mark(b));

const c = await jobWithMark();
await q(`INSERT INTO public.group_job_helpers (job_id, helper_id, helper_confirmed_at) VALUES ($1, gen_random_uuid(), now())`, [c]);
check(await mark(c) === null, "(c) a crew seat inserted confirmed clears the mark", await mark(c));

const d = await jobWithMark("capture_refused_card_declined");
await q(`UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = $1`, [d]);
check(await mark(d) === "capture_refused_card_declined", "(d) another failure_code is left alone", await mark(d));

const e = await jobWithMark();
await q(`UPDATE public.jobs SET title = 'x' WHERE id = $1`, [e]);
check(await mark(e) === "captured_not_hired", "(e) an update that hires nobody keeps the mark", await mark(e));

const f = await jobWithMark("captured_not_hired", new Date(Date.now() - 86_400_000).toISOString());
await q(`UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = $1`, [f]);
check(await mark(f) === "captured_not_hired", "(f) an already-confirmed job moving its time does not fire", await mark(f));

const acl = (await q(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'clear_captured_not_hired_on_hire'`))[0]?.acl ?? "";
check(!skip && acl !== "" && !/(^|[{,])anon=/.test(acl) && !/(^|[{,])authenticated=/.test(acl) && !/(^|[{,])=X/.test(acl),
  "(g) PUBLIC, anon and authenticated cannot execute the trigger function", acl);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
