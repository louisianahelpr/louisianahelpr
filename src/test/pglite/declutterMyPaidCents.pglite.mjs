#!/usr/bin/env node
/**
 * PGlite proof for 20261029161237_declutter_my_paid_cents (A1-B2 (b), Declutter
 * audit on prod 2026-10-29: Stripe charged $34.20, the app then said "You paid
 * $32.20", because the one-time setup fee sits outside total_cents).
 *
 *   npx tsx src/test/pglite/declutterMyPaidCents.pglite.mjs                     # all PASS (migration applied 3x)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterMyPaidCents.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> npx tsx src/test/pglite/declutterMyPaidCents.pglite.mjs
 *
 * Base: Declutter slices 1-5 (scripts/declutter/slice3Harness.mjs), the chain
 * declutterSetupFeeOnce.pglite.mjs replays, then the setup-fee migration
 * itself (20261026154738, verbatim) and this migration 3x.
 *
 * Proves: the buyer reads total + setup fee for a fee that stood ('claimed'
 * or not settled yet), total alone for 'not_charged', 'refund_due' and
 * 'refunded', and total alone with no fee on the order; the seller and any
 * other member read nothing for the same ids; anon cannot call it; an ordinary
 * member outside the Declutter switch is refused (feature_disabled); the grant
 * is by role name; it writes nothing.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const NEW_FILE = "20261029161237_declutter_my_paid_cents.sql";
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

// Orders as checkout leaves them: $40 items + $2.70 buyer's fee = $42.70 sale (total_cents), the $2 setup fee outside it.
// seed-policy: not prod (throwaway PGlite only)
const orderSql = (n, { buyer = BUYER, setup = 200, state = null, status = "paid" } = {}) => `
  INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, premium_cents, tax_cents,
    total_cents, setup_fee_cents, setup_fee_state)
  VALUES ('${O(n)}', '${buyer}', '${SELLER}', '${status}', 'pickup_home', 4000, 270, 0, 4270, ${setup}, ${state === null ? "NULL" : `'${state}'`});`;
const seeded = await db.exec([
  orderSql(1, { state: "claimed" }),
  orderSql(2, { state: null }),
  orderSql(3, { state: "not_charged" }),
  orderSql(4, { state: "refund_due" }),
  orderSql(5, { state: "refunded" }),
  orderSql(6, { setup: 0 }),
  orderSql(7, { buyer: BUYER2, state: "claimed" }),
].join("\n")).then(() => ({}), (e) => ({ error: String(e.message ?? e) }));
ok(!seeded.error && Number(one(await svc(`SELECT count(*)::int FROM public.declutter_orders`))) === 7, `fixture: seven orders seeded ${seeded.error ?? ""}`);

const ALL = `ARRAY['${[1, 2, 3, 4, 5, 6, 7].map(O).join("','")}']::uuid[]`;
const call = `SELECT order_id::text AS order_id, paid_cents FROM public.declutter_my_paid_cents(${ALL}) ORDER BY order_id`;
const r = await as("authenticated", BUYER, call);
const paid = Array.isArray(r) ? Object.fromEntries(r.map((x) => [x.order_id, Number(x.paid_cents)])) : {};
ok(Array.isArray(r), `the buyer can call it ${r?.error ?? ""}`);
ok(paid[O(1)] === 4470, `claimed setup fee: You paid $44.70 = the Stripe charge (got ${paid[O(1)]})`);
ok(paid[O(2)] === 4470, `fee charged, sale not settled yet: $44.70 (got ${paid[O(2)]})`);
ok(paid[O(3)] === 4270, `not_charged (the page did not carry it): $42.70 (got ${paid[O(3)]})`);
ok(paid[O(4)] === 4270, `refund_due (another path paid the account's fee first): $42.70 (got ${paid[O(4)]})`);
ok(paid[O(5)] === 4270, `refunded: $42.70 (got ${paid[O(5)]})`);
ok(paid[O(6)] === 4270, `no setup fee on the order: $42.70 (got ${paid[O(6)]})`);
ok(!(O(7) in paid) && Object.keys(paid).length === 6, `another buyer's order answers nothing (${Object.keys(paid).length} rows)`);

const asSeller = await as("authenticated", SELLER, call);
ok(Array.isArray(asSeller) && asSeller.length === 0, `the seller of the same orders reads nothing (${JSON.stringify(asSeller)})`);
const asOther = await as("authenticated", BUYER2, call);
ok(Array.isArray(asOther) && asOther.length === 1 && asOther[0].order_id === O(7), "another member reads only their own order");
ok(refused(await as("anon", null, call), /permission denied/), "anon cannot call it");
ok(refused(await as("authenticated", OUTSIDER, call), /feature_disabled/), "an ordinary member outside the Declutter switch is refused");
ok(refused(await as("authenticated", null, call), /feature_disabled|not_authenticated/), "no caller: refused");
const big = `SELECT * FROM public.declutter_my_paid_cents(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)))`;
ok(refused(await as("authenticated", BUYER, big), /too_many_orders/), "more than 200 ids: refused");

const acl = await svc(`SELECT proacl::text AS acl, prosecdef, provolatile FROM pg_proc WHERE proname = 'declutter_my_paid_cents'`);
const a = Array.isArray(acl) ? acl[0] : undefined;
ok(!!a && /authenticated=X/.test(a.acl) && /service_role=X/.test(a.acl) && !/anon=/.test(a.acl) && !/(^|[{,])=X/.test(a.acl),
  `grants by role name: authenticated + service_role, not anon or PUBLIC (${a?.acl})`);
ok(a?.provolatile === "s", "STABLE: a read, it cannot write");
const before = await svc(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h FROM public.declutter_orders t`);
await as("authenticated", BUYER, call);
const after = await svc(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h FROM public.declutter_orders t`);
ok(before?.[0]?.h === after?.[0]?.h, "calling it changes no order");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
