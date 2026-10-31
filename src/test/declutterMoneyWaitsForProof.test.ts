/**
 * CLASS GUARD: Declutter money waits for proof (anti-lying #3, owner 2026-10-28: "Money waits for proof. No
 * automatic seller payout without the seller's placement photo ... A buyer's problem report inside the window
 * pauses the payout. Verify every handover path.").
 *
 * Inventory from source: every handover the database allows (the NEWEST declutter_orders_handover_check).
 * Each is classified below as UNATTENDED (nobody hands the item to the buyer, so an automatic payout needs the
 * placement photo of whoever left it) or ATTENDED (the buyer and the seller or Helpr meet; the automatic finish
 * relies on the buyer's 24 hours to report). The classification is exact both ways: a new handover fails here
 * until someone decides which it is and names its proof.
 *
 * Read from the EFFECTIVE (newest, rewrites applied) definitions, comments blanked:
 *   1. Every automatic finish ('auto') in declutter_handover_sweep re-checks, under the order's lock, that no
 *      problem is open, and an unattended handover's loop requires its placement photo (porch: the seller's
 *      "on the porch" photo; seller delivery left at the door: the seller's door photo).
 *   2. A seller delivery left at the door cannot be marked delivered without that photo
 *      (declutter_seller_delivered), and the buyer cannot switch the handoff once it is delivered.
 *   3. A Helpr delivery finishes by itself only from 'delivered', which takes the Helpr's door photo within
 *      200 m of the drop-off (helpr_task_delivered), and never while the order is held (helpr_task_source_held:
 *      an open problem).
 *   4. The seller's payout is offered only with no open problem and once the sale is final
 *      (declutter_payouts_due + declutter_sale_final), and the buyer may report a problem on a handed-over order
 *      while that window is open (declutter_report_problem + declutter_problem_window_open).
 *   5. Nobody but an admin finishes a handover over an open problem (declutter_complete_handover).
 *
 * Behaviour is proven per path by the existing PGlite proofs (declutterSlice4, declutterPorchPickADay,
 * declutterSellerDelivery, declutterHelprDelivery, declutterRefundRequests). This file pins the rule as ONE class,
 * so a restatement of any one function that drops its part fails here.
 *
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |          AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h\n                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL\n                                                  AND h.set_out_at + interval '24 hours' <= now())) THEN\n        PERFORM public.declutter_complete_handover(o.id, 'auto'); |          THEN\n        PERFORM public.declutter_complete_handover(o.id, 'auto');
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |       IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')\n         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')\n         AND EXISTS | IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')\n         AND EXISTS
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |                       WHERE h.order_id = o.id AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL) | WHERE h.order_id = o.id AND d.delivered_at IS NOT NULL
 * @mutate supabase/migrations/20261029002010_declutter_handover_photos_live_only.sql |   IF (p_photo_path IS NULL AND d.handoff = 'leave') OR (p_photo_path IS NOT NULL AND ( |   IF (p_photo_path IS NOT NULL AND (
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql | 'invalid_handoff' USING ERRCODE = '22023';\n  END IF;\n  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;\n  IF d.status NOT IN ('booked', 'needs_time')\n     OR EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN\n    RAISE EXCEPTION 'not_reschedulable' | 'invalid_handoff' USING ERRCODE = '22023';\n  END IF;\n  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;\n  IF d.status NOT IN ('booked', 'needs_time')\n     THEN\n    RAISE EXCEPTION 'not_reschedulable'
 * @mutate supabase/migrations/20261031134217_helpr_delivery_seller_reports_no_show.sql |             WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now() ORDER BY x.id LIMIT 200 LOOP | WHERE x.status IN ('picked_up', 'delivered') AND x.delivered_at + interval '24 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
 * @mutate supabase/migrations/20261031134217_helpr_delivery_seller_reports_no_show.sql |       IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now()\n         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN | IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now() THEN
 * @mutate supabase/migrations/20261018184535_declutter_delivery_no_dropoff_code.sql |     IF v_m IS NULL OR v_m > 200 THEN | IF false THEN
 * @mutate supabase/migrations/20261031134217_helpr_delivery_seller_reports_no_show.sql |     RETURN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = p_source AND p.status = 'open')\n      -- CHANGED (soldstates-5) |     RETURN false\n      -- CHANGED (soldstates-5)
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql |     AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')\n     -- 141d | -- 141d
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql |      AND public.declutter_sale_final(p.order_id) | AND true
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql |    IF v_side <> 'buyer' OR NOT public.declutter_problem_window_open(o.id) THEN | IF v_side <> 'buyer' THEN
 * @mutate supabase/migrations/20261031214749_seller_setup_fee_from_payout_restated.sql |   IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN | IF false THEN
 * @mutate supabase/migrations/20261030000030_shipping_s2_ship_handover.sql |     CHECK (handover IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup', 'ship')); |     CHECK (handover IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup', 'ship', 'locker'));
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const body = (name: string) => {
  const d = DEFS.get(name);
  expect(d, `${name} has a definition`).toBeTruthy();
  return flat(blankSqlComments(d!.stmt));
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** The handovers the database allows: the NEWEST declutter_orders_handover_check. */
function allowedHandovers(): string[] {
  let last: string | null = null;
  for (const f of migrationFiles(MIG_DIR)) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/ADD CONSTRAINT declutter_orders_handover_check\s+CHECK \(handover IN \(([^)]*)\)\)/g)) last = m[1];
  }
  expect(last, "declutter_orders_handover_check is found").not.toBeNull();
  return [...last!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

/** Every handover, with how its automatic finish is held to proof. */
const HANDOVERS: Record<string, { kind: "unattended" | "attended"; proof: string }> = {
  porch: { kind: "unattended", proof: "the seller's \"on the porch\" photo (declutter_handovers.set_out_photo_path) before the sweep finishes it" },
  seller_delivery: { kind: "unattended", proof: "left at the door: the seller's door photo to mark it delivered, re-checked by the sweep; handed over: attended" },
  delivery: { kind: "unattended", proof: "the Helpr's door photo within 200 m ('delivered') before the 24-hour finish" },
  pickup_home: { kind: "attended", proof: "the buyer meets the seller; the buyer has 24 hours after the booked time to report" },
  meetup: { kind: "attended", proof: "the buyer meets the seller at a public spot; the buyer has 24 hours after the booked time to report" },
  // Shipping S2 (Q2259): no automatic finish exists yet; the handover sweep skips it, no pickup slot can be booked,
  // and "I got it" waits for the USPS delivered scan (declutter_confirm_handover). S7 adds delivered + 48 h.
  ship: { kind: "unattended", proof: "the USPS delivered scan (shipments.tracking_status = 'delivered'), then the buyer's 48 hours" },
};

const OPEN_PROBLEM_O = "NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')";
const OPEN_PROBLEM_O2 = "NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')";

describe("Declutter money waits for proof (anti-lying #3)", () => {
  it("every handover the database allows is classified, exactly (two-way)", () => {
    const allowed = allowedHandovers();
    expect(allowed.length).toBeGreaterThan(4);
    expect(allowed).toEqual(Object.keys(HANDOVERS).sort());
    expect(Object.values(HANDOVERS).filter((h) => h.kind === "unattended").length).toBeGreaterThan(2);
  });

  it("the handover sweep never finishes a sale by itself over an open problem, or an unattended one without its photo", () => {
    const sweep = body("declutter_handover_sweep");
    const loops = sweep.split("FOR r IN").slice(1);
    const autoLoops = loops.filter((l) => l.includes("declutter_complete_handover(o.id, 'auto')"));
    // (a) pickup at home / porch / meetup, (c) seller delivery.
    expect(autoLoops.length).toBe(2);
    expect(count(sweep, "declutter_complete_handover(o.id, 'auto')")).toBe(2);
    for (const l of autoLoops) {
      // Checked when the order is picked AND again under its lock.
      expect(count(l, OPEN_PROBLEM_O2), "open-problem check in the pick").toBe(1);
      expect(count(l, OPEN_PROBLEM_O), "open-problem check under the lock").toBe(1);
      expect(l.indexOf("declutter_lock_order(r.id)")).toBeLessThan(l.indexOf(OPEN_PROBLEM_O));
    }
    const pickupLoop = autoLoops.find((l) => l.includes("o2.handover NOT IN ('delivery', 'seller_delivery', 'ship')"))!;
    const sdLoop = autoLoops.find((l) => l.includes("o2.handover = 'seller_delivery'"))!;
    expect(pickupLoop, "the pickup/porch/meetup loop").toBeTruthy();
    expect(sdLoop, "the seller-delivery loop").toBeTruthy();
    // Porch: no "on the porch" photo, no automatic finish (pick and lock).
    expect(pickupLoop).toContain("(o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL AND h.set_out_at + interval '24 hours' <= now()))");
    expect(pickupLoop).toContain("(o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL AND h.set_out_at + interval '24 hours' <= now())) THEN PERFORM public.declutter_complete_handover(o.id, 'auto')");
    // Seller delivery left at the door: no door photo, no automatic finish (pick and lock).
    expect(count(sdLoop, "(d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)")).toBe(2);
    expect(sdLoop.indexOf("declutter_lock_order(r.id)")).toBeLessThan(sdLoop.lastIndexOf("(d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)"));
    // The Helpr delivery is never finished by this sweep (it has its own, below).
    expect(pickupLoop).toContain("o.handover NOT IN ('delivery', 'seller_delivery', 'ship')");
    // A shipped order is never finished by this sweep either (the parcel's delivered scan + 48 h is S7's).
    expect(count(sweep, "handover NOT IN ('delivery', 'seller_delivery', 'ship')")).toBe(4);
  });

  it("a seller delivery left at the door cannot be marked delivered without the door photo, nor switched after", () => {
    const delivered = body("declutter_seller_delivered");
    expect(delivered).toContain("IF (p_photo_path IS NULL AND d.handoff = 'leave') OR (p_photo_path IS NOT NULL AND (");
    expect(delivered).toContain("RAISE EXCEPTION 'photo_not_uploaded'");
    expect(delivered).toContain("UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path");
    const handoff = body("declutter_set_delivery_handoff");
    expect(handoff).toContain("IF v_side <> 'buyer' THEN RAISE EXCEPTION 'wrong_side'");
    expect(handoff).toContain("OR EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN RAISE EXCEPTION 'not_reschedulable'");
  });

  it("a Helpr delivery finishes by itself only from the Helpr's door photo, and never while the order is held", () => {
    const sweep = body("helpr_task_sweep");
    const autoLoop = sweep.split("FOR r IN").slice(1).find((l) => l.includes("helpr_task_source_event(t.id, 'confirmed', 'auto')"));
    expect(autoLoop, "the 24-hour finish").toBeTruthy();
    expect(autoLoop).toContain("WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now()");
    expect(autoLoop).toContain("IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now() AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN");
    expect(count(sweep, "'confirmed', 'auto'")).toBe(1);
    const delivered = body("helpr_task_delivered");
    expect(delivered).toContain("IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) OR p_photo_path = t.pickup_photo_path THEN RAISE EXCEPTION 'photo_not_uploaded'");
    expect(delivered).toContain("IF v_m IS NULL OR v_m > 200 THEN RAISE EXCEPTION 'not_at_dropoff'");
    expect(delivered).toContain("SET status = 'delivered', delivered_at = now(), dropoff_photo_path = p_photo_path");
    expect(body("helpr_task_source_held")).toContain(
      "IF p_kind = 'declutter_delivery' THEN RETURN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = p_source AND p.status = 'open') OR EXISTS (SELECT 1 FROM public.helpr_tasks x");
  });

  it("the payout waits: no open problem, and only once the buyer's window is over", () => {
    const due = body("declutter_payouts_due");
    expect(due).toContain("AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')");
    expect(due).toContain("AND public.declutter_sale_final(p.order_id)");
    const final = body("declutter_sale_final");
    expect(final).toContain("WHEN EXISTS (SELECT 1 FROM public.declutter_refund_requests r WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning')) THEN false");
    expect(final).toContain("o.handed_over_at + interval '24 hours'");
    expect(final).toContain("+ interval '10 minutes'");
    // The buyer's report on a handed-over order is taken while that window is open, and holds the payout row.
    const report = body("declutter_report_problem");
    expect(report).toContain("PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;");
    expect(report).toContain("IF v_side <> 'buyer' OR NOT public.declutter_problem_window_open(o.id) THEN RAISE EXCEPTION 'sale_final'");
    expect(report).toContain("INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)");
    expect(body("declutter_problem_window_open")).toContain("now() < o.handed_over_at + interval '24 hours'");
  });

  it("nobody but an admin finishes a handover over an open problem", () => {
    expect(body("declutter_complete_handover")).toContain(
      "IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN RAISE EXCEPTION 'problem_open'");
  });
});
