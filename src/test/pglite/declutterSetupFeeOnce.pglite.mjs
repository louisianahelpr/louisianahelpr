#!/usr/bin/env node
/**
 * PGlite proof for 20261026154738_declutter_setup_fee_once (Q2352; owner
 * 2026-10-22, Declutter terms #9: the one-time account setup fee is charged
 * ONCE per account, whichever comes first, a member's first Declutter
 * purchase among them).
 *
  *   npx tsx src/test/pglite/declutterSetupFeeOnce.pglite.mjs                     # all PASS (migration applied 3x)
  *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterSetupFeeOnce.pglite.mjs  # RED: the migration absent
  *   MIGRATION_PATH=<planted copy> npx tsx src/test/pglite/declutterSetupFeeOnce.pglite.mjs
 *
 * Base: Declutter slices 1-5 as declutterDeliveryRaise.pglite.mjs builds them,
 * then the functions this migration restates at their NEWEST definitions
 * before it (src/test/helpers/effectiveFunctionDefs.ts { before }), which match
 * prod's prosrc md5 on 2026-10-23, plus the two columns they read that later
 * migrations add (shipping_cents; profiles.onboarding_fee_paid) and a
 * platform_settings row at prod's 200.
 *
 * Proves: a buyer who never paid the fee gets it frozen on the order OUTSIDE
 * total_cents, a buyer who paid it does not; the payment must be total + fee;
 * a sale that stands claims the account's flag once; a second order paid after
 * the flag was claimed elsewhere is marked refund_due and its refund is
 * recorded once (and counted as a known refund on the charge); a refused
 * payment returns everything and claims nothing; a later refund of the sale
 * keeps the fee; the fee is frozen; an open order whose fee no longer matches
 * is replaced; members cannot call the helpers.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const NEW_FILE = "20261026154738_declutter_setup_fee_once.sql";
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  "20261018183715_declutter_handover_no_qr_no_code.sql",
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
  "20261021181118_helpr_delivery_payout_round_down.sql",
];
const RESTATED = ["declutter_orders_fee_rule_frozen", "declutter_start_checkout", "declutter_mark_order_paid",
  "declutter_order_refunds_recorded_cents"];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3 } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const NEW_SQL = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");

const DEFS = effectiveDefs(MIG_DIR, { before: NEW_FILE });
function stmtOf(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no definition of ${name} before ${NEW_FILE}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...BEFORE.map((file) => ({ file, times: 1 }))];
const stmts = setupStatements({ times: 1, times3b: 1, extra });
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
stmts.splice(2, 0, `
  CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  BEGIN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_user, p_violation_type, p_description, p_job_id, p_rungs[1]);
    RETURN jsonb_build_object('action', p_rungs[1]);
  END $$;
  REVOKE ALL ON FUNCTION public.apply_consequence_ladder(uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) FROM PUBLIC, anon, authenticated;`);
for (const sql of stmts) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '00:00', '23:59' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d;`);
// What prod holds that the slice chain above does not: shipping S1's column, the account fee flag
// (NOT NULL DEFAULT false since 20260418200319) and the platform's live fee (200).
await db.exec(`
  ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_fee_cents integer NOT NULL DEFAULT 200);
  INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);`);
// The bodies this migration restates, as prod holds them today, and the ID gate's exemption (read only as a control: the listing gate must NOT share it).
for (const fn of [...RESTATED, "identity_check_exempt"]) await db.exec(stmtOf(fn));
// A listing moved by its own seller (as the app's publish RPCs do, under the member's own uid).
await db.exec(`CREATE FUNCTION public.t_publish(p_id uuid, p_status text) RETURNS void LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public' AS $$ UPDATE public.declutter_items SET status = p_status WHERE id = p_id $$;
  GRANT EXECUTE ON FUNCTION public.t_publish(uuid, text) TO authenticated;`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(NEW_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function as(role, uid, sql) {
  try {
    await db.exec(`${uid ? `SET request.jwt.claim.sub = '${uid}';` : ""} SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const me = (uid, sql) => as("authenticated", uid, sql);
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `55555555-0000-0000-0000-${String(n).padStart(12, "0")}`;
const order = async (id) => { const r = await svc(`SELECT * FROM public.declutter_orders WHERE id = '${id}'`); return Array.isArray(r) ? r[0] : undefined; };
const flag = async (uid) => one(await svc(`SELECT onboarding_fee_paid FROM public.profiles WHERE user_id = '${uid}'`));
const setFlag = (uid, v) => svc(`UPDATE public.profiles SET onboarding_fee_paid = ${v} WHERE user_id = '${uid}'`);
async function cart(n, buyer, seller, price) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Fee item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
}
const checkout = async (buyer, seller) => (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'porch')`))[0];
const markPaid = (id, pi, cents) => svc(`SELECT public.declutter_mark_order_paid('${id}', '${pi}', ${cents}, now(), 100) AS r`);
const setupOf = async (id) => Number((await order(id))?.setup_fee_cents ?? NaN);

// 0. Applied 3 times: one of each constraint.
ok(one(await svc(`SELECT count(*)::int FROM pg_constraint WHERE conname IN ('declutter_orders_setup_fee', 'declutter_orders_setup_fee_state')`)) === 2,
  "applied 3 times: the two setup-fee constraints exist once each (replay-safe)");

// 1. A buyer who never paid the fee: $2 frozen on the order, OUTSIDE total_cents.
await setFlag(BUYER, false);
await cart(1, BUYER, SELLER, 4000);
const A = await checkout(BUYER, SELLER);
const Arow = await order(A?.order_id);
ok(A?.total_cents === 4000 + A?.premium_cents && Arow?.setup_fee_cents === 200,
  `first purchase: the $2 setup fee is frozen on the order (${Arow?.setup_fee_cents}), the sale's total stays items + buyer's fee (${A?.total_cents})`);
// A buyer who already paid it (Jobs first post, a payout, the fee page): no fee.
await setFlag(BUYER2, true);
await cart(2, BUYER2, SELLER, 3000);
const B = await checkout(BUYER2, SELLER);
ok(await setupOf(B?.order_id) === 0, "a buyer whose account already paid the fee is not charged it");

// 2. The payment must be the sale plus the fee: the sale alone is refunded as a wrong amount, nothing claimed.
await cart(3, BUYER3, SELLER2, 2000);
await setFlag(BUYER3, false);
const C = await checkout(BUYER3, SELLER2);
// A page opened by a declutter-checkout that did not know the fee yet (the migration deploys first): the sale
// stands, the fee is marked not charged, and nothing is claimed (lh-money-escrow review #1).
const short = one(await markPaid(C?.order_id, "pi_c_short", C?.total_cents));
ok(short?.result === "paid" && (await order(C?.order_id))?.setup_fee_state === "not_charged" && (await flag(BUYER3)) === false,
  `a payment of the sale alone (a page made without the fee) stands, the fee marked not charged, nothing claimed (${JSON.stringify(short)})`);
ok(one(await markPaid(C?.order_id, "pi_c_short", C?.total_cents)) ?.result === "already_paid", "  and a replay of it changes nothing");

// 3. The sale stands: total + fee is paid, the account's flag is claimed once.
const paidA = one(await markPaid(A?.order_id, "pi_a", A?.total_cents + 200));
const ArowPaid = await order(A?.order_id);
ok(paidA?.result === "paid" && ArowPaid?.status === "paid" && ArowPaid.setup_fee_state === "claimed" && (await flag(BUYER)) === true,
  `total + $2 is paid: the sale stands, the order claimed the fee, the account is marked paid (${JSON.stringify(paidA)}, ${ArowPaid?.setup_fee_state})`);
const replay = one(await markPaid(A?.order_id, "pi_a", A?.total_cents + 200));
ok(replay?.result === "already_paid" && (await order(A?.order_id))?.setup_fee_state === "claimed", "a replayed webhook changes nothing");

// 4. A second order frozen with the fee, paid AFTER the account paid it elsewhere: the fee goes back, once.
await setFlag(BUYER3, false);
await cart(4, BUYER3, SELLER, 2500);
const D = await checkout(BUYER3, SELLER);
ok(await setupOf(D?.order_id) === 200, "a second seller's checkout opened while the fee is unpaid also carries it");
await setFlag(BUYER3, true);   // paid in the meantime (Jobs, a payout, another order)
const paidD = one(await markPaid(D?.order_id, "pi_d", D?.total_cents + 200));
const Drow = await order(D?.order_id);
ok(paidD?.result === "paid" && Drow?.setup_fee_state === "refund_due",
  `paid after the account had paid the fee: the sale stands and the fee is marked to go back (${Drow?.setup_fee_state})`);
const knownBefore = Number(one(await svc(`SELECT public.declutter_order_refunds_recorded_cents('${D?.order_id}')`)));
const rec1 = one(await svc(`SELECT public.declutter_setup_fee_refunded('${D?.order_id}', 're_d1')`));
const rec2 = one(await svc(`SELECT public.declutter_setup_fee_refunded('${D?.order_id}', 're_d1')`));
const rec3 = one(await svc(`SELECT public.declutter_setup_fee_refunded('${D?.order_id}', 're_other')`));
const knownAfter = Number(one(await svc(`SELECT public.declutter_order_refunds_recorded_cents('${D?.order_id}')`)));
const told = Number(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${BUYER3}' AND title = 'Setup fee coming back'`)));
ok(rec1 === "recorded" && rec2 === "already" && rec3 === "other_refund" && told === 1,
  `the fee's refund is recorded once and the buyer told once (${rec1}/${rec2}/${rec3}, told ${told})`);
ok(knownBefore === 0 && knownAfter === 200,
  `the fee sent back counts as a known refund on the order's charge, so the seller's payout still sends (${knownBefore} -> ${knownAfter})`);
ok(one(await svc(`SELECT public.declutter_setup_fee_refunded('${A?.order_id}', 're_a')`)) === "not_due",
  "an order that kept its fee cannot be marked refunded");
// Stripe fails the fee's refund after taking it: the order owes it again and it stops counting as a known refund.
const rev1 = one(await svc(`SELECT public.declutter_setup_fee_refund_reversed('${D?.order_id}', 're_other')`));
const rev2 = one(await svc(`SELECT public.declutter_setup_fee_refund_reversed('${D?.order_id}', 're_d1')`));
const knownReversed = Number(one(await svc(`SELECT public.declutter_order_refunds_recorded_cents('${D?.order_id}')`)));
ok(rev1 === "not_this" && rev2 === "reopened" && (await order(D?.order_id))?.setup_fee_state === "refund_due" && knownReversed === 0,
  `a failed fee refund reopens the fee owed and stops counting it (${rev1}/${rev2}, known ${knownReversed})`);

// 5. A later refund of the sale keeps the setup fee (as a Jobs refund keeps a first job's fee).
const refundA = one(await svc(`SELECT public.declutter_refund_paid_order('${A?.order_id}', 'seller_backed_out') AS r`));
ok(refundA?.result === "refund" && refundA.refund_cents === A?.total_cents,
  `the seller backs out after the buyer paid: the sale (${A?.total_cents}) comes back, the $2 setup fee stays paid (${JSON.stringify(refundA)})`);

// 6. A refused payment (an order already closed) returns everything, fee included, and claims nothing.
await setFlag(BUYER2, false);
await cart(6, BUYER2, SELLER2, 1500);
const E = await checkout(BUYER2, SELLER2);
// Stripe timed the page out (the order closed), and a payment still lands on it.
const closedE = await svc(`UPDATE public.declutter_orders SET status = 'expired', close_reason = 'session_expired', closed_at = now()
  WHERE id = '${E?.order_id}' RETURNING id`);
ok(Array.isArray(closedE) && closedE.length === 1, "  (the order was closed by the test setup)");
const refusedE = one(await markPaid(E?.order_id, "pi_e", E?.total_cents + 200));
ok(refusedE?.result === "refund" && refusedE.refund_cents === E?.total_cents + 200 && (await flag(BUYER2)) === false
   && (await order(E?.order_id))?.setup_fee_state == null,
  `a payment on a closed order is refunded whole, setup fee included, and claims nothing (${JSON.stringify(refusedE)})`);

// 6b. The other 'paid' answer: paid in time, recorded after the deadline sweep closed the order (B41).
await setFlag(BUYER, false);
await cart(9, BUYER, SELLER2, 1800);
const F = await checkout(BUYER, SELLER2);
const sweptF = await svc(`WITH o AS (UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
    WHERE id = '${F?.order_id}' RETURNING id),
  c AS (UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE order_id = '${F?.order_id}' RETURNING item_id)
  UPDATE public.declutter_items SET status = 'live' WHERE id IN (SELECT item_id FROM c) RETURNING id`);
const paidF = one(await markPaid(F?.order_id, "pi_f", F?.total_cents + 200));
ok(Array.isArray(sweptF) && sweptF.length === 1 && paidF?.result === "paid" && (await order(F?.order_id))?.setup_fee_state === "claimed"
   && (await flag(BUYER)) === true,
  `paid in time but recorded after the sweep: the sale stands and claims the fee too (${JSON.stringify(paidF)})`);

// 7. The fee is frozen like every other amount the buyer was shown.
ok(refused(await svc(`UPDATE public.declutter_orders SET setup_fee_cents = 0 WHERE id = '${D?.order_id}'`), /order_amounts_frozen/),
  "an order's setup fee cannot be changed after checkout froze it");

// 8. An open order whose fee no longer matches is replaced (paid in Jobs since the page opened).
await setFlag(BUYER2, false);
await cart(8, BUYER2, SELLER, 1200);
const H1 = await checkout(BUYER2, SELLER);
const H1fee = await setupOf(H1?.order_id);
await setFlag(BUYER2, true);
const H2 = await checkout(BUYER2, SELLER);
ok(H1fee === 200 && H2?.order_id !== H1?.order_id && (await order(H1?.order_id))?.status === "superseded" && (await setupOf(H2?.order_id)) === 0,
  `the fee was paid elsewhere while a checkout was open: the open order is replaced by one without it (${H1fee} -> ${await setupOf(H2?.order_id)})`);

// 10. The first LISTING (owner 2026-10-23, #3557 answer 1): by card at the first listing, never if already paid.
await db.exec(liveItemSql({ id: I(20), seller: SELLER2, title: "Draft lamp", price: 1500, floor: 1000 }));
await svc(`UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(20)}'`);
await setFlag(SELLER2, false);
const listUnpaid = await me(SELLER2, `SELECT public.t_publish('${I(20)}', 'live')`);
const stillDraft = one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(20)}'`)) === "draft";
ok(refused(listUnpaid, /setup_fee_required_to_list/) && stillDraft,
  `a seller who never paid the setup fee cannot put their first listing up (${JSON.stringify(listUnpaid)})`);
ok(refused(await me(SELLER2, `SELECT public.t_publish('${I(20)}', 'pending_review')`), /setup_fee_required_to_list/),
  "  nor send it to review");
await setFlag(SELLER2, true);   // paid for Jobs (or on the fee page): never asked again
ok(Array.isArray(await me(SELLER2, `SELECT public.t_publish('${I(20)}', 'live')`))
   && one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(20)}'`)) === "live",
  "a seller whose account already paid the fee (for Jobs or anything else) lists freely");
await setFlag(SELLER2, false);
await svc(`UPDATE public.declutter_items SET status = 'paused' WHERE id = '${I(20)}'`);
ok(Array.isArray(await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(20)}' RETURNING id`)),
  "a server write (a sale's own system putting an item back on sale) is never asked");

// 10b. The ID switch never waives the fee (2026-10-26 rebase): identity_check is off here, so
// identity_check_exempt() is true for this seller, yet the listing above was refused.
ok(one(await svc(`SELECT public.identity_check_exempt('${SELLER2}')`)) === true,
  "control: the ID switch is off, so the ID gate's exemption is true for a plain member (it must not waive the fee)");
// An enrolled test account (is_seed AND test_accounts) is never asked, like the ID gate.
const { SELLER3 } = USERS;
await db.exec(liveItemSql({ id: I(21), seller: SELLER3, title: "Tester lamp", price: 1500, floor: 1000 }));
await svc(`UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(21)}'`);
await setFlag(SELLER3, false);
ok(Array.isArray(await me(SELLER3, `SELECT public.t_publish('${I(21)}', 'live')`))
   && one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(21)}'`)) === "live",
  "an enrolled test account lists without the fee");

// 9. Members cannot call the helpers.
for (const [fn, args] of [["declutter_claim_setup_fee", `'${A?.order_id}'`], ["declutter_setup_fee_before_list", ""],
  ["declutter_setup_fee_refund_reversed", `'${A?.order_id}', 're_x'`], ["declutter_setup_fee_refunded", `'${A?.order_id}', 're_x'`],
  ["declutter_setup_fee_due_cents", `'${BUYER}'`]]) {
  ok(refused(await me(BUYER, `SELECT public.${fn}(${args})`), /permission denied/), `a member cannot call ${fn}`);
  ok(refused(await as("anon", null, `SELECT public.${fn}(${args})`), /permission denied/), `anon cannot call ${fn}`);
}

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
process.exit(fail ? 1 : 0);
