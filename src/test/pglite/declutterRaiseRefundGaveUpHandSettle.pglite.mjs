#!/usr/bin/env node
/**
 * PGlite proof for 20261102054153_declutter_raise_refund_gave_up_hand_settle (Q1931, last part): a Declutter delivery
 * pay-RAISE refund that used its 12 tries ('refunding', refund_attempts >= 12) is listed in Payouts held for review
 * (kind 'raise_refund', gave_up) and can be settled by hand there with a Stripe refund id for its whole amount.
 *
 *   node src/test/pglite/declutterRaiseRefundGaveUpHandSettle.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRaiseRefundGaveUpHandSettle.pglite.mjs # RED: the 20261102043754 versions
 *   MUTANT=<name> node src/test/pglite/declutterRaiseRefundGaveUpHandSettle.pglite.mjs      # a planted defect: must FAIL
 *
 * The world is src/test/pglite/declutterDeliveryGaveUpHandSettle.pglite.mjs's (stubbed tables, said so there) plus
 * declutter_delivery_raises (the columns the two functions read and write, the real status values). 20261019112103
 * (which adds payout_settlements' row_kind CHECK) and 20261102043754 are applied first, as on prod. Supabase's
 * default anon/authenticated EXECUTE grant on new functions is emulated.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102054153_declutter_raise_refund_gave_up_hand_settle.sql";
const PRIOR = ["20261019112103_shops_held_for_review_admin_tools.sql", "20261102043754_declutter_delivery_gave_up_hand_settle.sql"];
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // A raise refund still on its 11th try (the queue will retry it) can be settled by hand.
  earlySettle: ["v_status = 'refunding' AND v_attempts >= 12) THEN", "v_status = 'refunding' AND v_attempts >= 11) THEN"],
  // Any status with 12 tries passes (an applied raise, which was never refunded).
  noStatus: ["(p_kind = 'raise_refund' AND v_status = 'refunding' AND v_attempts >= 12)", "(p_kind = 'raise_refund' AND v_attempts >= 12)"],
  // "other: ..." settles a raise refund (no Stripe refund id, the buyer may never be paid back).
  allowOther: ["  IF p_kind = 'raise_refund' AND v_stripe IS NULL THEN", "  IF false THEN"],
  // A part refund settles it.
  anyAmount: ["  IF p_kind = 'raise_refund' AND p_amount_cents <> v_refund_cents THEN", "  IF false THEN"],
  // The gave-up raise refund is not listed.
  noList: ["       WHERE g.status = 'refunding' AND g.refund_attempts >= 12", "       WHERE g.status = 'refunding' AND g.refund_attempts >= 99"],
  // The ledger CHECK is not widened (the settle fails on the INSERT).
  noCheck: [", 'shop_refund', 'raise_refund'));", ", 'shop_refund'));"],
};
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), BUYER = U(3), MEMBER = U(4), ORDER = U(10), TASK = U(11);
const G_GAVE = U(40), G_TRYING = U(41), G_APPLIED = U(42);

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
CREATE TABLE public.declutter_delivery_raises (id uuid PRIMARY KEY, order_id uuid, task_id uuid, refund_cents integer,
  stripe_payment_intent_id text,
  status text NOT NULL CHECK (status IN ('awaiting_payment', 'superseded', 'applied', 'refunding', 'refunded')),
  stripe_refund_ref text, refund_attempts integer NOT NULL DEFAULT 0, refund_last_error text, refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
CREATE FUNCTION public.money_ref_in_use(p_ref text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.payout_settlements WHERE stripe_ref = p_ref)
      OR EXISTS (SELECT 1 FROM public.helpr_task_payouts WHERE stripe_transfer_id = p_ref)
      OR EXISTS (SELECT 1 FROM public.declutter_delivery_refunds WHERE stripe_refund_ref = p_ref)
      OR EXISTS (SELECT 1 FROM public.declutter_delivery_raises WHERE stripe_refund_ref = p_ref) $$;
`);


const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
await q(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [ADMIN]);
await q(`INSERT INTO public.declutter_orders (id, buyer_id, stripe_payment_intent_id) VALUES ($1, $2, 'pi_order1')`, [ORDER, BUYER]);
await q(`INSERT INTO public.declutter_delivery_raises (id, order_id, task_id, refund_cents, stripe_payment_intent_id, status, refund_attempts, refund_last_error) VALUES
  ($1, $4, $5, 530, 'pi_raise1', 'refunding', 12, 'charge disputed'),
  ($2, $4, $5, 400, 'pi_raise2', 'refunding', 11, 'stripe down'),
  ($3, $4, $5, 300, 'pi_raise3', 'applied', 12, NULL)`, [G_GAVE, G_TRYING, G_APPLIED, ORDER, TASK]);

for (const f of PRIOR) await db.exec(readFileSync(MIG_DIR + f, "utf8"));
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
const settle = (uid, role, id, ref, cents) => as(uid, role,
  `SELECT public.admin_payout_settle_by_hand('raise_refund', $1, $2, $3, 'refunded in Stripe after the queue gave up') AS r`, [id, ref, cents]);
const row = async (id) => (await q(`SELECT status, stripe_refund_ref, refunded_at FROM public.declutter_delivery_raises WHERE id = $1`, [id]))[0];

const listed = await as(ADMIN, "authenticated", `SELECT public.admin_payouts_held_for_review() AS l`);
const rows = listed.error ? [] : listed[0].l;
const find = (id) => rows.find((r) => r.id === id);
check(!listed.error, `the admin list loads (${listed.error ?? "ok"})`);
check(!!find(G_GAVE) && find(G_GAVE).kind === "raise_refund" && find(G_GAVE).gave_up === true
  && find(G_GAVE).reason === "gave_up: charge disputed" && find(G_GAVE).amount_cents === 530
  && find(G_GAVE).payee_id === BUYER && find(G_GAVE).stripe_group === "pi_raise1",
  `[fix] the gave-up raise refund is listed: kind, gave_up, last error, amount, buyer, its own PaymentIntent (${JSON.stringify(find(G_GAVE) ?? null)?.slice(0, 160)})`);
check(!find(G_TRYING) && !find(G_APPLIED), "a raise refund still being retried, and an applied raise, are not listed");

const anonTry = await settle(null, "anon", G_GAVE, "re_raise1", 530);
check(!!anonTry.error, `anon cannot settle (${(anonTry.error ?? "").slice(0, 60)})`);
const memberTry = await settle(MEMBER, "authenticated", G_GAVE, "re_raise1", 530);
check(/admin_only/.test(memberTry.error ?? ""), `an ordinary member is refused admin_only (${memberTry.error ?? "allowed"})`);
const trying = await settle(ADMIN, "authenticated", G_TRYING, "re_raise0", 400);
check(/not_held_for_review/.test(trying.error ?? ""), `[fix] a raise refund on its 11th try is refused (${trying.error ?? "settled"})`);
const applied = await settle(ADMIN, "authenticated", G_APPLIED, "re_raise9", 300);
check(/not_held_for_review/.test(applied.error ?? ""), `[fix] an applied raise (never refunded) is refused even at 12 tries (${applied.error ?? "settled"})`);
const other = await settle(ADMIN, "authenticated", G_GAVE, "other: paid cash", 530);
check(/stripe_refund_required/.test(other.error ?? ""), `[fix] "other: ..." is refused for a raise refund (${other.error ?? "settled"})`);
const transfer = await settle(ADMIN, "authenticated", G_GAVE, "tr_raise1", 530);
check(/invalid_stripe_ref/.test(transfer.error ?? ""), "a transfer id cannot settle a refund");
const short = await settle(ADMIN, "authenticated", G_GAVE, "re_raise1", 500);
check(/settle_amount_differs|settle_amount_short/.test(short.error ?? ""), `[fix] a part amount is refused (${short.error ?? "settled"})`);
const over = await settle(ADMIN, "authenticated", G_GAVE, "re_raise1", 600);
check(/settle_amount_differs/.test(over.error ?? ""), `[fix] more than the refund owes is refused (${over.error ?? "settled"})`);
check((await row(G_GAVE)).status === "refunding", "every refusal left the row 'refunding'");

const ok = await settle(ADMIN, "authenticated", G_GAVE, "re_raise1", 530);
check(!ok.error && ok[0]?.r?.result === "settled" && ok[0]?.r?.status === "refunded", `[fix] the gave-up raise refund settles with its refund id (${ok.error ?? JSON.stringify(ok[0]?.r)})`);
const after = await row(G_GAVE);
check(after.status === "refunded" && after.stripe_refund_ref === "re_raise1" && after.refunded_at !== null,
  `[fix] it ends 'refunded' with the re_ id and refunded_at (${JSON.stringify(after)})`);
const ledger = (await q(`SELECT count(*)::int n FROM public.payout_settlements WHERE row_kind = 'raise_refund' AND row_id = $1 AND stripe_ref = 're_raise1'`, [G_GAVE]))[0].n;
check(ledger === 1, `[fix] one payout_settlements row records it (${ledger})`);
const audit = (await q(`SELECT count(*)::int n FROM public.admin_audit_log WHERE action = 'admin_payout_settle_by_hand' AND target_type = 'raise_refund'`))[0].n;
check(audit === 1, `the settle is in the admin audit log (${audit})`);
const listed2 = await as(ADMIN, "authenticated", `SELECT public.admin_payouts_held_for_review() AS l`);
check(!listed2.error && !listed2[0].l.some((r) => r.id === G_GAVE), "once settled it leaves the list");
const again = await settle(ADMIN, "authenticated", G_GAVE, "re_raise2", 530);
check(/not_held_for_review/.test(again.error ?? ""), "a settled raise refund cannot be settled twice");
const reuse = await as(ADMIN, "authenticated", `SELECT public.admin_payout_settle_by_hand('raise_refund', $1, 're_raise1', 400, 'x') AS r`, [G_TRYING]);
check(!!reuse.error, "the same refund id cannot be recorded twice");

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.admin_payout_settle_by_hand(text, uuid, text, integer, text)', 'EXECUTE') a,
    has_function_privilege('anon', 'public.admin_payouts_held_for_review()', 'EXECUTE') l`))[0];
  check(!acl.a && !acl.l, `anon has no EXECUTE (settle ${acl.a}, list ${acl.l})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
