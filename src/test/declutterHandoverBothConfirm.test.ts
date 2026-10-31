/**
 * Declutter handover money (owner 10-30; buying audit finding 24; migration 20261031004529). Neither side's word alone
 * moves money, except the buyer's "I got it": a buyer's no-show report gives the seller 24 hours, the seller's "Picked up"
 * waits for the buyer, and silence holds the money. Reads EFFECTIVE definitions, so a later migration that restates one of
 * these and brings back the one-tap refund or the silent auto-pay goes red here.
 * Backend proof: src/test/pglite/declutterHandoverBothConfirm.pglite.mjs (3x; red with NEW_MIGRATION=skip).
 */
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |     RETURN public.declutter_start_no_show_answer(o.id);\n  END IF;\n  IF b.buyer_missed_at |     RETURN public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show', 'x');\n  END IF;\n  IF b.buyer_missed_at
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   -- CHANGED (owner 10-30): no refund and no strike on one tap. The sweep closes it if the seller doesn't answer.\n  RETURN public.declutter_start_no_show_answer(o.id);\nEND; |   RETURN public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show', 'x');\nEND;
// @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |        AND (o2.handover = 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id\n                                              AND h.seller_confirmed_at + interval '24 hours' <= now())) |
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF o.paid_with = 'free' THEN\n    -- complete_handover first |   IF true THEN\n    -- complete_handover first
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |    WHERE order_id = o.id AND status = 'open' AND reporter_side = 'system'; |    WHERE order_id = o.id AND status = 'open';
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   VALUES (o.id, o.buyer_id, 'buyer', 'no_show',\n |   VALUES (o.id, v_uid, 'seller', 'no_show',\n
// @mutate supabase/migrations/20261031103443_declutter_taken_back_notice_opens_the_tab.sql |     UPDATE public.declutter_handovers SET no_show_reported_at = NULL, no_show_answer_by = NULL WHERE order_id = o.id; |     NULL;
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   BEFORE UPDATE OF slot_start, pickup_day ON public.declutter_bookings\n  FOR EACH ROW WHEN (NEW.slot_start IS DISTINCT FROM OLD.slot_start OR NEW.pickup_day IS DISTINCT FROM OLD.pickup_day) |   BEFORE UPDATE OF slot_start, pickup_day ON public.declutter_bookings\n  FOR EACH ROW WHEN (false)
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |     IF v_open.reporter_side = 'buyer' AND v_open.other_side_note IS NULL THEN |     IF false THEN
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   FOR EACH ROW WHEN (NEW.slot_start IS DISTINCT FROM OLD.slot_start\n                     OR (NEW.proposed_start IS NOT NULL AND NEW.proposed_start IS DISTINCT FROM OLD.proposed_start)) |   FOR EACH ROW WHEN (false)
// @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |                                                  AND h.set_out_at + interval '24 hours' <= now())) THEN |                                                  AND true)) THEN
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |                         AND p.created_at < public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '7 days') |                         AND true)
// @mutate src/components/declutter/SellerDeliveryOrder.tsx | {can.askNewTime && !noShowWaiting && | {can.askNewTime &&
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (anyProblem) return null;\n | \n
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (frozen) return booked ? | if (false) return booked ?
// @mutate src/components/declutter/DeclutterProblemOpen.tsx |     : noShowAnswered ? noShowAnsweredWords(side, delivery)\n | \n
// @mutate supabase/functions/delete-own-account/index.ts |             ? DECLUTTER_HELD_BLOCKS_DELETION_MESSAGE | ? MONEY_OWED_BLOCKS_DELETION_MESSAGE
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const file = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const MIGS = resolve(__dirname, "../../supabase/migrations");
const NO_SHOW_TRIGGERS = ["declutter_delivery_time_waits_for_no_show_answer", "declutter_booking_waits_for_no_show_answer"];
/** The newest migration that (re)creates each no-show trigger, flattened (a later restatement of a function in the same file must not pin it). */
function newestTriggers(): string {
  const files = readdirSync(MIGS).filter((f) => f.endsWith(".sql")).sort().reverse();
  return NO_SHOW_TRIGGERS.map((t) => {
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(MIGS, f), "utf8")).replace(/\s+/g, " ");
      if (sql.includes(`CREATE TRIGGER ${t} `)) return sql;
    }
    return "";
  }).join("\n");
}

describe("Declutter: both sides confirm before money moves", () => {
  it("T9: the seller's answer leaves the report the buyer's, and taking it back ends it", () => {
    const a = flat("declutter_answer_no_show");
    expect(a).toContain("VALUES (o.id, o.buyer_id, 'buyer', 'no_show',");
    expect(a).not.toContain("declutter_report_problem(");
    expect(flat("declutter_withdraw_problem")).toContain("IF v_side = 'buyer' THEN UPDATE public.declutter_handovers SET no_show_reported_at = NULL, no_show_answer_by = NULL");
    expect(a).toContain("IF v_open.reporter_side = 'buyer' AND v_open.other_side_note IS NULL THEN UPDATE public.declutter_problems SET other_side_note = btrim(p_note)");
    expect(flat("declutter_start_no_show_answer")).toContain("RAISE EXCEPTION 'problem_taken_back'");
  });

  it("review of 7496d29c8b: a delivery's time stands too, a late porch photo waits, and a late problem doesn't reopen the address", () => {
    const mig = newestTriggers();
    expect(mig).toContain("BEFORE UPDATE OF slot_start, proposed_start ON public.declutter_seller_deliveries FOR EACH ROW WHEN (NEW.slot_start IS DISTINCT FROM OLD.slot_start OR (NEW.proposed_start IS NOT NULL AND NEW.proposed_start IS DISTINCT FROM OLD.proposed_start)) EXECUTE FUNCTION public.declutter_refuse_move_during_no_show()");
    const sweep = flat("declutter_handover_sweep");
    expect(sweep.match(/h\.set_out_at \+ interval '24 hours' <= now\(\)/g)?.length).toBe(2);
    const closed = flat("declutter_held_address_closed");
    expect(closed).toContain("p.status = 'open' AND p.created_at < public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '7 days'");
    expect(closed).toContain("h.no_show_reported_at < public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '7 days'");
  });

  it("T9: the pickup time stands while the report waits", () => {
    expect(flat("declutter_refuse_move_during_no_show")).toContain("RAISE EXCEPTION 'no_show_waiting'");
    const mig = newestTriggers();
    expect(mig).toContain("BEFORE UPDATE OF slot_start, pickup_day ON public.declutter_bookings FOR EACH ROW WHEN (NEW.slot_start IS DISTINCT FROM OLD.slot_start OR NEW.pickup_day IS DISTINCT FROM OLD.pickup_day) EXECUTE FUNCTION public.declutter_refuse_move_during_no_show()");
  });

  it("reads the definitions (floors)", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    for (const n of ["declutter_report_no_show", "declutter_report_not_delivered", "declutter_seller_picked_up", "declutter_handover_sweep", "declutter_answer_no_show"]) {
      expect(flat(n).length, n).toBeGreaterThan(800);
    }
  });

  it("a buyer's report closes nothing itself: the refund and strike are only the sweep's, after the 24 hours", () => {
    const report = flat("declutter_report_no_show");
    expect(report).not.toMatch(/declutter_close_paid_order\(o\.id, 'seller_no_show'/);
    expect(report).toMatch(/declutter_start_no_show_answer\(o\.id\)/);
    expect(flat("declutter_report_not_delivered")).not.toMatch(/declutter_close_paid_order/);
    expect(flat("declutter_report_not_delivered")).toMatch(/declutter_start_no_show_answer\(o\.id\)/);
    expect(flat("declutter_start_no_show_answer")).toMatch(/now\(\) \+ interval '24 hours'/);
    expect(flat("declutter_handover_sweep")).toMatch(/no_show_answer_by <= now\(\).*declutter_close_paid_order\(o\.id, 'seller_no_show', 'seller', 'seller_no_show'/);
  });

  it("the seller's Picked up on a paid sale records and waits; only a free claim finishes at once", () => {
    const picked = flat("declutter_seller_picked_up");
    expect(picked).toMatch(/IF o\.paid_with = 'free' THEN v_out := public\.declutter_complete_handover\(o\.id, 'seller'\)/);
    expect(picked.match(/declutter_complete_handover/g)).toHaveLength(1);
    expect(picked).toMatch(/seller_confirmed_at = now\(\)/);
  });

  it("silence pays nobody: a door or meeting-spot sale needs the seller's word, 24 hours old", () => {
    const sweep = flat("declutter_handover_sweep");
    expect(sweep.match(/o2?\.handover = 'porch' OR EXISTS \(SELECT 1 FROM public\.declutter_handovers h WHERE h\.order_id = o2?\.id AND h\.seller_confirmed_at \+ interval '24 hours' <= now\(\)\)/g)).toHaveLength(2);
  });

  it("while held: nudged, closed at 7 days, admin at 60, and test data is left out", () => {
    const sweep = flat("declutter_handover_sweep");
    expect(sweep).toMatch(/held_nudged_at \+ interval '7 days' <= now\(\)/);
    expect(sweep).toMatch(/interval '60 days'/);
    expect(sweep).toMatch(/o2\.is_seed IS NOT TRUE/);
    expect(sweep).toMatch(/public\.test_accounts t WHERE t\.user_id IN \(o2\.buyer_id, o2\.seller_id\)/);
    expect(sweep).toMatch(/np\.declutter_pickups IS FALSE/);
    expect(flat("declutter_held_address_closed")).toMatch(/interval '7 days' <= now\(\)/);
    expect(flat("declutter_address_access")).toMatch(/declutter_held_address_closed\(o\.id\)/);
    expect(flat("declutter_order_place")).toMatch(/declutter_held_address_closed\(o\.id\)/);
  });

  it("the buyer's tap finishes a sale held 60 days, and only that problem steps aside for it", () => {
    expect(flat("declutter_confirm_handover")).toMatch(/UPDATE public\.declutter_problems SET status = 'withdrawn', withdrawn_at = now\(\) WHERE order_id = o\.id AND status = 'open' AND reporter_side = 'system'; RETURN public\.declutter_complete_handover\(o\.id, p_method\)/);
  });

  it("the screens follow the server: no move or Picked up while a report waits, frozen times, the answered report's words", () => {
    // LEAD-VACUOUS 10-31: the four screen @mutate lines above had no check reading these files.
    const screen = (p: string) => blankComments(file(p)).replace(/\s+/g, " ");
    const seller = screen("src/components/declutter/SellerDeliveryOrder.tsx");
    expect(seller).toContain("{can.askNewTime && !noShowWaiting &&");
    const views = screen("src/components/declutter/DeclutterHandoverViews.tsx");
    expect(views).toMatch(/if \(order\.side === "seller"\) \{ if \(anyProblem\) return null;/);
    expect(views).toContain("if (frozen) return booked ?");
    const note = screen("src/components/declutter/DeclutterProblemOpen.tsx");
    expect(note).toContain(": noShowAnswered ? noShowAnsweredWords(side, delivery) :");
  });

  it("deleting an account while money is held says why and what to do", () => {
    expect(file("supabase/functions/_shared/accountPurge.ts")).toMatch(/DECLUTTER_HELD_BLOCKS_DELETION_MESSAGE =\s+"[^"]*Ask the other person to confirm it, or report a problem/);
    expect(file("supabase/functions/delete-own-account/index.ts")).toMatch(/active\.reason === "declutter_held"\s+\? DECLUTTER_HELD_BLOCKS_DELETION_MESSAGE/);
  });
});
