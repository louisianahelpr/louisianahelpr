#!/usr/bin/env node
/**
 * PGlite proof for 20261019070737_payout_waits_for_payee_setup (/code-review of
 * f6551863a: payouts wait for the payee's Stripe setup without starving the
 * queue or going silent; closes Q2197 for Shops).
 *
 *   node src/test/pglite/payoutWaitsForPayee.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/payoutWaitsForPayee.pglite.mjs   # RED: the old queues
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/payoutWaitsForPayee.pglite.mjs
 *
 * Stubs carry exactly the columns these functions and the three queues read
 * (prod shapes from 20261015042253, 20261017055505, 20261018164442,
 * 20261018211820, 20261004162921); the three queues are loaded from their
 * newest definitions (this migration leaves them unchanged), then this migration
 * is applied 3x. Section 1 shows the starvation itself on the queues and that a
 * deferred row leaves the front of the batch.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261019070737_payout_waits_for_payee_setup.sql";
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${THIS}`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( before this migration, any dollar tag. */
function newestBefore(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = `${sql.slice(m.index, end + t[1].length)};`;
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false,
  stripe_charges_enabled boolean DEFAULT false, stripe_identity_verified boolean DEFAULT false, ban_status text DEFAULT 'active',
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text NOT NULL);
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $f$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.notifications (user_id, title, message, link) VALUES (p_user, p_title, p_body, p_link) $f$;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, stripe_payment_intent_id text, stripe_checkout_session_id text,
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.declutter_problems (order_id uuid, status text);
CREATE FUNCTION public.declutter_order_refunds_recorded_cents(uuid) RETURNS integer LANGUAGE sql AS $f$ SELECT 0 $f$;
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, seller_id uuid, amount_cents integer,
  status text CONSTRAINT declutter_payouts_status_check CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due')),
  attempts integer DEFAULT 0, next_attempt_at timestamptz DEFAULT now(),
  stripe_transfer_id text UNIQUE CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id ~ '^tr_'), executed_at timestamptz,
  CONSTRAINT declutter_payouts_transfer CHECK (status <> 'succeeded' OR stripe_transfer_id IS NOT NULL));
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_kind text, source_id uuid, customer_id uuid, pickup_contact_id uuid);
CREATE FUNCTION public.helpr_task_source_held(text, uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, helpr_id uuid, amount_cents integer,
  status text, attempts integer DEFAULT 0, next_attempt_at timestamptz DEFAULT now(), stripe_transfer_id text UNIQUE, executed_at timestamptz);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text,
  stripe_payment_intent_id text, payment_livemode boolean, stripe_checkout_session_id text, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_handovers (order_id uuid, problem_at timestamptz, confirmed_how text);
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, amount_cents integer,
  status text, attempts integer DEFAULT 0, next_attempt_at timestamptz DEFAULT now(), stripe_transfer_id text UNIQUE, executed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reason text, stripe_payment_intent_id text,
  refund_cents integer, status text DEFAULT 'pending', attempts integer DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  payment_livemode boolean, created_at timestamptz NOT NULL DEFAULT now(), stripe_refund_ref text UNIQUE, executed_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false, gave_up_notified_at timestamptz);
CREATE TABLE public.declutter_delivery_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text DEFAULT 'pending',
  attempts integer DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), stripe_payment_intent_id text, refund_cents integer DEFAULT 100,
  stripe_refund_ref text, executed_at timestamptz, last_error text, is_seed boolean NOT NULL DEFAULT false);
`);
await db.exec(`CREATE TABLE public.declutter_hand_refunds (stripe_refund_id text PRIMARY KEY, stripe_payment_intent_id text NOT NULL,
  order_id uuid, refund_row_id uuid, amount_cents integer NOT NULL, livemode boolean NOT NULL,
  hand_outcome text NOT NULL CHECK (hand_outcome IN ('settled', 'recorded')), failed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.declutter_refunds ADD COLUMN last_error text;`);
for (const fn of ["declutter_payouts_due", "helpr_task_payouts_due", "shop_payouts_due", "declutter_refunds_due", "declutter_record_hand_refund",
  "declutter_refund_gave_up_check", "declutter_refund_executed", "declutter_delivery_refund_executed"]) await db.exec(newestBefore(fn));
// (These queues are unchanged by this migration; loaded so section 1 measures them.)

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
// The newest shape of the delivery payout row (setup_fee_cents and its amount CHECK: whole dollars, less any setup fee),
// so these queues run on what prod will hold.
await db.exec(`ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS pay_cents integer, ADD COLUMN IF NOT EXISTS fee_cents integer;`);
await db.exec(readFileSync(`${MIG_DIR}20261021181118_helpr_delivery_payout_round_down.sql`, "utf8").match(/CREATE OR REPLACE FUNCTION public\.helpr_payout_round_down_cents[\s\S]*?\$(\w*)\$[\s\S]*?\$\1\$\s*;/)[0]);
await db.exec(readFileSync(`${MIG_DIR}20261031014752_helpr_setup_fee_from_payout.sql`, "utf8"));

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const q = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; }
};
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// 30 waiting sellers (no account, or setup unfinished) with the OLDEST dates, then one ready seller.
const READY = U(900), READY_SHOP = U(901), READY_HELPR = U(902);
await db.exec(`INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled) VALUES
  ('${READY}', 'acct_ready', true), ('${READY_SHOP}', 'acct_rshop', true), ('${READY_HELPR}', 'acct_rhelpr', true);`);
for (let i = 1; i <= 30; i++) {
  await db.exec(`INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled)
    VALUES ('${U(i)}', ${i % 2 ? "NULL" : `'acct_wait${i}'`}, false);
  INSERT INTO public.declutter_orders (id, buyer_id, stripe_payment_intent_id) VALUES ('${U(100 + i)}', '${U(999)}', 'pi_${i}');
  INSERT INTO public.declutter_payouts (id, order_id, seller_id, amount_cents, status, next_attempt_at)
    VALUES ('${U(200 + i)}', '${U(100 + i)}', '${U(i)}', 1000, 'pending', now() - interval '${100 - i} days');`);
}
await db.exec(`INSERT INTO public.declutter_orders (id, buyer_id, stripe_payment_intent_id) VALUES ('${U(500)}', '${U(999)}', 'pi_ready');
  INSERT INTO public.declutter_payouts (id, order_id, seller_id, amount_cents, status, next_attempt_at)
    VALUES ('${U(600)}', '${U(500)}', '${READY}', 2500, 'pending', now() - interval '1 minute');
  INSERT INTO public.shop_orders (id, buyer_id, seller_id, status) VALUES ('${U(510)}', '${U(999)}', '${READY_SHOP}', 'handed_over'),
    ('${U(511)}', '${U(999)}', '${U(2)}', 'handed_over');
  INSERT INTO public.shop_payouts (id, order_id, amount_cents, status, next_attempt_at) VALUES
    ('${U(610)}', '${U(510)}', 1800, 'pending', now() - interval '1 minute'), ('${U(611)}', '${U(511)}', 1800, 'pending', now() - interval '99 days');
  INSERT INTO public.helpr_tasks (id, source_kind, source_id) VALUES ('${U(520)}', 'declutter_delivery', '${U(500)}'), ('${U(521)}', 'declutter_delivery', '${U(500)}');
  INSERT INTO public.helpr_task_payouts (id, task_id, helpr_id, pay_cents, fee_cents, amount_cents, status, next_attempt_at) VALUES
    ('${U(620)}', '${U(520)}', '${READY_HELPR}', 1800, 200, 1600, 'pending', now() - interval '1 minute'),
    ('${U(621)}', '${U(521)}', '${U(4)}', 1800, 200, 1600, 'pending', now() - interval '99 days');`);

// --- 1. starvation, and the fix: the skipped rows hold the front of a full batch until they are deferred
let due = await q(`SELECT payout_id FROM public.declutter_payouts_due(25)`);
ok(Array.isArray(due) && !due.some((r) => r.payout_id === U(600)), "setup: 30 skipped sellers with older dates fill the batch (the starvation)");
for (let i = 1; i <= 30; i++) await q(`SELECT public.payout_defer('declutter', '${U(200 + i)}', 60)`);
due = await q(`SELECT payout_id FROM public.declutter_payouts_due(25)`);
ok(!skip && Array.isArray(due) && due.length === 1 && due[0].payout_id === U(600), "deferred skips leave the queue: the ready seller is offered");
await q(`SELECT public.payout_defer('shop', '${U(611)}', 60)`);
ok(!skip && (await q(`SELECT payout_id FROM public.shop_payouts_due(1)`))?.[0]?.payout_id === U(610), "the shop queue too (Q2197)");
await q(`SELECT public.payout_defer('helpr_task', '${U(621)}', 60)`);
ok(!skip && (await q(`SELECT payout_id FROM public.helpr_task_payouts_due(1)`))?.[0]?.payout_id === U(620), "and the Helpr queue");
const d = (await q(`SELECT attempts, next_attempt_at > now() + interval '50 minutes' AS later FROM public.declutter_payouts WHERE id = '${U(201)}'`))?.[0];
ok(!skip && d?.attempts === 0 && d.later === true, "a deferred row moves back an hour and keeps every try");
await db.exec(`UPDATE public.shop_payouts SET status = 'succeeded' WHERE id = '${U(610)}'`);
const before = (await q(`SELECT next_attempt_at::text AS t FROM public.shop_payouts WHERE id = '${U(610)}'`))?.[0]?.t;
await q(`SELECT public.payout_defer('shop', '${U(610)}', 60)`);
ok(!skip && (await q(`SELECT next_attempt_at::text AS t FROM public.shop_payouts WHERE id = '${U(610)}'`))?.[0]?.t === before, "a sent payout is never touched");
ok(!skip && (await q(`SELECT public.payout_defer('bogus', '${U(1)}', 60)`))?.error?.includes("invalid_kind"), "an unknown kind is refused");

// --- 2. a sighting: reminder per payee every 3 days (never banned / held), ops once per PAYEE, marked only when paged
const seen = async (kind, id, payee, category = "setup_unfinished") =>
  (await q(`SELECT public.payout_payee_wait_seen('${kind}', '${id}', '${payee}', 1000, '${category}', 'transfers inactive') AS r`))?.[0]?.r;
const lastNote = async (uid) => (await q(`SELECT title FROM public.notifications WHERE user_id = '${uid}' ORDER BY ctid DESC LIMIT 1`))?.[0]?.title;
const notes = async (uid) => Number((await q(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${uid}'`))?.[0]?.n);
const s1 = await seen("declutter", U(202), U(2));
ok(!skip && s1?.reminded === true && s1.page_due === false && await notes(U(2)) === 1, "the first sighting reminds the payee once and does not page");
ok(!skip && (await seen("shop", U(611), U(2)))?.reminded === false && await notes(U(2)) === 1, "another waiting payout of the same payee: no second reminder within 3 days");
await q(`SELECT public.payout_payee_wait_cleared('shop', '${U(611)}')`);
ok(!skip && (await seen("shop", U(611), U(2)))?.reminded === false, "the 3-day throttle is per PAYEE: clearing one payout's wait does not re-remind");
await db.exec(`UPDATE public.payout_payee_reminders SET last_reminded_at = now() - interval '4 days' WHERE payee_id = '${U(2)}'`);
ok(!skip && (await seen("declutter", U(202), U(2)))?.reminded === true, "after 3 days the payee is reminded again");
ok(!skip && await lastNote(U(2)) === "Finish payout setup to get paid", "unfinished setup: 'finish payout setup'");
await seen("declutter", U(214), U(14), "under_review");
ok(!skip && await lastNote(U(14)) === "Stripe is reviewing your payout account", "under Stripe review: 'Stripe is reviewing your account'");
await seen("declutter", U(216), U(16), "rejected");
ok(!skip && await lastNote(U(16)) === "Your payout account needs help", "rejected: contact support");
await seen("declutter", U(218), U(18), "unusable");
ok(!skip && await lastNote(U(18)) === "Set up payouts again to get paid", "unusable: set up payouts again");
await db.exec(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${U(20)}'`);
ok(!skip && (await seen("declutter", U(220), U(20)))?.payee_seed === true && (await seen("declutter", U(222), U(22)))?.payee_seed === false,
  "the answer says whether the payee is a test account (the page routes as seed)");
await db.exec(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${U(6)}'; INSERT INTO public.payout_holds VALUES ('${U(8)}', 'review');`);
ok(!skip && (await seen("declutter", U(206), U(6)))?.reminded === false && await notes(U(6)) === 0, "a banned payee is never reminded");
ok(!skip && (await seen("declutter", U(208), U(8)))?.reminded === false && await notes(U(8)) === 0, "a payee on payout hold is never reminded");
await db.exec(`UPDATE public.payout_payee_waits SET first_waiting_at = now() - interval '8 days' WHERE payout_id = '${U(202)}'`);
ok(!skip && (await seen("declutter", U(202), U(2)))?.page_due === true, "after 7 days waiting, a page is due");
ok(!skip && (await seen("declutter", U(202), U(2)))?.page_due === true, "still due while the Slack post has not gone through (nothing marked yet)");
await q(`SELECT public.payout_payee_paged('declutter', '${U(202)}', 'setup_unfinished')`);
ok(!skip && (await seen("declutter", U(202), U(2)))?.page_due === false, "once marked paged, never again for that payout and reason");
ok(!skip && (await seen("declutter", U(202), U(2), "rejected"))?.page_due === true,
  "the reason turning into one that will not fix itself (setup -> rejected) pages again");
await q(`SELECT public.payout_payee_paged('declutter', '${U(202)}', 'rejected')`);
ok(!skip && (await seen("declutter", U(202), U(2), "rejected"))?.page_due === false, "and only once for it");
await db.exec(`UPDATE public.payout_payee_waits SET first_waiting_at = now() - interval '8 days' WHERE payout_id = '${U(611)}'`);
ok(!skip && (await seen("shop", U(611), U(2)))?.page_due === true, "ONCE per payout: another stuck payout of the same payee is paged on its own");
ok(!skip && (await seen("helpr_task", U(621), U(4), "rejected"))?.page_due === true, "a rejected account is due at once");
ok(!skip && (await seen("declutter", U(224), U(24), "unusable"))?.page_due === true, "an unusable account is due at once");
ok(!skip && (await seen("declutter", U(226), U(26), "under_review"))?.page_due === false, "under review is not paged at once (it waits the 7 days)");
// Every defer reason is bounded.
const del = (await q(`SELECT public.payout_payee_wait_seen('declutter', '${U(228)}', NULL, 1000, 'payee_deleted', 'gone') AS r`))?.[0]?.r;
ok(!skip && del?.page_due === true && del.reminded === false, "a deleted payee (no person) is paged at once and nobody is reminded");
ok(!skip && (await seen("declutter", U(230), U(30), "transient"))?.page_due === false && await notes(U(30)) === 0,
  "a passing failure: no page yet, no payee reminder");
await db.exec(`UPDATE public.payout_payee_waits SET first_waiting_at = now() - interval '25 hours' WHERE payout_id = '${U(230)}'`);
ok(!skip && (await seen("declutter", U(230), U(30), "transient"))?.page_due === true, "24 hours of passing failures pages");
ok(!skip && (await seen("declutter", U(232), U(32), "record_failed"))?.page_due === false, "an unrecorded transfer waits its 24 hours too");
await db.exec(`UPDATE public.payout_payee_waits SET first_waiting_at = now() - interval '25 hours' WHERE payout_id = '${U(234)}'`);
await seen("declutter", U(234), U(34), "held");
await db.exec(`UPDATE public.payout_payee_waits SET first_waiting_at = now() - interval '25 hours' WHERE payout_id = '${U(234)}'`);
ok(!skip && (await seen("declutter", U(234), U(34), "held"))?.page_due === false && await notes(U(34)) === 0, "an admin hold waits 7 days, never reminds");
await db.exec(`UPDATE public.payout_payee_waits SET first_waiting_at = now() - interval '8 days' WHERE payout_id = '${U(234)}'`);
ok(!skip && (await seen("declutter", U(234), U(34), "held"))?.page_due === true, "and pages after 7 days (no defer is unbounded)");
ok(!skip && (await seen("declutter", U(236), U(36), "mixed_parties"))?.page_due === true, "mixed parties pages at once (settle by hand)");
await q(`SELECT public.payout_payee_wait_cleared('declutter', '${U(202)}')`);
await q(`SELECT public.payout_payee_wait_cleared('shop', '${U(611)}')`);
ok(!skip && Number((await q(`SELECT count(*) AS n FROM public.payout_payee_waits WHERE payee_id = '${U(2)}'`))?.[0]?.n) === 0,
  "paid or settled: the waits and their page marker are cleared");
ok(!skip && (await seen("declutter", U(202), U(2)))?.page_due === false, "a wait after the clear starts fresh (7 days again before a page)");
await db.exec(`UPDATE public.payout_payee_waits SET first_waiting_at = now() - interval '8 days' WHERE payout_id = '${U(202)}'`);
ok(!skip && (await seen("declutter", U(202), U(2)))?.page_due === true, "and a later stuck wait of the same payee is paged again");
// prune: a payout that ended any other way loses its wait
await seen("declutter", U(210), U(10));
await db.exec(`UPDATE public.declutter_payouts SET status = 'nothing_due' WHERE id = '${U(210)}'; UPDATE public.declutter_payouts SET attempts = 12 WHERE id = '${U(212)}'`);
await seen("declutter", U(212), U(12));
const pruned = (await q(`SELECT public.payout_payee_waits_prune() AS n`))?.[0]?.n;
ok(!skip && pruned >= 2 && Number((await q(`SELECT count(*) AS n FROM public.payout_payee_waits WHERE payout_id IN ('${U(210)}', '${U(212)}')`))?.[0]?.n) === 0
  && Number((await q(`SELECT count(*) AS n FROM public.payout_payee_waits WHERE payout_id = '${U(202)}'`))?.[0]?.n) === 1,
  "prune drops the waits of payouts that ended (nothing due, gave up) and keeps the live ones");
ok(!skip && (await q(`SELECT public.payout_payee_wait_seen('bogus', '${U(1)}', '${U(1)}', 1, 'no_account', 'x')`))?.error?.includes("invalid_wait"),
  "an unknown payout kind is refused");
ok(!skip && (await q(`SELECT public.payout_payee_wait_seen('declutter', '${U(1)}', '${U(1)}', 1, 'our_key', 'x')`))?.error?.includes("invalid_wait"),
  "only payee categories are waits (our own key failing is never one)");

// --- 2c. send marks: a send started is remembered, so the next run reconciles first
await q(`SELECT public.payout_mark_sending('declutter', '${U(203)}')`);
await q(`SELECT public.payout_mark_sending('declutter', '${U(203)}')`);
const marks = await q(`SELECT public.payout_send_marks_for('declutter', ARRAY['${U(203)}', '${U(204)}']::uuid[]) AS id`);
ok(!skip && Array.isArray(marks) && marks.length === 1 && marks[0].id === U(203), "a marked payout is reported, an unmarked one is not (idempotent mark)");
await db.exec(`UPDATE public.declutter_payouts SET status = 'succeeded', stripe_transfer_id = 'tr_203' WHERE id = '${U(203)}'`);
await q(`SELECT public.payout_payee_waits_prune()`);
ok(!skip && (await q(`SELECT public.payout_send_marks_for('declutter', ARRAY['${U(203)}']::uuid[]) AS id`))?.length === 0, "prune drops the marks of payouts that ended");

// --- 2b. refunds skipped under ban review: deferred, and a deferred PENDING refund leaves the queue
await db.exec(`INSERT INTO public.declutter_refunds (id, order_id, reason, stripe_payment_intent_id, refund_cents, created_at)
  VALUES ('${U(700)}', '${U(101)}', 'buyer_cancelled', 'pi_r', 500, now() - interval '1 hour');
  INSERT INTO public.declutter_delivery_refunds (id, order_id) VALUES ('${U(701)}', '${U(101)}');`);
ok((await q(`SELECT refund_id FROM public.declutter_refunds_due(25)`))?.some((r) => r.refund_id === U(700)), "setup: the pending refund is due");
await q(`SELECT public.payout_defer('declutter_refund', '${U(700)}', 60)`);
ok(!skip && !(await q(`SELECT refund_id FROM public.declutter_refunds_due(25)`)).some((r) => r.refund_id === U(700)),
  "a deferred PENDING refund leaves the refund queue (it used to be picked by created_at alone)");
await q(`SELECT public.payout_defer('delivery_refund', '${U(701)}', 60)`);
ok(!skip && (await q(`SELECT next_attempt_at > now() + interval '50 minutes' AS l FROM public.declutter_delivery_refunds WHERE id = '${U(701)}'`))?.[0]?.l === true,
  "a delivery refund defers too");

// --- 2d. HELD FOR REVIEW: out of every queue; only an admin releases it or marks it settled by hand
const ADMIN = U(990), MEMBER = U(991);
await db.exec(`INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin')`);
const asUser = async (uid, sql) => {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) { return { error: String(e.message ?? e) }; } finally { await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`); }
};
await db.exec(`UPDATE public.declutter_payouts SET next_attempt_at = now() - interval '1 minute' WHERE id = '${U(205)}'`);
await seen("declutter", U(205), U(5), "rejected");
ok(!skip && (await q(`SELECT public.payout_hold_for_review('declutter', '${U(205)}', 'rejected', 'transfers inactive, rejected.fraud') AS r`))?.[0]?.r === true,
  "a won't-fix-itself payout is held for review");
const held = (await q(`SELECT status, review_reason FROM public.declutter_payouts WHERE id = '${U(205)}'`))?.[0];
ok(!skip && held?.status === "held_for_review" && /rejected/.test(held.review_reason ?? ""), "it records why");
ok(!skip && (await q(`SELECT ops_paged_at IS NOT NULL AS p, paged_category FROM public.payout_payee_waits WHERE payout_id = '${U(205)}'`))?.[0]?.paged_category === "rejected",
  "holding it marks the page in the same call");
await db.exec(`UPDATE public.profiles SET stripe_account_id = 'acct_new5', stripe_payouts_enabled = true WHERE user_id = '${U(5)}'`);
ok(!skip && !(await q(`SELECT payout_id FROM public.declutter_payouts_due(100)`)).some((r) => r.payout_id === U(205)),
  "a held row is never offered again, even after the payee is ready");
ok(!skip && (await q(`SELECT public.payout_hold_for_review('declutter', '${U(205)}', 'rejected', 'again') AS r`))?.[0]?.r === false, "holding twice is a no-op");
ok(!skip && /admin_only/.test((await asUser(MEMBER, `SELECT public.admin_payouts_held_for_review()`))?.error ?? ""), "members cannot list held rows");
const list = (await asUser(ADMIN, `SELECT public.admin_payouts_held_for_review() AS l`))?.[0]?.l;
ok(!skip && Array.isArray(list) && list.some((r) => r.id === U(205) && r.kind === "declutter"), "the admin money page lists it");
ok(!skip && /admin_only/.test((await asUser(MEMBER, `SELECT public.admin_payout_release('declutter', '${U(205)}', 'x', false)`))?.error ?? ""), "members cannot release");
ok(!skip && /invalid_note/.test((await asUser(ADMIN, `SELECT public.admin_payout_release('declutter', '${U(205)}', '', false)`))?.error ?? ""), "release needs a note");
ok(!skip && /confirm_no_transfer_required/.test((await asUser(ADMIN, `SELECT public.admin_payout_release('declutter', '${U(205)}', 'payee fixed their account', false)`))?.error ?? ""),
  "Release ALWAYS needs the 'no transfer outside the app' confirmation");
ok(!skip && (await asUser(ADMIN, `SELECT public.admin_payout_release('declutter', '${U(205)}', 'payee fixed their account', true) AS r`))?.[0]?.r?.result === "released"
  && (await q(`SELECT payout_id FROM public.declutter_payouts_due(100)`)).some((r) => r.payout_id === U(205)),
  "Release to automatic: back in the queue");
ok(!skip && Number((await q(`SELECT count(*) AS n FROM public.payout_payee_waits WHERE payout_id = '${U(205)}'`))?.[0]?.n) === 0, "and its wait starts over");
ok(!skip && /not_held_for_review/.test((await asUser(ADMIN, `SELECT public.admin_payout_release('declutter', '${U(205)}', 'again', true)`))?.error ?? ""),
  "only a held row can be released");
// settled by hand: synchronous and terminal; guardrails only
await db.exec(`CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_transfer_id text);
  INSERT INTO public.payout_transfers (stripe_transfer_id) VALUES ('tr_jobs1');`);
await q(`SELECT public.payout_hold_for_review('declutter', '${U(207)}', 'payee_deleted', 'gone')`);
await q(`SELECT public.payout_mark_sending('declutter', '${U(207)}')`);
await q(`SELECT public.payout_payee_waits_prune()`);
ok(!skip && (await q(`SELECT public.payout_send_marks_for('declutter', ARRAY['${U(207)}']::uuid[]) AS id`))?.length === 1,
  "a held row keeps its send mark (a transfer may exist) until it is settled or released");
const settle = (kind, id, ref, cents, note = "settled") =>
  asUser(ADMIN, `SELECT public.admin_payout_settle_by_hand('${kind}', '${id}', '${ref}', ${cents}, '${note}') AS r`);
ok(!skip && /invalid_stripe_ref/.test((await settle("declutter", U(207), "re_wrong", 1000))?.error ?? ""), "a payout is settled with a transfer / payout id, not a refund id");
ok(!skip && /invalid_amount/.test((await settle("declutter", U(207), "tr_x9", 0))?.error ?? ""), "the amount is required");
ok(!skip && /ref_already_used/.test((await settle("declutter", U(207), "tr_203", 1000))?.error ?? ""),
  "a SIBLING row's transfer (another payout already recorded it) is refused");
ok(!skip && /ref_already_used/.test((await settle("declutter", U(207), "tr_jobs1", 1000))?.error ?? ""),
  "a transfer recorded by ANOTHER money flow (job payouts) is refused too (every Stripe-id column is scanned)");
const off = (await settle("declutter", U(207), "other: paid by check #1042", 1000, "payee deleted; mailed a check"))?.[0]?.r;
ok(!skip && off?.result === "settled" && off.status === "settled_by_hand", "a deleted payee paid off Stripe is settled at once with 'other: ...'");
const offRow = (await q(`SELECT status, settled_by_hand_ref, settled_by_hand_cents, stripe_transfer_id FROM public.declutter_payouts WHERE id = '${U(207)}'`))?.[0];
ok(!skip && offRow?.status === "settled_by_hand" && /check #1042/.test(offRow.settled_by_hand_ref ?? "") && offRow.settled_by_hand_cents === 1000 && offRow.stripe_transfer_id === null,
  "terminal right away (no pending state), with what it was settled with");
await db.exec(`UPDATE public.profiles SET stripe_account_id = 'acct_new7', stripe_payouts_enabled = true WHERE user_id = '${U(7)}'`);
ok(!skip && !(await q(`SELECT payout_id FROM public.declutter_payouts_due(100)`)).some((r) => r.payout_id === U(207)),
  "settled by hand, then the payee re-onboards: the queue never offers it (no second transfer)");
await q(`SELECT public.payout_hold_for_review('declutter', '${U(209)}', 'rejected', 'x')`);
const tr = (await settle("declutter", U(209), "tr_byhand1", 1000))?.[0]?.r;
ok(!skip && tr?.status === "succeeded" && (await q(`SELECT stripe_transfer_id FROM public.declutter_payouts WHERE id = '${U(209)}'`))?.[0]?.stripe_transfer_id === "tr_byhand1",
  "a tr_ on a payout makes it 'succeeded' with that transfer id");
await q(`SELECT public.payout_hold_for_review('declutter', '${U(211)}', 'needs_reconcile', 'may exist')`);
ok(!skip && /ref_already_used/.test((await settle("declutter", U(211), "tr_byhand1", 1000))?.error ?? ""), "one Stripe id settles ONE row");
ok(!skip && Number((await q(`SELECT count(*) AS n FROM public.admin_audit_log WHERE action IN ('admin_payout_release', 'admin_payout_settle_by_hand')`))?.[0]?.n) >= 3,
  "the admin actions are audited");
// a Declutter refund: a Dashboard refund recorded with no row for THIS payment is adopted
await db.exec(`UPDATE public.declutter_refunds SET stripe_payment_intent_id = 'pi_r700' WHERE id = '${U(700)}';
  INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, refund_row_id, amount_cents, livemode, hand_outcome)
  VALUES ('re_dash1', 'pi_r700', NULL, 500, false, 'recorded'), ('re_otherpi', 'pi_elsewhere', NULL, 500, false, 'recorded');`);
await q(`SELECT public.payout_hold_for_review('declutter_refund', '${U(700)}', 'data_defect', 'no order')`);
ok(!skip && (await q(`SELECT status FROM public.declutter_refunds WHERE id = '${U(700)}'`))?.[0]?.status === "held_for_review"
  && !(await q(`SELECT refund_id FROM public.declutter_refunds_due(25)`)).some((r) => r.refund_id === U(700)), "a refund is held for review the same way");
const otherPi = await settle("declutter_refund", U(700), "re_otherpi", 500);
ok(!skip && /ref_already_used/.test(otherPi?.error ?? ""),
  "a ledger refund on ANOTHER payment is refused");
const adopt = (await settle("declutter_refund", U(700), "re_dash1", 500, "refunded in the Dashboard"))?.[0]?.r;
ok(!skip && adopt?.adopted_hand_refund === true
  && (await q(`SELECT refund_row_id, hand_outcome FROM public.declutter_hand_refunds WHERE stripe_refund_id = 're_dash1'`))?.[0]?.refund_row_id === U(700)
  && (await q(`SELECT status, stripe_refund_ref FROM public.declutter_refunds WHERE id = '${U(700)}'`))?.[0]?.stripe_refund_ref === "re_dash1",
  "a Dashboard refund the ledger recorded with no row, on THIS row's payment, is ADOPTED (linked), and the row settles with it");

// a refund reaches 'succeeded' only for the whole amount owed (lead /code-review of 12dc563c8)
await db.exec(`INSERT INTO public.declutter_refunds (id, order_id, reason, stripe_payment_intent_id, refund_cents, status, created_at)
  VALUES ('${U(706)}', '${U(106)}', 'buyer_cancelled', 'pi_r706', 1200, 'held_for_review', now() - interval '1 hour');
  INSERT INTO public.declutter_delivery_refunds (id, order_id, status, refund_cents) VALUES ('${U(705)}', '${U(105)}', 'held_for_review', 900);`);
ok(!skip && /settle_amount_short/.test((await settle("declutter_refund", U(706), "re_part706", 1000))?.error ?? "")
  && /settle_amount_short/.test((await settle("delivery_refund", U(705), "pyr_part705", 500))?.error ?? "")
  && (await q(`SELECT status FROM public.declutter_refunds WHERE id = '${U(706)}'`))?.[0]?.status === "held_for_review"
  && (await q(`SELECT status FROM public.declutter_delivery_refunds WHERE id = '${U(705)}'`))?.[0]?.status === "held_for_review"
  && Number((await q(`SELECT count(*) AS n FROM public.payout_settlements WHERE row_id IN ('${U(705)}', '${U(706)}')`))?.[0]?.n) === 0,
  "a SHORT Stripe refund (re_ or pyr_) is refused (settle_amount_short) and the row stays held, nothing recorded");
const fullRe = (await settle("declutter_refund", U(706), "re_full706", 1200))?.[0]?.r;
const fullPyr = (await settle("delivery_refund", U(705), "pyr_full705", 900))?.[0]?.r;
ok(!skip && fullRe?.status === "succeeded" && fullPyr?.status === "succeeded"
  && (await q(`SELECT stripe_refund_ref FROM public.declutter_delivery_refunds WHERE id = '${U(705)}'`))?.[0]?.stripe_refund_ref === "pyr_full705",
  "the FULL amount is accepted: re_ and pyr_ both end 'succeeded' with that id");

// held rows: the admin decision is never overwritten, and they never go quiet
await db.exec(`UPDATE public.declutter_refunds SET status = 'held_for_review' WHERE id = '${U(700)}'`);
await db.exec(`INSERT INTO public.declutter_refunds (id, order_id, reason, stripe_payment_intent_id, refund_cents, status, created_at)
  VALUES ('${U(702)}', '${U(102)}', 'buyer_cancelled', 'pi_r702', 500, 'held_for_review', now() - interval '1 hour');
  INSERT INTO public.declutter_delivery_refunds (id, order_id, status) VALUES ('${U(703)}', '${U(103)}', 'held_for_review');`);
ok(!skip && (await q(`SELECT public.declutter_refund_executed('${U(702)}', 're_late1', true) AS r`))?.[0]?.r === "held_for_review"
  && (await q(`SELECT stripe_refund_ref FROM public.declutter_refunds WHERE id = '${U(702)}'`))?.[0]?.stripe_refund_ref === null,
  "a webhook redelivery cannot overwrite a refund an admin holds (declutter_refund_executed writes only pending / failed)");
ok(!skip && (await q(`SELECT public.declutter_delivery_refund_executed('${U(703)}', 're_late2', true, NULL) AS r`))?.[0]?.r === "held_for_review",
  "nor a delivery refund");
await db.exec(`INSERT INTO public.declutter_refunds (id, order_id, reason, stripe_payment_intent_id, refund_cents, status, created_at)
  VALUES ('${U(704)}', '${U(104)}', 'delivery_damage', 'pi_r704', 500, 'pending', now() - interval '1 hour');
  UPDATE public.declutter_payouts SET status = 'settled_by_hand' WHERE order_id = '${U(104)}';`);
ok(!skip && (await q(`SELECT refund_id FROM public.declutter_refunds_due(100)`)).some((r) => r.refund_id === U(704)),
  "a delivery_damage refund is not blocked forever once the seller payout was settled by hand");
await db.exec(`CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb,
  context jsonb, created_at timestamptz NOT NULL DEFAULT now())`);
const heldRaw = await q(`SELECT public.payout_held_check() AS n`);
const heldN = Number(heldRaw?.[0]?.n);
const told = await notes(U(5));
ok(!skip && heldN > 0, "payout_held_check finds the held rows (re-raised daily into the ops ledger)");
await q(`SELECT public.payout_held_check()`);
ok(!skip && await notes(U(5)) === told, "the person owed is told ONCE that it needs a quick review");
const ledgerRows = Number((await q(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'payout-held-for-review'`))?.[0]?.n);
ok(!skip && ledgerRows === heldN, "one ops-ledger row per held row per day (a second run the same day adds none)");

// the Helpr row shows its REAL transfer group
await db.exec(`UPDATE public.helpr_task_payouts SET status = 'pending' WHERE id = '${U(621)}'`);
await q(`SELECT public.payout_hold_for_review('helpr_task', '${U(621)}', 'banned', 'x')`);
const hl = (await asUser(ADMIN, `SELECT public.admin_payouts_held_for_review() AS l`))?.[0]?.l ?? [];
ok(!skip && hl.some((r) => r.id === U(621) && r.stripe_group === `declutter_order_${U(500)}`), "a held Helpr payout shows its real transfer group (its Declutter order's)");
ok(!skip && (await seen("declutter", U(238), U(38), "suspended"))?.page_due === false && await notes(U(38)) === 0, "a suspension is a quiet bounded wait");
ok(!skip && (await seen("declutter", U(240), U(40), "needs_reconcile"))?.page_due === true, "needs_reconcile is paged (and held) at once");

// --- 3. grants: service only
const can = async (fn) => (await q(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') OR has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS c`))?.[0]?.c;
let closed = true;
for (const fn of ["payout_payee_wait_seen(text, uuid, uuid, integer, text, text)", "payout_defer(text, uuid, integer)",
  "payout_payee_wait_cleared(text, uuid)", "payout_payee_paged(text, uuid, text)", "payout_payee_waits_prune()", "declutter_refunds_due(integer)",
  "payout_mark_sending(text, uuid)", "payout_send_marks_for(text, uuid[])", "payout_hold_for_review(text, uuid, text, text)",
  "money_ref_in_use(text)"]) {
  if (skip || await can(fn)) { closed = false; console.log(`  open: ${fn}`); }
}
ok(!skip && closed, "every new function is service only");
let adminOpen = true;
for (const fn of ["admin_payouts_held_for_review()", "admin_payout_release(text, uuid, text, boolean)", "admin_payout_settle_by_hand(text, uuid, text, integer, text)"]) {
  const r = (await q(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS a, has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS n`))?.[0];
  if (skip || !r?.a || r?.n) { adminOpen = false; console.log(`  wrong grant: ${fn}`); }
}
ok(!skip && adminOpen, "the admin actions: authenticated (they check the admin role themselves), never anon");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
