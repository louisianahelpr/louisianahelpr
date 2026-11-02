#!/usr/bin/env node
/**
 * PGlite proof for 20261102033730_declutter_delivery_gave_up_check (Q1931): Declutter delivery money that used its
 * 12 tries (a Helpr's delivery pay, a delivery-fee refund, a delivery pay-raise refund) raises one ops-ledger row per
 * row per UTC day while it is stuck, and tells the person owed the money once; rows still trying, settled, held for
 * review or succeeded stay quiet.
 *
 *   node src/test/pglite/declutterDeliveryGaveUpCheck.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDeliveryGaveUpCheck.pglite.mjs # RED: nothing raises a gave-up row
 *   MUTANT=<name> node src/test/pglite/declutterDeliveryGaveUpCheck.pglite.mjs      # a planted defect: must FAIL
 *   FOLLOW=skip node src/test/pglite/declutterDeliveryGaveUpCheck.pglite.mjs        # RED: the buyer's link is ?view=cart
 *
 * Then 20261102064215_declutter_gave_up_notice_opens_buying (DC-17 link format) is applied on top (3x): the buyer's
 * notice opens ?tab=buying; everything else is unchanged. FOLLOW_MUTANT=keepCart plants the old link back.
 * Then 20261102070238_declutter_gave_up_notice_no_fee_words (3x): the buyer's notice names what the money was for,
 * never a fee. FOLLOW2=skip leaves "delivery fee" (RED); FOLLOW2_MUTANT=feeWord plants it back (RED).
 *
 * Stubbed, said so: auth.users, declutter_orders, helpr_task_payouts, declutter_delivery_refunds and
 * declutter_delivery_raises reduced to the columns this reads (same status values); error_logs (severity, message, tags,
 * context, created_at); declutter_notify (records the notice). Supabase's default anon/authenticated EXECUTE grant on
 * new functions is emulated.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102033730_declutter_delivery_gave_up_check.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The ledger row is written every run, not once a day.
  noDayDedupe: ["           AND e.created_at > date_trunc('day', now())\n", "           AND e.created_at > now() + interval '1 day'\n"],
  // A client-written error_logs row mutes the alert (Q1159).
  clientMutes: ["           AND coalesce(e.tags ->> 'origin', '') <> 'client'\n           AND e.tags ->> 'source' = 'declutter-delivery-gave-up'", "           AND e.tags ->> 'source' = 'declutter-delivery-gave-up'"],
  // The told-once stamp is never kept, so the Helpr is told on every run.
  noStamp: ["UPDATE public.helpr_task_payouts SET gave_up_notified_at = now() WHERE id = r.id AND gave_up_notified_at IS NULL;", "UPDATE public.helpr_task_payouts SET gave_up_notified_at = NULL WHERE id = r.id;"],
  // A payout still on its 11th try is called gave-up.
  earlyGiveUp: ["       WHERE p.status = 'failed' AND p.attempts >= 12", "       WHERE p.status = 'failed' AND p.attempts >= 11"],
  // Raise refunds are left out.
  noRaises: ["       WHERE g.status = 'refunding' AND g.refund_attempts >= 12", "       WHERE g.status = 'refunded' AND g.refund_attempts >= 12"],
  // Delivery-fee refunds are left out.
  noDeliveryRefunds: ["       WHERE d.status = 'failed' AND d.attempts >= 12", "       WHERE d.status = 'succeeded' AND d.attempts >= 12"],
  // Left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.declutter_delivery_gave_up_check() FROM PUBLIC, anon, authenticated;", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";
const FOLLOW = "20261102064215_declutter_gave_up_notice_opens_buying.sql";
const followSkip = process.env.FOLLOW === "skip";
const FOLLOW_MUTANTS = { keepCart: ["'/declutter?tab=buying');", "'/declutter?view=cart');"] };
const FOLLOW2 = "20261102070238_declutter_gave_up_notice_no_fee_words.sql";
// keepCart again on the newest definition (FOLLOW_MUTANT=keepCart alone is overwritten by FOLLOW2).
const FOLLOW2_MUTANTS = { feeWord: ["THEN 'delivery' ELSE", "THEN 'delivery fee' ELSE"], keepCart: FOLLOW_MUTANTS.keepCart };

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;
const HELPR = U(1), BUYER = U(2), BUYER2 = U(3), ORDER = U(10), ORDER2 = U(11);
const P_GAVE = U(20), P_TRYING = U(21), P_DONE = U(22), P_HELD = U(23), P_GONE = U(24);
const D_GAVE = U(30), D_SETTLED = U(31);
const R_GAVE = U(40), R_DONE = U(41);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid);
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY, task_id uuid NOT NULL, helpr_id uuid, amount_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand')),
  attempts integer NOT NULL DEFAULT 0, last_error text, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_delivery_refunds (id uuid PRIMARY KEY, order_id uuid NOT NULL, refund_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'held_for_review', 'settled_by_hand')),
  attempts integer NOT NULL DEFAULT 0, last_error text, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_delivery_raises (id uuid PRIMARY KEY, order_id uuid, refund_cents integer,
  status text NOT NULL CHECK (status IN ('awaiting_payment', 'superseded', 'applied', 'refunding', 'refunded')),
  refund_attempts integer NOT NULL DEFAULT 0, refund_last_error text, is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.error_logs (id bigserial PRIMARY KEY, severity text, message text, tags jsonb, context jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_type, p_title, p_message, p_link) $$;
`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
await q(`INSERT INTO public.declutter_orders VALUES ($1, $2), ($3, $4)`, [ORDER, BUYER, ORDER2, BUYER2]);
await q(`INSERT INTO public.helpr_task_payouts (id, task_id, helpr_id, amount_cents, status, attempts, last_error) VALUES
  ($1, gen_random_uuid(), $6, 1800, 'failed', 12, 'account closed'),
  ($2, gen_random_uuid(), $6, 1500, 'failed', 11, 'try again'),
  ($3, gen_random_uuid(), $6, 1500, 'succeeded', 12, NULL),
  ($4, gen_random_uuid(), $6, 1500, 'held_for_review', 12, NULL),
  ($5, gen_random_uuid(), NULL, 900, 'failed', 12, 'gone')`, [P_GAVE, P_TRYING, P_DONE, P_HELD, P_GONE, HELPR]);
await q(`INSERT INTO public.declutter_delivery_refunds (id, order_id, refund_cents, status, attempts, last_error) VALUES
  ($1, $3, 799, 'failed', 12, 'card expired'), ($2, $4, 500, 'settled_by_hand', 12, NULL)`, [D_GAVE, D_SETTLED, ORDER, ORDER2]);
await q(`INSERT INTO public.declutter_delivery_raises (id, order_id, refund_cents, status, refund_attempts, refund_last_error) VALUES
  ($1, $3, 312, 'refunding', 12, 'stripe down'), ($2, $4, 200, 'refunded', 12, NULL)`, [R_GAVE, R_DONE, ORDER2, ORDER]);

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
  if (!followSkip) {
    let next = readFileSync(MIG_DIR + FOLLOW, "utf8");
    const fm = process.env.FOLLOW_MUTANT;
    if (fm) {
      const m = FOLLOW_MUTANTS[fm];
      if (!m || !next.includes(m[0])) throw new Error(`follow mutant ${fm} did not apply`);
      next = next.replace(m[0], m[1]);
    }
    for (let k = 1; k <= 3; k++) {
      try { await db.exec(next); check(true, `${FOLLOW} applies (run ${k})`); } catch (e) { check(false, `${FOLLOW} applies (run ${k}): ${e.message}`); }
    }
    if (process.env.FOLLOW2 !== "skip") {
      let next2 = readFileSync(MIG_DIR + FOLLOW2, "utf8");
      const fm2 = process.env.FOLLOW2_MUTANT;
      if (fm2) {
        const m = FOLLOW2_MUTANTS[fm2];
        if (!m || !next2.includes(m[0])) throw new Error(`follow2 mutant ${fm2} did not apply`);
        next2 = next2.replace(m[0], m[1]);
      }
      for (let k = 1; k <= 3; k++) {
        try { await db.exec(next2); check(true, `${FOLLOW2} applies (run ${k})`); } catch (e) { check(false, `${FOLLOW2} applies (run ${k}): ${e.message}`); }
      }
    }
  }
}

const run = () => tryQ(`SELECT public.declutter_delivery_gave_up_check() AS n`);
const ledger = async (id) => (await q(`SELECT count(*)::int n FROM public.error_logs
  WHERE tags ->> 'source' = 'declutter-delivery-gave-up' AND tags ->> 'row_id' = $1`, [id]))[0].n;
const notices = async (user) => (await q(`SELECT title, message, link FROM public.notices WHERE user_id = $1`, [user]));

const first = await run();
check(!first.error && first[0].n === 4, `[fix] the check finds the 4 gave-up rows (${JSON.stringify(first)})`);
check(await ledger(P_GAVE) === 1, "[fix] a Helpr delivery payout that used its 12 tries raises one ledger row");
check(await ledger(D_GAVE) === 1, "[fix] a delivery-fee refund that used its 12 tries raises one ledger row");
check(await ledger(R_GAVE) === 1, "[fix] a pay-raise refund that used its 12 tries raises one ledger row");
check(await ledger(P_GONE) === 1, "[fix] a gave-up payout whose Helpr deleted the account is still raised");
check(await ledger(P_TRYING) === 0, "a payout still on its 11th try is not raised");
check(await ledger(P_DONE) + await ledger(P_HELD) + await ledger(D_SETTLED) + await ledger(R_DONE) === 0,
  "succeeded, held-for-review, settled-by-hand and refunded rows are not raised");
const msg = skip ? "" : (await q(`SELECT message FROM public.error_logs WHERE tags ->> 'row_id' = $1`, [D_GAVE]))[0]?.message ?? "";
check(msg.includes("$7.99") && msg.includes("card expired"), `[fix] the ledger row names the amount and the last error (${msg.slice(0, 90)})`);
const h = await notices(HELPR);
check(h.length === 1 && h[0].message.includes("$18.00 delivery pay"), `[fix] the Helpr is told once about the $18.00 pay (${h.length})`);
const b1 = await notices(BUYER), b2 = await notices(BUYER2);
check(b1.length === 1 && b1[0].message.includes("$7.99 you paid for delivery"), `[fix] the buyer is told the $7.99 they paid for delivery is being sent by hand (${b1[0]?.message})`);
check(b2.length === 1 && b2[0].message.includes("$3.12 you paid for the delivery pay raise"), `[fix] the raise buyer is told too (${b2[0]?.message})`);
check(![...b1, ...b2].some((n) => /\bfees?\b/i.test(`${n.title} ${n.message}`)), `[fee words] the buyer's notices name no fee (owner: members see no fee words)`);
// DC-17 format (20261102064215): the buyer's notice opens their side, the Helpr's stays on earnings.
check(b1[0]?.link === "/declutter?tab=buying" && b2[0]?.link === "/declutter?tab=buying", `[fix] the buyer's notice opens ?tab=buying (${b1[0]?.link}, ${b2[0]?.link})`);
check(h[0]?.link === "/profile?tab=earnings", `the Helpr's notice still opens earnings (${h[0]?.link})`);

// Same day again: nothing new.
const second = await run();
check(!second.error, `a second run the same day works (${second.error ?? "ok"})`);
check(await ledger(P_GAVE) === 1 && await ledger(D_GAVE) === 1 && await ledger(R_GAVE) === 1, "[fix] no second ledger row the same day");
check((await notices(HELPR)).length === 1 && (await notices(BUYER)).length === 1 && (await notices(BUYER2)).length === 1,
  "[fix] nobody is told twice");

// A client-written row with the same tags never mutes the alert.
await q(`DELETE FROM public.error_logs WHERE tags ->> 'row_id' = $1`, [D_GAVE]);
await q(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error', 'x',
  jsonb_build_object('source', 'declutter-delivery-gave-up', 'row_id', $1::text, 'origin', 'client'))`, [D_GAVE]);
await run();
check(await ledger(D_GAVE) === 2, "[fix] a client-written error_logs row does not mute the alert");

// Next day, still stuck: raised again, nobody told again.
await q(`UPDATE public.error_logs SET created_at = created_at - interval '1 day'`);
await run();
check(await ledger(P_GAVE) === 2, "[fix] a row still stuck the next day raises a new ledger row");
check((await notices(HELPR)).length === 1, "[fix] but the Helpr is not told again");

// Settled: drops out.
await q(`UPDATE public.helpr_task_payouts SET status = 'settled_by_hand' WHERE id = $1`, [P_GAVE]);
await q(`UPDATE public.error_logs SET created_at = created_at - interval '1 day'`);
await run();
check(await ledger(P_GAVE) === 2, "a settled payout is no longer raised");

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_delivery_gave_up_check()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_delivery_gave_up_check()', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.declutter_delivery_gave_up_check()', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a} authenticated ${acl.u} service ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
