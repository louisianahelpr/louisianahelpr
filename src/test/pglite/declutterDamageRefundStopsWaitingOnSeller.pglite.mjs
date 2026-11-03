#!/usr/bin/env node
/**
 * PGlite proof for 20261103225232_declutter_damage_refund_stops_waiting_on_seller (Q1934): a damaged-in-delivery
 * refund no longer waits for good on the seller's payout. It is due at once when that payout is held (an admin payout
 * hold, or a 'held' wait), rejected or unusable; 3 days after it was recorded whatever else the payout waits on; and,
 * as before, once the payout has gone. Every other refund reason is unchanged.
 *
 *   node src/test/pglite/declutterDamageRefundStopsWaitingOnSeller.pglite.mjs                     # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDamageRefundStopsWaitingOnSeller.pglite.mjs  # RED: the old queue
 *
 * Real: the 20261019070737 body verbatim (its prosrc md5 checked against prod, read-only 11-03), then this migration
 * 3x. Tables reduced to the columns read. pglite loads from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103225232_declutter_damage_refund_stops_waiting_on_seller.sql";
const OLD = "20261019070737_payout_waits_for_payee_setup.sql";
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, stripe_checkout_session_id text);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY, order_id uuid, reason text, stripe_payment_intent_id text,
  refund_cents integer, attempts integer DEFAULT 0, payment_livemode boolean, status text,
  created_at timestamptz DEFAULT now(), next_attempt_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, status text);
CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid, category text, PRIMARY KEY (payout_kind, payout_id));
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY);
`);
const old = readFileSync(MIG_DIR + OLD, "utf8");
const a = old.indexOf("CREATE OR REPLACE FUNCTION public.declutter_refunds_due(");
await db.exec(old.slice(a, old.indexOf("$fn$;", a) + 5));
const m = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = 'declutter_refunds_due'`)).rows[0].m;
check(m === "a36dc18618a3cadeb079b297ce0018b6", "the old body rebuilt here is prod's (prosrc md5 a36dc186)", m);
if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  let applied = true;
  for (let i = 0; i < 3; i++) { try { await db.exec(sql); } catch (e) { applied = false; check(false, `migration applies (run ${i + 1})`, e.message); } }
  check(applied, "migration applies 3x");
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
// One order per case: n = order, 100+n = refund, 200+n = payout, 300+n = seller.
const seed = async (n, { reason = "delivery_damage", ageHours = 1, payout = "pending", wait = null, hold = false } = {}) => {
  await q(`INSERT INTO public.declutter_orders VALUES ($1, $2, $3, 'cs_x')`, [id(n), id(900), id(300 + n)]);
  await q(`INSERT INTO public.declutter_refunds (id, order_id, reason, stripe_payment_intent_id, refund_cents, status, created_at, next_attempt_at)
           VALUES ($1, $2, $3, 'pi_x', 2500, 'pending', now() - make_interval(hours => $4), now() - interval '1 minute')`,
    [id(100 + n), id(n), reason, ageHours]);
  if (payout) await q(`INSERT INTO public.declutter_payouts VALUES ($1, $2, $3, $4)`, [id(200 + n), id(n), id(300 + n), payout]);
  if (wait) await q(`INSERT INTO public.payout_payee_waits VALUES ('declutter', $1, $2)`, [id(200 + n), wait]);
  if (hold) await q(`INSERT INTO public.payout_holds VALUES ($1)`, [id(300 + n)]);
};
await seed(1, { payout: "pending" });                       // waiting, fresh: still waits
await seed(2, { payout: "failed", wait: "transient" });     // failing and retrying, fresh: still waits
await seed(3, { payout: "pending", wait: "held" });         // a 'held' wait: due now
await seed(4, { payout: "pending", hold: true });           // an admin payout hold on the seller: due now
await seed(5, { payout: "failed", wait: "rejected" });      // Stripe rejected the account: due now
await seed(6, { payout: "pending", wait: "unusable" });     // the account can no longer be used: due now
await seed(7, { payout: "pending", wait: "no_account", ageHours: 73 }); // over 3 days: due
await seed(8, { payout: "failed", wait: "transient", ageHours: 71 });  // just under 3 days: still waits
await seed(9, { payout: "succeeded" });                     // the payout went: due (unchanged)
await seed(10, { reason: "seller_backed_out", payout: "pending" }); // another reason: due (unchanged)
await seed(11, { payout: "pending", wait: "setup_unfinished" }); // fresh, a reason the seller can fix: still waits

const due = new Set((await q(`SELECT refund_id FROM public.declutter_refunds_due(100)`)).map((r) => r.refund_id));
const isDue = (n) => due.has(id(100 + n));
check(!isDue(1), "a fresh damage refund still waits for a payout that is simply pending");
check(!isDue(2), "a fresh damage refund still waits for a payout that is failing and retrying");
check(!isDue(11), "a fresh damage refund still waits while the seller finishes payout setup");
check(isDue(3), "due at once: the seller payout waits as 'held'");
check(isDue(4), "due at once: the seller is on an admin payout hold");
check(isDue(5), "due at once: Stripe rejected the seller's payout account");
check(isDue(6), "due at once: the seller's payout account can no longer be used");
check(isDue(7), "due after 3 days, whatever the payout still waits on");
check(!isDue(8), "not before 3 days for a payout that is only failing and retrying");
check(isDue(9), "unchanged: due once the seller payout has gone");
check(isDue(10), "unchanged: other refund reasons never wait on the seller");
const g = (await q(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS s FROM pg_proc p WHERE p.proname = 'declutter_refunds_due'`))[0];
check(g && !g.a && !g.u && g.s, "grants: service_role only", JSON.stringify(g));
const after = (await q(`SELECT md5(prosrc) AS ps, md5(pg_get_functiondef(oid)) AS fd FROM pg_proc WHERE proname = 'declutter_refunds_due'`))[0];
console.log(`md5 after: prosrc ${after.ps} functiondef ${after.fd}`);

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
