#!/usr/bin/env node
/**
 * PGlite proof for 20261012072223_stuck_payment_close_needs_money_moved
 * (docs/OPEN.md Q1594): the stuck-payment ledger item's close question asks
 * what the alert asks, Stripe's word that the CURRENT checkout took the money.
 *
 *   node src/test/pglite/stuckPaymentCloseNeedsMoneyMoved.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/stuckPaymentCloseNeedsMoneyMoved.pglite.mjs   # RED: the old body
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * THE BEFORE STATE: ops_alert_condition is 20260926040011's body (the newest
 * definition before this one); stuck_payment_stripe_checks is
 * 20261009223355's table, verbatim. The migration is then applied VERBATIM,
 * three times.
 *
 * Proves, on the new body (detect_stuck_payments branch):
 *   1. A real poster's checkout Stripe has FRESHLY answered as not paid
 *      (open/unpaid, or expired) no longer keeps the item open: false.
 *      RED (NEW_MIGRATION=skip): the old body answers true.
 *   2. A real job whose CURRENT session Stripe says took the money: true.
 *   3. Fail-closed: no answer, a stale (>45 min) answer, or an answer about
 *      an older (re-minted) session is the detector's awaiting_stripe, filed
 *      under this same source: still failing (a dead checker never closes it).
 *   4. A seed job with money moved does not count: false.
 *   5. probe_only still answers true; the other branches still answer
 *      (push-tokens-empty restated verbatim).
 *   6. anon/authenticated cannot execute ops_alert_condition.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const fnFrom = (sql, name) => {
  const i = sql.indexOf(`FUNCTION public.${name}(`);
  const start = sql.lastIndexOf("CREATE", i);
  const tag = /AS (\$[a-z_]*\$)/.exec(sql.slice(i))[1];
  const open = sql.indexOf(tag, i) + tag.length;
  return sql.slice(start, sql.indexOf(tag, open) + tag.length) + ";";
};
const tableFrom = (sql, name) => {
  const i = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${name}`);
  return sql.slice(i, sql.indexOf("\n);", i) + 3);
};
const THIS = "20261012072223_stuck_payment_close_needs_money_moved.sql";
const OLD = fnFrom(read("20260926040011_ops_alert_pending_watchdog.sql"), "ops_alert_condition");
const TABLE = tableFrom(read("20261009223355_stuck_payment_needs_stripe_proof.sql"), "stuck_payment_stripe_checks");

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
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, payment_status text, status text,
  cancelled_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now(), is_seed boolean, customer_id uuid);
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL);
${TABLE}
${OLD}
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running on the OLD body (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(read(THIS));
      check(`apply ${THIS.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${THIS.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

const cond = async () =>
  (await q(`SELECT public.ops_alert_condition('detect_stuck_payments', '{}'::jsonb, now() - interval '1 hour') AS v`))[0].v;
const realPoster = "11111111-1111-1111-1111-111111111111";
const seedPoster = "22222222-2222-2222-2222-222222222222";
await q(`INSERT INTO public.profiles VALUES ($1, false), ($2, true)`, [realPoster, seedPoster]);

// 1. A real checkout: no answer yet, then fresh not-paid answers.
const [{ id: unpaid }] = await q(
  `INSERT INTO public.jobs (stripe_session_id, payment_status, status, created_at, customer_id)
   VALUES ('cs_open', 'unpaid', 'open', now() - interval '30 minutes', $1) RETURNING id`, [realPoster]);
check("3a. no Stripe answer yet (dead checker): still failing", (await cond()) === true, `got ${await cond()}`);
await q(`INSERT INTO public.stuck_payment_stripe_checks (job_id, stripe_session_id, session_status, payment_status, money_moved)
         VALUES ($1, 'cs_open', 'open', 'unpaid', false)`, [unpaid]);
check("1a. Stripe freshly says open/unpaid: not failing", (await cond()) === false, `got ${await cond()}`);
await q(`UPDATE public.stuck_payment_stripe_checks SET checked_at = now() - interval '50 minutes' WHERE job_id=$1`, [unpaid]);
check("3b. open/unpaid answer older than 45 min: still failing", (await cond()) === true, `got ${await cond()}`);
await q(`UPDATE public.stuck_payment_stripe_checks SET session_status='expired' WHERE job_id=$1`, [unpaid]);
check("1b. Stripe says the session expired (any age): not failing", (await cond()) === false, `got ${await cond()}`);

// 2. Stripe says the current session took the money.
await q(`UPDATE public.stuck_payment_stripe_checks SET session_status='complete', payment_status='paid', money_moved=true, checked_at=now() WHERE job_id=$1`, [unpaid]);
check("2. Stripe says paid on the current session: still failing", (await cond()) === true, `got ${await cond()}`);

// 3c. The checkout was re-minted after a fresh not-paid answer on the old one.
await q(`UPDATE public.stuck_payment_stripe_checks SET session_status='open', payment_status='unpaid', money_moved=false WHERE job_id=$1`, [unpaid]);
await q(`UPDATE public.jobs SET stripe_session_id='cs_new' WHERE id=$1`, [unpaid]);
check("3c. a not-paid answer about an older session is not trusted: still failing", (await cond()) === true, `got ${await cond()}`);
await q(`DELETE FROM public.jobs`);

// 4. A seed poster's paid checkout never counts.
const [{ id: seedJob }] = await q(
  `INSERT INTO public.jobs (stripe_session_id, payment_status, status, created_at, customer_id)
   VALUES ('cs_seed', 'unpaid', 'open', now() - interval '30 minutes', $1) RETURNING id`, [seedPoster]);
await q(`INSERT INTO public.stuck_payment_stripe_checks (job_id, stripe_session_id, session_status, payment_status, money_moved)
         VALUES ($1, 'cs_seed', 'complete', 'paid', true)`, [seedJob]);
check("4. seed poster's paid checkout: not failing", (await cond()) === false, `got ${await cond()}`);

// 5. probe_only and a sibling branch.
const probe = (await q(`SELECT public.ops_alert_condition('detect_stuck_payments', '{}'::jsonb, now(), true) AS v`))[0].v;
check("5a. probe_only answers true", probe === true);
const push = (await q(`SELECT public.ops_alert_condition('push-tokens-empty', '{}'::jsonb, now()) AS v`))[0].v;
check("5b. push-tokens-empty still answers (no tokens = failing)", push === true, `got ${push}`);

// 6. Grants.
const acl = (await q(`SELECT proacl::text AS a FROM pg_proc WHERE proname='ops_alert_condition'`))[0].a ?? "";
check("6. anon/authenticated cannot execute", !/(^|[{,])(anon|authenticated)=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
