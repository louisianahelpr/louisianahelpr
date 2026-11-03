/**
 * Q1424 PGlite proof: guarantee_sweep's deadlines (Helpr Guarantee), on a fixed clock (./lib/fixedClock.mjs, newest
 * CREATE of the sweep and of guarantee_rules). helprGuarantee.pglite.mjs moves the stored deadlines; this one moves
 * the clock and reads each edge 1 ms either side. Every deadline here is strict (< now): AT the deadline the party
 * still has time, 1 ms later the sweep acts.
 *   awaiting_helpr  helpr_answer_by < now: escalated (helpr_no_answer)
 *   fix_scheduled   (Louisiana midnight ending fix_date) + fix_grace_hours (24) < now: escalated (fix_not_done),
 *                   in CDT and across the fall-back Sunday
 *   fixed           poster_answer_by < now: closed as poster_silent, both told
 *
 *   node src/test/pglite/guaranteeSweepClock.pglite.mjs
 *   GUARANTEE_HELPR_INCLUSIVE=1 ...  # RED: the Helpr's deadline made inclusive (both reads)
 *   GUARANTEE_FIX_UTC=1 ...          # RED: the fix day's midnight read in UTC (both reads)
 *   GUARANTEE_POSTER_INCLUSIVE=1 ... # RED: the poster's deadline made inclusive (both reads)
 *
 * guarantee_escalate and guarantee_tell (their own money proofs) are stubbed to record the call. pglite is loaded from
 * ~/.lh-pglite (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE ROLE service_role;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, status text DEFAULT 'completed', payment_status text DEFAULT 'payout_pending');
CREATE TABLE public.job_guarantee_claims (
  id uuid PRIMARY KEY, job_id uuid, status text, helpr_answer_by timestamptz, fix_date date, poster_answer_by timestamptz,
  close_reason text, closed_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT '2026-01-01',
  helper_id uuid DEFAULT gen_random_uuid(), poster_id uuid DEFAULT gen_random_uuid());
CREATE TABLE public.calls (what text);
CREATE FUNCTION public.guarantee_escalate(c uuid, why text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('escalate:' || coalesce(why, '-')) $$;
CREATE FUNCTION public.guarantee_tell(j uuid, u uuid, t text, b text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('tell:' || t) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('defect:' || c) $$;
`);
const rules = newestFunction("guarantee_rules");
const sweepFn = newestFunction("guarantee_sweep");
const base = onFixedClock(sweepFn.stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${sweepFn.file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
let mutated = false;
const swap = (env, from, to) => {
  if (!process.env[env]) return;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is there`, fixed.includes(from));
  fixed = fixed.split(from).join(to);
  mutated = true;
};
swap("GUARANTEE_HELPR_INCLUSIVE", "helpr_answer_by < public._probe_now()", "helpr_answer_by <= public._probe_now()");
swap("GUARANTEE_FIX_UTC", "::timestamp AT TIME ZONE 'America/Chicago')", "::timestamp AT TIME ZONE 'UTC')");
swap("GUARANTEE_POSTER_INCLUSIVE", "poster_answer_by < public._probe_now()", "poster_answer_by <= public._probe_now()");
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) { await db.exec(onFixedClock(rules.stmt)); await db.exec(fixed); }

const JOB = "17171717-1717-4717-8717-171717171717";
const CLAIM = "18181818-1818-4818-8818-181818181818";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const seed = async (cols) => {
  await db.exec(`DELETE FROM public.calls; DELETE FROM public.job_guarantee_claims; DELETE FROM public.jobs;`);
  await q(`INSERT INTO public.jobs (id) VALUES ($1)`, [JOB]);
  await q(`INSERT INTO public.job_guarantee_claims (id, job_id, status, helpr_answer_by, fix_date, poster_answer_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [CLAIM, JOB, cols.status, iso(cols.helprBy ?? null), cols.fixDate ?? null, iso(cols.posterBy ?? null)]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.guarantee_sweep() AS r`))[0].r;
  const calls = (await q(`SELECT what FROM public.calls`)).map((c) => c.what);
  const [{ status, close_reason }] = await q(`SELECT status, close_reason FROM public.job_guarantee_claims`);
  return { r, calls, status, close_reason };
};
const edge = async (name, cols, deadline, ok) => {
  await seed(cols);
  const at = await sweep(deadline);
  check(`${name}: exactly at the deadline: still waiting`, at.calls.length === 0 && at.status === cols.status, JSON.stringify(at));
  await seed(cols);
  const after = await sweep(deadline + 1);
  check(`${name}: 1 ms after: acted`, ok(after) && after.r.failed === 0, JSON.stringify(after));
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0);
await edge("the Helpr never answered", { status: "awaiting_helpr", helprBy: N }, N, (a) => a.calls[0] === "escalate:helpr_no_answer");
// Fix on Wed 15 July: the day ends at 05:00Z Thu 16 July (CDT); + 24 h = 05:00Z Fri 17 July.
await edge("the fix date passed (CDT)", { status: "fix_scheduled", fixDate: "2026-07-15" }, Date.UTC(2026, 6, 17, 5, 0, 0), (a) => a.calls[0] === "escalate:fix_not_done");
// Fix on Sun 1 Nov (fall-back day): the day ends at 06:00Z Mon 2 Nov (CST); + 24 h = 06:00Z Tue 3 Nov.
await edge("the fix date passed (the fall-back Sunday)", { status: "fix_scheduled", fixDate: "2026-11-01" }, Date.UTC(2026, 10, 3, 6, 0, 0), (a) => a.calls[0] === "escalate:fix_not_done");
await edge("the poster never answered after \"fixed\"", { status: "fixed", posterBy: N }, N,
  (a) => a.status === "closed" && a.close_reason === "poster_silent" && a.calls.filter((c) => c.startsWith("tell:")).length === 2);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
