/**
 * Declutter audit 1b #14 (owner decided 2026-10-29: "allow partial"): after a refund request reached Louisiana Helpr,
 * the admin could only refund everything or pay the seller; the seller's part offer was text in the note.
 *
 * Reads the EFFECTIVE (newest) definitions, comments blanked:
 *   - declutter_admin_decide_problem takes 'refund_part' with an amount (and only with one), only after the handover,
 *     above $0 and below the item price, and runs the part-refund path a buyer's accepted offer takes;
 *   - declutter_admin_open_problems gives the card the seller's last offer to pre-fill it.
 * Backend proof: src/test/pglite/declutterAdminPartRefund.pglite.mjs (3x; RED without the migration).
 *
 * @mutate supabase/migrations/20261101012052_helpr_task_released_helpr.sql |      OR (p_decision = 'refund_part') <> (p_part_cents IS NOT NULL) |      OR false
 * @mutate supabase/migrations/20261101012052_helpr_task_released_helpr.sql |   IF p_decision = 'refund_part' AND o.status <> 'handed_over' THEN | IF false THEN
 * @mutate supabase/migrations/20261101012052_helpr_task_released_helpr.sql |   IF p_decision = 'refund_part' AND (p_part_cents <= 0 OR p_part_cents >= o.items_cents) THEN |   IF p_decision = 'refund_part' AND p_part_cents <= 0 THEN
 * @mutate supabase/migrations/20261101012052_helpr_task_released_helpr.sql |       v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', p_part_cents); |       v_out := public.declutter_refund_after_handover(o.id, 'admin_no_fault', NULL);
 * @mutate supabase/migrations/20261029231235_declutter_admin_part_refund.sql |            p.other_side_note, p.other_side_photo_paths, rr.offer_cents |            p.other_side_note, p.other_side_photo_paths, NULL::integer
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const body = (name: string) => flat(DEFS.get(name)?.stmt ?? "");

describe("audit 1b #14: Louisiana Helpr refunds part of the price", () => {
  const d = body("declutter_admin_decide_problem");

  it("reads the newest decision (floor)", () => {
    expect(d.length).toBeGreaterThan(2000);
    expect(d).toContain("p_false_report boolean DEFAULT false, p_part_cents integer DEFAULT NULL)");
  });

  it("'refund_part' needs an amount and only it takes one; after the handover; above $0 and below the item price", () => {
    expect(d).toContain("p_decision NOT IN ('refund_buyer', 'pay_seller', 'refund_part') OR (p_decision = 'refund_part') <> (p_part_cents IS NOT NULL)");
    expect(d).toContain("IF p_decision = 'refund_part' AND o.status <> 'handed_over' THEN RAISE EXCEPTION 'part_refund_after_handover_only'");
    expect(d).toContain("IF p_decision = 'refund_part' AND (p_part_cents <= 0 OR p_part_cents >= o.items_cents) THEN RAISE EXCEPTION 'invalid_amount'");
    // Checked before anything changes.
    expect(d.indexOf("'part_refund_after_handover_only'")).toBeLessThan(d.indexOf("SET status = 'decided'"));
  });

  it("runs the accepted-offer part refund path with exactly the amount, and closes the request as agreed", () => {
    expect(d).toContain("IF p_decision = 'refund_part' THEN v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', p_part_cents);");
    expect(d).toContain("SET status = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN 'agreed' ELSE 'declined' END");
  });

  it("the admin card read carries the seller's last offer and the other side", () => {
    const op = body("declutter_admin_open_problems");
    expect(op).toContain("other_side_note text, other_side_photo_paths text[], refund_offer_cents integer)");
    expect(op).toContain("p.other_side_note, p.other_side_photo_paths, rr.offer_cents FROM public.declutter_problems p");
  });
});
