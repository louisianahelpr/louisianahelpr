#!/usr/bin/env node
/**
 * PGlite proof for 20261102033426_declutter_my_refunded_cents (A3-112 follow-up, audit 2026-11-01: a PART refund
 * left a Declutter order at its whole charge in Money > Spent and Receipts).
 *
 *   npx tsx src/test/pglite/declutterMyRefundedCents.pglite.mjs                     # all PASS (migration applied 3x)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterMyRefundedCents.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> npx tsx src/test/pglite/declutterMyRefundedCents.pglite.mjs
 *
 * Base: Declutter slices 1-5 (scripts/declutter/slice3Harness.mjs), the chain
 * declutterSetupFeeOnce.pglite.mjs replays, then the setup-fee migration
 * itself (20261026154738, verbatim) and this migration 3x.
 *
 * Proves, per order, the money sent back for the ORDER'S OWN payment: a succeeded refund row counts; pending and
 * failed rows count nothing; a row settled by a hand refund counts once (the hand refund), not twice; live hand
 * refunds count (one recorded with no row, one on top of a row already sent), a failed one does not; a succeeded
 * delivery-fee refund counts; a refund of a duplicate payment (another payment id) does not; nothing refunded = 0.
 * The seller and other members read nothing; an order with no payment answers nothing; anon is refused even with
 * Supabase's default EXECUTE grant emulated (ALTER DEFAULT PRIVILEGES ... TO anon); outside the Declutter switch is
 * refused; > 200 ids is refused; grants by role name; STABLE; it writes nothing.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const NEW_FILE = "20261102033426_declutter_my_refunded_cents.sql";
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
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
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, BUYER2, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const NEW_SQL = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");

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
for (const sql of stmts) await db.exec(sql);
// What prod holds that the slice chain lacks and the setup-fee migration reads (as declutterSetupFeeOnce's proof).
await db.exec(`
  ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_fee_cents integer NOT NULL DEFAULT 200);
  INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);`);
await db.exec(readFileSync(`${MIG_DIR}${SETUP_FEE_FILE}`, "utf8"));
// Supabase grants EXECUTE on every new public function to anon and authenticated by default; emulate it, so only the
// migration's own REVOKE can keep anon out.
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
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
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const O = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;

// Orders as checkout leaves them ($42.70), each with its own payment id; O(9) was never paid (no payment id).
// seed-policy: not prod (throwaway PGlite only)
const orderSql = (n, { buyer = BUYER, pi = `pi_order${n}` } = {}) => `
  INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, premium_cents, tax_cents,
    total_cents, stripe_payment_intent_id)
  VALUES ('${O(n)}', '${buyer}', '${SELLER}', 'paid', 'pickup_home', 4000, 270, 0, 4270, ${pi === null ? "NULL" : `'${pi}'`});`;
// A refund row. The base chain's amount CHECK ties refund_cents to paid_cents, so a part refund is written with
// paid_cents = the part (the read sums refund_cents only; the real part-refund row is 20261026155251's shape).
const refundSql = (n, cents, status, { pi = `pi_order${n}`, ref = null } = {}) => `
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
    refund_cents, status, stripe_refund_ref)
  VALUES ('${O(n)}', '${pi}', 'order_closed', 'full_platform_absorbs', ${cents}, 0, ${cents}, '${status}', ${ref ? `'${ref}'` : "NULL"});`;
const handSql = (n, id, cents, outcome, { failed = false, row = null } = {}) => `
  INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, refund_row_id, amount_cents,
    livemode, hand_outcome, failed_at)
  VALUES ('${id}', 'pi_order${n}', '${O(n)}', ${row ? `(SELECT id FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_order${n}')` : "NULL"},
    ${cents}, true, '${outcome}', ${failed ? "now()" : "NULL"});`;
const deliverySql = (n, cents, status) => `
  INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents, status)
  VALUES ('${O(n)}', 'pi_order${n}', 'no_helpr', ${cents}, '${status}');`;
const seeded = await db.exec([
  ...[1, 2, 3, 4, 5, 6, 7, 10].map((n) => orderSql(n)),
  orderSql(8, { buyer: BUYER2 }),
  orderSql(9, { pi: null }),
  refundSql(1, 1500, "succeeded"),
  refundSql(2, 1500, "pending"),
  refundSql(3, 1500, "failed"),
  refundSql(4, 1500, "succeeded", { ref: "re_hand4" }),
  handSql(4, "re_hand4", 1500, "settled", { row: true }),
  handSql(5, "re_hand5", 700, "recorded"),
  handSql(5, "re_hand5b", 300, "recorded", { failed: true }),
  deliverySql(6, 500, "succeeded"),
  refundSql(6, 4270, "succeeded", { pi: "pi_duplicate6" }),
  refundSql(8, 1000, "succeeded"),
  refundSql(10, 1500, "succeeded", { ref: "re_auto10" }),
  handSql(10, "re_hand10", 200, "recorded", { row: true }),
].join("\n")).then(() => ({}), (e) => ({ error: String(e.message ?? e) }));
ok(!seeded.error && Number(one(await svc(`SELECT count(*)::int FROM public.declutter_orders`))) === 10, `fixture: ten orders seeded ${seeded.error ?? ""}`);

const ALL = `ARRAY['${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(O).join("','")}']::uuid[]`;
const call = `SELECT order_id::text AS order_id, refunded_cents FROM public.declutter_my_refunded_cents(${ALL}) ORDER BY order_id`;
const r = await as("authenticated", BUYER, call);
const got = Array.isArray(r) ? Object.fromEntries(r.map((x) => [x.order_id, Number(x.refunded_cents)])) : {};
ok(Array.isArray(r), `the buyer can call it ${r?.error ?? ""}`);
ok(got[O(1)] === 1500, `a succeeded part refund: $15.00 back (got ${got[O(1)]})`);
ok(got[O(2)] === 0, `a pending refund: nothing back yet (got ${got[O(2)]})`);
ok(got[O(3)] === 0, `a failed refund: nothing back (got ${got[O(3)]})`);
ok(got[O(4)] === 1500, `a row settled by a hand refund counts once, $15.00, not $30.00 (got ${got[O(4)]})`);
ok(got[O(5)] === 700, `a live hand refund with no row counts, a failed one does not: $7.00 (got ${got[O(5)]})`);
ok(got[O(6)] === 500, `the delivery fee back counts; a duplicate payment's refund (another payment) does not: $5.00 (got ${got[O(6)]})`);
ok(got[O(7)] === 0, `nothing refunded: 0, so the client can tell none from not read (got ${got[O(7)]})`);
ok(got[O(10)] === 1700, `a hand refund on top of a row already sent: both left the card, $17.00 (got ${got[O(10)]})`);
ok(!(O(8) in got) && !(O(9) in got) && Object.keys(got).length === 8, `another buyer's order and an unpaid one answer nothing (${Object.keys(got).length} rows)`);

const asSeller = await as("authenticated", SELLER, call);
ok(Array.isArray(asSeller) && asSeller.length === 0, `the seller of the same orders reads nothing (${JSON.stringify(asSeller)})`);
const asOther = await as("authenticated", BUYER2, call);
ok(Array.isArray(asOther) && asOther.length === 1 && asOther[0].order_id === O(8) && Number(asOther[0].refunded_cents) === 1000, "another member reads only their own order");
ok(refused(await as("anon", null, call), /permission denied/), "anon cannot call it (default EXECUTE grant emulated)");
ok(refused(await as("authenticated", OUTSIDER, call), /feature_disabled/), "an ordinary member outside the Declutter switch is refused");
ok(refused(await as("authenticated", null, call), /feature_disabled|not_authenticated/), "no caller: refused");
const big = `SELECT * FROM public.declutter_my_refunded_cents(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)))`;
ok(refused(await as("authenticated", BUYER, big), /too_many_orders/), "more than 200 ids: refused");

const acl = await svc(`SELECT proacl::text AS acl, prosecdef, provolatile FROM pg_proc WHERE proname = 'declutter_my_refunded_cents'`);
const a = Array.isArray(acl) ? acl[0] : undefined;
ok(!!a && /authenticated=X/.test(a.acl) && /service_role=X/.test(a.acl) && !/anon=/.test(a.acl) && !/(^|[{,])=X/.test(a.acl),
  `grants by role name: authenticated + service_role, not anon or PUBLIC (${a?.acl})`);
ok(a?.provolatile === "s", "STABLE: a read, it cannot write");
const hash = `SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
  SELECT t::text AS x FROM public.declutter_orders t UNION ALL SELECT t::text FROM public.declutter_refunds t
  UNION ALL SELECT t::text FROM public.declutter_hand_refunds t UNION ALL SELECT t::text FROM public.declutter_delivery_refunds t) s`;
const before = await svc(hash);
await as("authenticated", BUYER, call);
const after = await svc(hash);
ok(!!before?.[0]?.h && before?.[0]?.h === after?.[0]?.h, "calling it changes no order or refund row");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
