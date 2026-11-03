/**
 * Q1424 PGlite proof: detect_stuck_payments' clock windows, on a fixed clock (./lib/fixedClock.mjs, newest CREATE of
 * the function). stuckPaymentNeedsStripeProof / moneySweepsFoundVsDone move row timestamps relative to now(); this one
 * moves the clock and reads each edge 1 ms either side. All its edges are strict:
 *   the window       created_at < now - 10 min AND created_at > now - 24 h: a checkout exactly 10 min old or exactly
 *                    24 h old is not looked at; 10 min + 1 ms and 24 h - 1 ms are
 *   cancel grace     a cancelled job is looked at only once cancelled_at <= now - 2 h (exactly 2 h: looked at)
 *   Stripe's answer  a "not paid" answer counts while checked_at > now - 45 min (exactly 45 min old: stale, awaiting)
 *   unanswered       filed per job once the last update is older than 40 min (exactly 40 min: not yet)
 *   paid, unsettled  a real job Stripe says was paid: the admins told and a paging error row, once
 *
 *   node src/test/pglite/detectStuckPaymentsClock.pglite.mjs
 *   STUCK_WINDOW_INCLUSIVE=1 ...  # RED: the 10-minute edge made inclusive
 *   STUCK_ANSWER_INCLUSIVE=1 ...  # RED: the 45-minute freshness edge made inclusive
 *
 * log_cron_defect is stubbed to record the filing. pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
 * src/test/clockFunctionsProven.test.ts.
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
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text DEFAULT 'Move a couch', customer_id uuid DEFAULT gen_random_uuid(), stripe_session_id text DEFAULT 'cs_test_1',
  created_at timestamptz, updated_at timestamptz, is_seed boolean DEFAULT false, payment_status text DEFAULT 'unpaid',
  status text DEFAULT 'open', cancelled_at timestamptz);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean, full_name text, email text);
CREATE TABLE public.test_accounts (user_id uuid);
CREATE TABLE public.stuck_payment_stripe_checks (
  job_id uuid, stripe_session_id text, money_moved boolean, session_status text, payment_status text, payment_intent_id text, checked_at timestamptz);
CREATE TABLE public.error_logs (severity text, message text, url text, tags jsonb, context jsonb, created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text, read boolean);
CREATE TABLE public.user_roles (user_id uuid, role text);
INSERT INTO public.user_roles VALUES ('21212121-2121-4121-8121-212121212121', 'admin');
CREATE TABLE public.defects (source text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.defects VALUES (a) $$;
`);
const { file, stmt } = newestFunction("detect_stuck_payments");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
let mutated = false;
const swap = (env, from, to) => {
  if (!process.env[env]) return;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is there`, fixed.includes(from));
  fixed = fixed.replace(from, to);
  mutated = true;
};
swap("STUCK_WINDOW_INCLUSIVE", "AND j.created_at < public._probe_now() - INTERVAL '10 minutes'", "AND j.created_at <= public._probe_now() - INTERVAL '10 minutes'");
swap("STUCK_ANSWER_INCLUSIVE", "rec.checked_at > public._probe_now() - INTERVAL '45 minutes'", "rec.checked_at >= public._probe_now() - INTERVAL '45 minutes'");
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) await db.exec(fixed);

const JOB = "22222222-3333-4333-8333-222222222222";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const MIN = 60_000;
const H = 60 * MIN;
const seed = async ({ createdAt, updatedAt = null, status = "open", cancelledAt = null, check: c = null }) => {
  await db.exec(`DELETE FROM public.defects; DELETE FROM public.error_logs; DELETE FROM public.notifications; DELETE FROM public.stuck_payment_stripe_checks; DELETE FROM public.jobs;`);
  await q(`INSERT INTO public.jobs (id, created_at, updated_at, status, cancelled_at) VALUES ($1, $2, $3, $4, $5)`, [JOB, iso(createdAt), iso(updatedAt ?? createdAt), status, iso(cancelledAt)]);
  if (c) await q(`INSERT INTO public.stuck_payment_stripe_checks VALUES ($1, 'cs_test_1', $2, $3, $4, 'pi_1', $5)`, [JOB, c.moved, c.session ?? "complete", c.paid ?? "paid", iso(c.at)]);
};
const run = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.detect_stuck_payments() AS r`))[0].r;
  const defects = (await q(`SELECT count(*)::int c FROM public.defects`))[0].c;
  const notes = (await q(`SELECT count(*)::int c FROM public.notifications`))[0].c;
  return { found: r.found, alerted: r.alerted, not_paid: r.not_paid, awaiting: r.awaiting_stripe, failed: r.failed, defects, notes };
};
const N = Date.UTC(2026, 6, 15, 20, 0, 0);
const cases = [
  ["checkout exactly 10 min old: not looked at", { createdAt: N - 10 * MIN }, (r) => r.found === 0],
  ["checkout 10 min + 1 ms old: looked at", { createdAt: N - 10 * MIN - 1 }, (r) => r.found === 1],
  ["checkout exactly 24 h old: past the window", { createdAt: N - 24 * H }, (r) => r.found === 0],
  ["checkout 24 h - 1 ms old: still in the window", { createdAt: N - 24 * H + 1 }, (r) => r.found === 1],
  ["cancelled 2 h - 1 ms ago: left to void-cancelled-payments", { createdAt: N - 3 * H, status: "cancelled", cancelledAt: N - 2 * H + 1 }, (r) => r.found === 0],
  ["cancelled exactly 2 h ago: looked at", { createdAt: N - 3 * H, status: "cancelled", cancelledAt: N - 2 * H }, (r) => r.found === 1],
  ["Stripe said not paid 45 min - 1 ms ago: counts as not paid", { createdAt: N - 3 * H, check: { moved: false, session: "open", paid: "unpaid", at: N - 45 * MIN + 1 } }, (r) => r.not_paid === 1 && r.awaiting === 0],
  ["Stripe said not paid exactly 45 min ago: stale, awaiting a new answer and filed", { createdAt: N - 3 * H, check: { moved: false, session: "open", paid: "unpaid", at: N - 45 * MIN } }, (r) => r.not_paid === 0 && r.awaiting === 1 && r.defects === 1],
  ["no answer, last update exactly 40 min ago: awaiting, not filed yet", { createdAt: N - 3 * H, updatedAt: N - 40 * MIN }, (r) => r.awaiting === 1 && r.defects === 0],
  ["no answer, last update 40 min + 1 ms ago: filed", { createdAt: N - 3 * H, updatedAt: N - 40 * MIN - 1 }, (r) => r.awaiting === 1 && r.defects === 1],
  ["Stripe says paid, never settled: admins told, once", { createdAt: N - 30 * MIN, check: { moved: true, at: N - 5 * MIN } }, (r) => r.alerted === 1 && r.notes === 1 && r.failed === 0],
];
for (const [name, cols, ok] of cases) {
  await seed(cols);
  const r = await run(N);
  check(name, ok(r), JSON.stringify(r));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
