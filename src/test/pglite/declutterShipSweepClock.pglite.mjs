/**
 * Q1424 PGlite proof: declutter_ship_sweep's three clock windows, on a fixed clock (./lib/fixedClock.mjs, newest CREATE
 * of the sweep and of declutter_ship_by). shippingNeverShippedSweep / shippingS5DeliveredPayout / shippingLostSweep
 * move paid_at, delivered_at and accepted_at relative to now(); this one moves the clock and reads each edge 1 ms
 * either side:
 *   delivered    s.delivered_at + 24 h <= now   (exactly 24 h after the delivered scan: handed over; 1 ms before: not)
 *   never sent   now >= declutter_ship_by(paid_at): the end of the 3rd Louisiana business day after payment
 *                (11:59:59 PM Central; weekends skipped), in CDT and across the fall-back Sunday (CST deadline)
 *   lost         s.accepted_at + 10 days <= now  (exactly 10 days after the carrier took it, no delivered scan: closed
 *                as lost; 1 ms before: not)
 *
 *   node src/test/pglite/declutterShipSweepClock.pglite.mjs
 *   SHIP_DELIVERED_STRICT=1 node src/test/pglite/declutterShipSweepClock.pglite.mjs  # RED: 24 h edge made strict
 *   SHIP_BY_UTC=1 node src/test/pglite/declutterShipSweepClock.pglite.mjs            # RED: ship-by days counted in UTC
 *   SHIP_LOST_STRICT=1 node src/test/pglite/declutterShipSweepClock.pglite.mjs       # RED: 10-day edge made strict
 *
 * declutter_lock_order, declutter_complete_handover and declutter_close_paid_order (their own money proofs) are
 * stubbed to record what was asked. pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
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
CREATE TABLE public.declutter_orders (
  id uuid PRIMARY KEY, status text DEFAULT 'paid', handover text DEFAULT 'ship', ship_capture text DEFAULT 'captured', paid_at timestamptz);
CREATE TABLE public.shipments (
  declutter_order_id uuid, label_state text DEFAULT 'bought', label_mode text DEFAULT 'test', tracking_status text,
  delivered_at timestamptz, accepted_at timestamptz, last_error text, next_attempt_at timestamptz);
CREATE TABLE public.declutter_problems (order_id uuid, status text);
CREATE TABLE public.calls (what text);
CREATE FUNCTION public.declutter_lock_order(p uuid) RETURNS public.declutter_orders LANGUAGE sql AS $$ SELECT * FROM public.declutter_orders WHERE id = p $$;
CREATE FUNCTION public.declutter_complete_handover(p uuid, p_by text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('handed_over:' || p_by) $$;
CREATE FUNCTION public.declutter_close_paid_order(p uuid, p_reason text, p_fault text, p_strike text, p_note text) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('closed:' || p_reason) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('defect:' || a || ':' || c) $$;
`);
const shipBy = newestFunction("declutter_ship_by");
const sweepFn = newestFunction("declutter_ship_sweep");
let helper = onFixedClock(shipBy.stmt);
const base = onFixedClock(sweepFn.stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${sweepFn.file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
check(`declutter_ship_by reads no clock of its own (${shipBy.file})`, !/_probe_now\(\)/.test(helper));
let mutated = false;
const swap = (env, where, from, to) => {
  if (!process.env[env]) return where;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is there`, where.includes(from));
  mutated = true;
  return where.split(from).join(to);
};
fixed = swap("SHIP_DELIVERED_STRICT", fixed, "s.delivered_at + interval '24 hours' <= public._probe_now()", "s.delivered_at + interval '24 hours' < public._probe_now()");
fixed = swap("SHIP_LOST_STRICT", fixed, "s.accepted_at + interval '10 days' <= public._probe_now()", "s.accepted_at + interval '10 days' < public._probe_now()");
helper = swap("SHIP_BY_UTC", helper, "AT TIME ZONE 'America/Chicago'", "AT TIME ZONE 'UTC'");
check("the mutation (if any) applied", !mutated || fixed !== base || helper !== onFixedClock(shipBy.stmt));
// Replay-safe: applies 3x (the REVOKE/GRANT tails need the three roles created above).
for (let i = 0; i < 3; i++) { await db.exec(helper); await db.exec(fixed); }

const ORDER = "55555555-5555-4555-8555-555555555555";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const H = 3_600_000;
const D = 24 * H;
const seed = async ({ paidAt, deliveredAt = null, acceptedAt = null, status = null }) => {
  await db.exec(`DELETE FROM public.calls; DELETE FROM public.shipments; DELETE FROM public.declutter_orders;`);
  await q(`INSERT INTO public.declutter_orders (id, paid_at) VALUES ($1, $2)`, [ORDER, iso(paidAt)]);
  await q(`INSERT INTO public.shipments (declutter_order_id, delivered_at, accepted_at, tracking_status) VALUES ($1, $2, $3, $4)`,
    [ORDER, iso(deliveredAt), iso(acceptedAt), status ?? (deliveredAt ? "delivered" : acceptedAt ? "in_transit" : null)]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.declutter_ship_sweep() AS r`))[0].r;
  const calls = (await q(`SELECT what FROM public.calls`)).map((c) => c.what);
  const [{ ls }] = await q(`SELECT label_state ls FROM public.shipments`);
  return { r, calls, ls };
};

// 1. The delivered scan + 24 h.
{
  const del = Date.UTC(2026, 6, 15, 18, 0, 0);
  await seed({ paidAt: del - 3 * D, acceptedAt: del - 2 * D, deliveredAt: del });
  const early = await sweep(del + 24 * H - 1);
  check("delivered 24 h minus 1 ms ago: not handed over yet", early.calls.length === 0, JSON.stringify(early));
  await seed({ paidAt: del - 3 * D, acceptedAt: del - 2 * D, deliveredAt: del });
  const at = await sweep(del + 24 * H);
  check("delivered exactly 24 h ago: handed over automatically", at.calls[0] === "handed_over:auto" && at.r.delivered_handed_over === 1, JSON.stringify(at));
}
// 2. Never shipped by the ship-by deadline.
const shipCases = [
  // Paid Wed 15 July (CDT): Thu, Fri, Mon 20 July -> deadline 11:59:59 PM CDT Mon 20 July = 04:59:59Z Tue 21 July.
  { name: "paid Wed 15 July, CDT", paid: Date.UTC(2026, 6, 15, 20, 0, 0), deadline: Date.UTC(2026, 6, 21, 4, 59, 59) },
  // Paid Fri 30 Oct 9:30 PM CDT (02:30Z Sat in UTC): Mon 2, Tue 3, Wed 4 Nov -> 11:59:59 PM CST Wed 4 Nov = 05:59:59Z Thu 5 Nov.
  { name: "paid Fri 30 Oct 9:30 PM CDT (already Saturday in UTC), deadline after the fall-back Sunday", paid: Date.UTC(2026, 9, 31, 2, 30, 0), deadline: Date.UTC(2026, 10, 5, 5, 59, 59) },
];
for (const c of shipCases) {
  await seed({ paidAt: c.paid });
  const early = await sweep(c.deadline - 1);
  check(`${c.name}: 1 ms before the ship-by deadline: still open`, early.calls.length === 0, JSON.stringify(early));
  await seed({ paidAt: c.paid });
  const at = await sweep(c.deadline);
  check(`${c.name}: at the ship-by deadline: closed as backed out, test label voided`,
    at.calls[0] === "closed:seller_backed_out" && at.ls === "void_requested" && at.r.never_shipped_closed === 1, JSON.stringify(at));
}
// 3. Lost: accepted 10 days ago, never delivered.
{
  const acc = Date.UTC(2026, 6, 5, 16, 0, 0);
  await seed({ paidAt: acc - D, acceptedAt: acc });
  const early = await sweep(acc + 10 * D - 1);
  check("accepted 10 days minus 1 ms ago, no delivered scan: not lost yet", early.calls.length === 0, JSON.stringify(early));
  await seed({ paidAt: acc - D, acceptedAt: acc });
  const at = await sweep(acc + 10 * D);
  check("accepted exactly 10 days ago, no delivered scan: closed as lost", at.calls[0] === "closed:ship_lost" && at.r.lost_closed === 1, JSON.stringify(at));
  await seed({ paidAt: acc - D, acceptedAt: acc, status: "available_for_pickup" });
  const held = await sweep(acc + 10 * D);
  check("waiting at the post office: never closed as lost", held.calls.length === 0, JSON.stringify(held));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
