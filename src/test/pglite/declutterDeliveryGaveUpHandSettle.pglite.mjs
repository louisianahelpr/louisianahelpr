#!/usr/bin/env node
/**
 * PGlite proof for 20261102043754_declutter_delivery_gave_up_hand_settle (Q1931 parts 2 and 3): a Declutter delivery
 * row that used its 12 tries (a Helpr's delivery pay, a delivery-fee refund) is listed in Payouts held for review and
 * can be settled by hand there, so a delivery-fee refund sent in Stripe counts in the recorded-refunds sum and a
 * Helpr's gave-up pay stops blocking the account deletion once it is paid. A row still being retried is refused.
 *
 *   node src/test/pglite/declutterDeliveryGaveUpHandSettle.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDeliveryGaveUpHandSettle.pglite.mjs # RED: the 20261019112103 versions
 *   MUTANT=<name> node src/test/pglite/declutterDeliveryGaveUpHandSettle.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: the money tables reduced to the columns the two functions read and write (same status values);
 * has_role (user_roles text), money_ref_in_use (the stripe ids on the payout / refund rows and payout_settlements),
 * auth.uid() from request.jwt.claim.sub. declutter_order_refunds_recorded_cents is the NEWEST real definition, read
 * from the migrations. Supabase's default anon/authenticated EXECUTE grant on new functions is emulated; both functions
 * already exist on prod with anon revoked (20261019112103 is applied first here), and CREATE OR REPLACE keeps that ACL.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102043754_declutter_delivery_gave_up_hand_settle.sql";
const BEFORE = "20261019112103_shops_held_for_review_admin_tools.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // A payout still on its 11th try (the queue will retry it) can be settled by hand.
  earlySettle: ["v_status = 'failed' AND v_attempts >= 12) THEN", "v_status = 'failed' AND v_attempts >= 11) THEN"],
  // Any status with 12 tries passes (a pending row the queue still owns).
  noStatus: ["AND v_status = 'failed' AND v_attempts >= 12) THEN", "AND v_attempts >= 12) THEN"],
  // The gave-up delivery-fee refund is not listed.
  noListRefund: ["       WHERE d.status = 'failed' AND d.attempts >= 12", "       WHERE d.status = 'failed' AND d.attempts >= 99"],
  // The gave-up Helpr payout is not listed.
  noListPayout: ["       WHERE p.status = 'failed' AND p.attempts >= 12", "       WHERE p.status = 'failed' AND p.attempts >= 99"],
  // A gave-up row is listed as an ordinary held row (the card would offer Release).
  notFlagged: ["COALESCE(d.last_error, 'no error recorded'), d.created_at,\n             d.stripe_payment_intent_id, true", "COALESCE(d.last_error, 'no error recorded'), d.created_at,\n             d.stripe_payment_intent_id, false"],
  // The admin check is dropped.
  noAdmin: ["  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN\n    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';\n  END IF;\n  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN\n    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say how it was settled", "  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN\n    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say how it was settled"],
};
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestFunction(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const rest = sql.slice(m.index);
      const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(rest)[1];
      const open = rest.indexOf(tag);
      const close = rest.indexOf(tag, open + tag.length);
      found = rest.slice(0, close + tag.length) + ";";
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `cccccccc-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), HELPR = U(2), BUYER = U(3), MEMBER = U(4), ORDER = U(10), TASK = U(11);
const P_GAVE = U(20), P_TRYING = U(21), P_PENDING = U(22), D_GAVE = U(30), D_TRYING = U(31);
const PI = "pi_order1";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, stripe_payment_intent_id text,
  setup_fee_state text, setup_fee_cents integer NOT NULL DEFAULT 0);
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, amount_cents integer, status text,
  review_reason text, review_held_at timestamptz, stripe_transfer_id text, settled_by_hand_ref text, settled_by_hand_cents integer,
  settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text, source_id uuid);
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY, task_id uuid, helpr_id uuid, amount_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand')),
  attempts integer NOT NULL DEFAULT 0, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
  review_reason text, review_held_at timestamptz, stripe_transfer_id text, settled_by_hand_ref text, settled_by_hand_cents integer,
  settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, seller_id uuid, buyer_id uuid);
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY, order_id uuid, amount_cents integer, status text, review_reason text,
  review_held_at timestamptz, stripe_transfer_id text, settled_by_hand_ref text, settled_by_hand_cents integer,
  settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY, order_id uuid, refund_cents integer, status text, review_reason text,
  review_held_at timestamptz, stripe_payment_intent_id text, stripe_refund_ref text, payment_livemode boolean,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.declutter_delivery_refunds (id uuid PRIMARY KEY, order_id uuid, refund_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'held_for_review', 'settled_by_hand')),
  attempts integer NOT NULL DEFAULT 0, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
  review_reason text, review_held_at timestamptz, stripe_payment_intent_id text, stripe_refund_ref text,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.shop_refunds (id uuid PRIMARY KEY, order_id uuid, refund_cents integer, status text, review_reason text,
  review_held_at timestamptz, stripe_payment_intent_id text);
CREATE TABLE public.declutter_hand_refunds (stripe_refund_id text, stripe_payment_intent_id text, order_id uuid, refund_row_id uuid,
  amount_cents integer, livemode boolean, hand_outcome text, failed_at timestamptz);
CREATE TABLE public.payout_settlements (stripe_ref text, off_stripe_note text, row_kind text, row_id uuid, amount_cents integer);
CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
CREATE FUNCTION public.money_ref_in_use(p_ref text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.payout_settlements WHERE stripe_ref = p_ref)
      OR EXISTS (SELECT 1 FROM public.helpr_task_payouts WHERE stripe_transfer_id = p_ref)
      OR EXISTS (SELECT 1 FROM public.declutter_delivery_refunds WHERE stripe_refund_ref = p_ref) $$;
`);
await db.exec(newestFunction("declutter_order_refunds_recorded_cents"));

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
await q(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [ADMIN]);
await q(`INSERT INTO public.declutter_orders (id, buyer_id, stripe_payment_intent_id) VALUES ($1, $2, $3)`, [ORDER, BUYER, PI]);
await q(`INSERT INTO public.helpr_tasks VALUES ($1, 'declutter_delivery', $2)`, [TASK, ORDER]);
await q(`INSERT INTO public.helpr_task_payouts (id, task_id, helpr_id, amount_cents, status, attempts, last_error) VALUES
  ($1, $3, $4, 1800, 'failed', 12, 'account closed'), ($2, $3, $4, 1500, 'failed', 11, 'try again'),
  ($5, $3, $4, 1200, 'pending', 12, NULL)`, [P_GAVE, P_TRYING, TASK, HELPR, P_PENDING]);
await q(`INSERT INTO public.declutter_delivery_refunds (id, order_id, refund_cents, status, attempts, last_error, stripe_payment_intent_id) VALUES
  ($1, $3, 799, 'failed', 12, 'card expired', $4), ($2, $3, 500, 'failed', 3, 'stripe down', $4)`, [D_GAVE, D_TRYING, ORDER, PI]);

const base = readFileSync(MIG_DIR + BEFORE, "utf8");
await db.exec(base); // the 20261019112103 versions first, as on prod
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
}

const as = async (uid, role, sql, params = []) => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
  try { return await tryQ(sql, params); } finally { await db.exec("RESET ROLE"); }
};
const settle = (uid, role, kind, id, ref, cents) => as(uid, role,
  `SELECT public.admin_payout_settle_by_hand($1, $2, $3, $4, 'sent by hand after the queue gave up') AS r`, [kind, id, ref, cents]);
const status = async (table, id) => (await q(`SELECT status FROM public.${table} WHERE id = $1`, [id]))[0].status;

// The list.
const listed = await as(ADMIN, "authenticated", `SELECT public.admin_payouts_held_for_review() AS l`);
const rows = listed.error ? [] : listed[0].l;
const find = (id) => rows.find((r) => r.id === id);
check(!listed.error, `the admin list loads (${listed.error ?? "ok"})`);
check(!!find(P_GAVE) && find(P_GAVE).kind === "helpr_task" && find(P_GAVE).gave_up === true,
  `[fix] the gave-up Helpr delivery pay is listed, flagged gave_up (${JSON.stringify(find(P_GAVE) ?? null)?.slice(0, 120)})`);
check(!!find(D_GAVE) && find(D_GAVE).kind === "delivery_refund" && find(D_GAVE).gave_up === true
  && /^gave_up: card expired$/.test(find(D_GAVE).reason ?? "") && find(D_GAVE).amount_cents === 799,
  `[fix] the gave-up delivery-fee refund is listed with its last error and amount`);
check(!find(P_TRYING) && !find(D_TRYING), "rows still being retried are not listed");
check(find(P_GAVE)?.stripe_group === `declutter_order_${ORDER}`, "[fix] the Helpr pay row names its order's transfer group");

// Who may settle.
const anonTry = await settle(null, "anon", "delivery_refund", D_GAVE, "re_hand1", 799);
check(!!anonTry.error, `anon cannot settle (${(anonTry.error ?? "").slice(0, 60)})`);
const memberTry = await settle(MEMBER, "authenticated", "delivery_refund", D_GAVE, "re_hand1", 799);
check(/admin_only/.test(memberTry.error ?? ""), `an ordinary member is refused admin_only (${memberTry.error ?? "allowed"})`);
const tryingTry = await settle(ADMIN, "authenticated", "helpr_task", P_TRYING, "tr_hand0", 1500);
check(/not_held_for_review/.test(tryingTry.error ?? ""), `[fix] a payout still being retried (11 tries) is refused (${tryingTry.error ?? "settled"})`);
const pendingTry = await settle(ADMIN, "authenticated", "helpr_task", P_PENDING, "tr_hand9", 1200);
check(/not_held_for_review/.test(pendingTry.error ?? ""), `[fix] a pending payout (the queue owns it) is refused even at 12 tries (${pendingTry.error ?? "settled"})`);
const tryingRefund = await settle(ADMIN, "authenticated", "delivery_refund", D_TRYING, "re_hand0", 500);
check(/not_held_for_review/.test(tryingRefund.error ?? ""), "a delivery-fee refund still being retried is refused");

// Part 2: the delivery-fee refund sent by hand is recorded and counted.
const before = (await q(`SELECT public.declutter_order_refunds_recorded_cents($1) n`, [ORDER]))[0].n;
const s1 = await settle(ADMIN, "authenticated", "delivery_refund", D_GAVE, "re_hand1", 799);
check(!s1.error && s1[0]?.r?.result === "settled", `[fix] the gave-up delivery-fee refund settles with its Stripe refund id (${s1.error ?? "ok"})`);
check(await status("declutter_delivery_refunds", D_GAVE) === "succeeded", "[fix] it is 'succeeded' with that refund id");
const after = (await q(`SELECT public.declutter_order_refunds_recorded_cents($1) n`, [ORDER]))[0].n;
check(before === 0 && after === 799, `[fix] the recorded-refunds sum counts it (${before} -> ${after})`);
const reuse = await settle(ADMIN, "authenticated", "helpr_task", P_GAVE, "re_hand1", 1800);
check(!!reuse.error, "a refund id cannot settle a payout");

// Part 3: the Helpr's gave-up pay, paid by hand, stops counting as owed (accountPurge reads these statuses).
const owed = async () => (await q(`SELECT count(*)::int n FROM public.helpr_task_payouts
  WHERE helpr_id = $1 AND status IN ('pending', 'failed', 'held_for_review') AND id = $2`, [HELPR, P_GAVE]))[0].n;
check(await owed() === 1, "the gave-up pay counts as owed before it is settled");
const s2 = await settle(ADMIN, "authenticated", "helpr_task", P_GAVE, "tr_hand2", 1800);
check(!s2.error, `[fix] the gave-up Helpr pay settles with its transfer id (${s2.error ?? "ok"})`);
check(await owed() === 0 && await status("helpr_task_payouts", P_GAVE) === "succeeded",
  "[fix] once settled it no longer counts as owed, so it stops blocking the Helpr's deletion");
const audit = (await q(`SELECT count(*)::int n FROM public.admin_audit_log WHERE action = 'admin_payout_settle_by_hand'`))[0].n;
check(audit === 2, `both settles are in the admin audit log (${audit})`);
const again = await settle(ADMIN, "authenticated", "helpr_task", P_GAVE, "tr_hand3", 1800);
check(/not_held_for_review/.test(again.error ?? ""), "a settled row cannot be settled twice");

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.admin_payout_settle_by_hand(text, uuid, text, integer, text)', 'EXECUTE') a,
    has_function_privilege('anon', 'public.admin_payouts_held_for_review()', 'EXECUTE') l`))[0];
  check(!acl.a && !acl.l, `anon has no EXECUTE (settle ${acl.a}, list ${acl.l})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
