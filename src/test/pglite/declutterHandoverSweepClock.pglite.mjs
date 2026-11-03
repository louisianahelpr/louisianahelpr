/**
 * Q1424 PGlite proof: declutter_handover_sweep's clock windows, on a fixed clock (./lib/fixedClock.mjs, newest CREATE
 * of the sweep, declutter_pickup_anchor and declutter_seller_delivery_rules). declutterSlice4.pglite.mjs moves
 * slot_start / created_at relative to now(); this one moves the clock and reads each edge 1 ms either side:
 *   (a) auto-pay      a door sale: the pickup time + 24 h AND the seller's "Picked up" + 24 h, both <= now;
 *                     a porch sale on a picked day: the Louisiana midnight after the day + 24 h and the photo + 24 h
 *   (b) never booked  paid_at + 7 days <= now with no time booked: closed as the buyer's no-show
 *   (b2) delivery     a seller delivery still needing a time at book_by: closed
 *   (c) delivered     a seller delivery's delivered_at + 24 h (the rules' auto_confirm_hours): finished
 *   (d) reminders     a booked delivery 24 h out: the 24 h reminder; 24 h + 1 ms: none
 *   (e) no answer     the buyer's no-show report with no answer at no_show_answer_by: closed (seller's fault)
 *   (f) held          nobody said anything 24 h after the time: both nudged; again only 7 days later
 * none of them 1 ms early.
 *
 *   node src/test/pglite/declutterHandoverSweepClock.pglite.mjs
 *   HANDOVER_PAY_STRICT=1 ...       # RED: the seller's "Picked up" + 24 h edge made strict (both reads)
 *   HANDOVER_NOSHOW_STRICT=1 ...    # RED: the 7-day unbooked edge made strict
 *   HANDOVER_ANCHOR_UTC=1 ...       # RED: a picked day's midnight read in UTC
 *   HANDOVER_NUDGE_STRICT=1 ...     # RED: the weekly re-nudge edge made strict
 *
 * The money and notice helpers (complete_handover, close_paid_order, notices, codes) have their own proofs and are
 * stubbed to record the call. pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
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
  id uuid PRIMARY KEY, status text DEFAULT 'paid', handover text, paid_at timestamptz, book_by timestamptz,
  buyer_id uuid DEFAULT gen_random_uuid(), seller_id uuid DEFAULT gen_random_uuid(), is_seed boolean DEFAULT false, paid_with text DEFAULT 'card');
CREATE TABLE public.declutter_bookings (order_id uuid PRIMARY KEY, slot_start timestamptz, pickup_day date);
CREATE TABLE public.declutter_handovers (
  order_id uuid PRIMARY KEY, code text, set_out_photo_path text, set_out_at timestamptz, no_show_reported_at timestamptz,
  no_show_answer_by timestamptz, seller_confirmed_at timestamptz, held_nudged_at timestamptz);
CREATE TABLE public.declutter_problems (order_id uuid, status text, reporter_id uuid, reporter_side text, reason text, note text, photo_paths text[]);
CREATE TABLE public.declutter_seller_deliveries (
  order_id uuid PRIMARY KEY, status text, delivered_at timestamptz, handoff text, slot_start timestamptz, slot_end timestamptz,
  buyer_id uuid, seller_id uuid, dropoff_area text, reminded_hours int[] DEFAULT '{}', updated_at timestamptz);
CREATE TABLE public.test_accounts (user_id uuid);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notification_preferences (user_id uuid, declutter_pickups boolean);
CREATE TABLE public.calls (what text);
CREATE FUNCTION public.declutter_lock_order(p uuid) RETURNS public.declutter_orders LANGUAGE sql AS $$ SELECT * FROM public.declutter_orders WHERE id = p $$;
CREATE FUNCTION public.declutter_complete_handover(p uuid, by text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('complete:' || by) $$;
CREATE FUNCTION public.declutter_close_paid_order(p uuid, why text, fault text, strike text, note text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('close:' || why) $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('notify:' || p_title) $$;
CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('notify:' || p_title) $$;
CREATE FUNCTION public.declutter_pickup_remind(p_user uuid, p_title text, p_body text, p_link text, p_other uuid) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('remind:' || p_title) $$;
CREATE FUNCTION public.declutter_delivery_when(t timestamptz) RETURNS text LANGUAGE sql AS $$ SELECT 'tomorrow' $$;
CREATE FUNCTION public.declutter_new_handover_code() RETURNS text LANGUAGE sql AS $$ SELECT '1234' $$;
CREATE FUNCTION public.declutter_held_address_closed(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('defect:' || c) $$;
`);
const anchor = newestFunction("declutter_pickup_anchor");
const rules = newestFunction("declutter_seller_delivery_rules");
const sweepFn = newestFunction("declutter_handover_sweep");
let anchorSql = onFixedClock(anchor.stmt);
const base = onFixedClock(sweepFn.stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${sweepFn.file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
check(`the helpers read no clock (${anchor.file}, ${rules.file})`, !/_probe_now\(\)/.test(anchorSql) && !/_probe_now\(\)/.test(onFixedClock(rules.stmt)));
let mutated = false;
const swap = (env, where, from, to) => {
  if (!process.env[env]) return where;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is there`, where.includes(from));
  mutated = true;
  return where.split(from).join(to);
};
fixed = swap("HANDOVER_PAY_STRICT", fixed, "h.seller_confirmed_at + interval '24 hours' <= public._probe_now()", "h.seller_confirmed_at + interval '24 hours' < public._probe_now()");
fixed = swap("HANDOVER_NOSHOW_STRICT", fixed, "o2.paid_at + interval '7 days' <= public._probe_now()", "o2.paid_at + interval '7 days' < public._probe_now()");
fixed = swap("HANDOVER_NUDGE_STRICT", fixed, "h.held_nudged_at + interval '7 days' <= public._probe_now()", "h.held_nudged_at + interval '7 days' < public._probe_now()");
anchorSql = swap("HANDOVER_ANCHOR_UTC", anchorSql, "AT TIME ZONE 'America/Chicago'", "AT TIME ZONE 'UTC'");
check("the mutation (if any) applied", !mutated || fixed !== base || anchorSql !== onFixedClock(anchor.stmt));
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) { await db.exec(anchorSql); await db.exec(onFixedClock(rules.stmt)); await db.exec(fixed); }

const ORDER = "15151515-1515-4515-8515-151515151515";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const H = 3_600_000;
const D = 24 * H;
const reset = async () => db.exec(`DELETE FROM public.calls; DELETE FROM public.declutter_bookings; DELETE FROM public.declutter_handovers;
  DELETE FROM public.declutter_seller_deliveries; DELETE FROM public.declutter_problems; DELETE FROM public.declutter_orders;`);
const order = (cols) => q(`INSERT INTO public.declutter_orders (id, handover, paid_at, book_by) VALUES ($1, $2, $3, $4)`, [ORDER, cols.handover, iso(cols.paidAt), iso(cols.bookBy ?? null)]);
const booking = (slot, day = null) => q(`INSERT INTO public.declutter_bookings VALUES ($1, $2, $3)`, [ORDER, iso(slot), day]);
const handover = (cols) => q(`INSERT INTO public.declutter_handovers (order_id, set_out_photo_path, set_out_at, no_show_reported_at, no_show_answer_by, seller_confirmed_at, held_nudged_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`, [ORDER, cols.photo ?? null, iso(cols.setOutAt ?? null), iso(cols.reportedAt ?? null), iso(cols.answerBy ?? null), iso(cols.confirmedAt ?? null), iso(cols.nudgedAt ?? null)]);
const delivery = (cols) => q(`INSERT INTO public.declutter_seller_deliveries (order_id, status, delivered_at, handoff, slot_start, slot_end) VALUES ($1, $2, $3, $4, $5, $6)`,
  [ORDER, cols.status, iso(cols.deliveredAt ?? null), cols.handoff ?? null, iso(cols.slotStart ?? null), iso(cols.slotEnd ?? null)]);
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.declutter_handover_sweep() AS r`))[0].r;
  const calls = (await q(`SELECT what FROM public.calls`)).map((c) => c.what);
  return { r, calls };
};
const edge = async (name, setup, edgeMs, ok) => {
  await reset(); await setup();
  const early = await sweep(edgeMs - 1);
  check(`${name}: 1 ms before: nothing`, early.calls.length === 0, JSON.stringify(early));
  await reset(); await setup();
  const at = await sweep(edgeMs);
  check(`${name}: at the edge`, ok(at) && !at.calls.some((c) => c.startsWith("defect:")), JSON.stringify(at));
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0);
// (a) Door sale: pickup N - 30 h, the seller's "Picked up" at N - 24 h: the later edge (the confirm) decides.
await edge("(a) door sale, 24 h after the seller's \"Picked up\"", async () => {
  await order({ handover: "pickup_home", paidAt: N - 3 * D }); await booking(N - 30 * H); await handover({ confirmedAt: N - 24 * H });
}, N, (a) => a.calls[0] === "complete:auto" && a.r.auto_paid === 1);
// (a) Porch sale on a picked day (Wed 15 July): the anchor is Louisiana midnight after it (05:00Z Thu 16 July);
// + 24 h = 05:00Z Fri 17 July. The photo was posted earlier, so the anchor decides.
await edge("(a) porch sale on a picked day, 24 h after the Louisiana midnight that ends it", async () => {
  await order({ handover: "porch", paidAt: N - 2 * D }); await booking(Date.UTC(2026, 6, 15, 14, 0, 0), "2026-07-15"); await handover({ photo: "p.jpg", setOutAt: N - 2 * H });
}, Date.UTC(2026, 6, 17, 5, 0, 0), (a) => a.calls[0] === "complete:auto");
// (b) Paid 7 days ago, no time ever booked.
await edge("(b) paid 7 days ago with no pickup booked", async () => {
  await order({ handover: "pickup_home", paidAt: N - 7 * D });
}, N, (a) => a.calls[0] === "close:buyer_no_show" && a.r.not_picked_up === 1);
// (b2) A seller delivery still needing a time at book_by.
await edge("(b2) seller delivery still needing a time at book_by", async () => {
  await order({ handover: "seller_delivery", paidAt: N - 7 * D, bookBy: N }); await delivery({ status: "needs_time" });
}, N, (a) => a.calls[0] === "close:delivery_never_booked");
// (c) A seller delivery handed over 24 h ago.
await edge("(c) seller delivery handed over 24 h ago", async () => {
  await order({ handover: "seller_delivery", paidAt: N - 3 * D }); await delivery({ status: "booked", deliveredAt: N - 24 * H, handoff: "hand", slotStart: N - 25 * H, slotEnd: N - 24 * H });
  await handover({ confirmedAt: N - 24 * H });
}, N, (a) => a.calls[0] === "complete:auto" && a.r.delivery_auto_paid === 1);
// (d) A booked delivery 24 h out gets the 24 h reminder; 24 h + 1 ms out, none.
{
  await reset();
  await order({ handover: "seller_delivery", paidAt: N - D }); await delivery({ status: "booked", slotStart: N + 24 * H + 1, slotEnd: N + 25 * H });
  const far = await sweep(N);
  const [{ rh: rh0 }] = await q(`SELECT reminded_hours::text rh FROM public.declutter_seller_deliveries`);
  check("(d) delivery 24 h + 1 ms out: no reminder", rh0 === "{}", rh0);
  await reset();
  await order({ handover: "seller_delivery", paidAt: N - D }); await delivery({ status: "booked", slotStart: N + 24 * H, slotEnd: N + 25 * H });
  const near = await sweep(N);
  const [{ rh }] = await q(`SELECT reminded_hours::text rh FROM public.declutter_seller_deliveries`);
  check("(d) delivery exactly 24 h out: the 24 h reminder marked sent", rh === "{24}" && near.r.delivery_reminders === 1, JSON.stringify({ rh, ...near }));
  void far;
}
// (e) The buyer's no-show report, no answer by the deadline.
await edge("(e) buyer's no-show report unanswered at no_show_answer_by", async () => {
  await order({ handover: "pickup_home", paidAt: N - 3 * D }); await booking(N - 26 * H); await handover({ reportedAt: N - 24 * H, answerBy: N });
}, N, (a) => a.calls[0] === "close:seller_no_show" && a.r.no_show_unanswered === 1);
// (f) Nobody said anything 24 h after the pickup time: both nudged; and again exactly 7 days after the last nudge.
await edge("(f) nobody said anything, 24 h after the pickup time", async () => {
  await order({ handover: "pickup_home", paidAt: N - 3 * D }); await booking(N - 24 * H); await handover({});
}, N, (a) => a.calls.filter((c) => c.startsWith("remind:")).length === 2);
await edge("(f) still nothing, 7 days after the last nudge", async () => {
  await order({ handover: "pickup_home", paidAt: N - 20 * D }); await booking(N - 19 * D); await handover({ nudgedAt: N - 7 * D });
}, N, (a) => a.calls.filter((c) => c.startsWith("remind:")).length === 2);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
