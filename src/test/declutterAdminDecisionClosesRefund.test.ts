/**
 * Declutter audit 1b #5 (prod 2026-10-29, order B): when Louisiana Helpr decided a problem that came from a refund
 * request, the request stayed 'to_admin' and both refund panels kept saying "Louisiana Helpr is looking". #12: the
 * admin's no-fault refund paid back less than the payment and only the refund form said why. And the refund notices
 * sent both sides to "Messages", which has nothing for Declutter (coordinator, 2026-10-29: the order chat, D2-1).
 *
 * Reads the EFFECTIVE (newest) definitions, comments blanked:
 *   - declutter_admin_decide_problem closes the to_admin request tied to the decided problem: agreed with the
 *     refund on a refund, declined on paying the seller;
 *   - declutter_refund_request_view tells the panel the request ended with Louisiana Helpr's decision;
 *   - declutter_refund_after_handover explains a refund that kept the card fee, in the refund form's words;
 *   - CLASS: no Declutter function's notice (any declutter_* function that calls declutter_notify) tells a member
 *     to use "Messages".
 * Backend proof: src/test/pglite/declutterAdminDecisionClosesRefund.pglite.mjs (3x; RED without the migration).
 *
 * @mutate supabase/migrations/20261101012052_helpr_task_released_helpr.sql |      WHERE order_id = o.id AND problem_id = p.id AND status = 'to_admin'; |      WHERE false;
 * @mutate supabase/migrations/20261101012052_helpr_task_released_helpr.sql |        SET status = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN 'agreed' ELSE 'declined' END, |        SET status = 'declined',
 * @mutate supabase/migrations/20261101012052_helpr_task_released_helpr.sql |           refund_id = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN (v_out->>'refund_id')::uuid ELSE refund_id END, |           refund_id = refund_id,
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |                           WHEN v_policy = 'keep_card_fee' THEN ' That''s all you paid, less the small part the card network kept for the payment, which it doesn''t give back.'\n | \n
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |       'admin_decided', r.status IN ('agreed', 'declined') | 'admin_decided', r.status IN ('agreed', 'declined', 'to_admin')
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql | 'Give the item back to the seller; message the seller from your order. Your refund | 'Give the item back to the seller; arrange it in Messages. Your refund
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const body = (name: string) => flat(DEFS.get(name)?.stmt ?? "");

describe("audit 1b #5/#12: Louisiana Helpr's decision ends the refund request; notices say why and where", () => {
  it("decide_problem closes the to_admin request of the decided problem, agreed with the refund or declined", () => {
    const d = body("declutter_admin_decide_problem");
    expect(d.length).toBeGreaterThan(2000);
    // Every refund decision closes it as agreed: in full (refund_buyer) or in part (refund_part, D2-14 20261029231235).
    expect(d).toContain("UPDATE public.declutter_refund_requests SET status = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN 'agreed' ELSE 'declined' END,");
    expect(d).toContain("refund_id = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN (v_out->>'refund_id')::uuid ELSE refund_id END");
    expect(d).toContain("settled_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN now() ELSE settled_at END");
    expect(d).toContain("declined_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN declined_at ELSE now() END");
    expect(d).toContain("WHERE order_id = o.id AND problem_id = p.id AND status = 'to_admin';");
  });

  it("the view says the request ended with Louisiana Helpr's decision", () => {
    expect(body("declutter_refund_request_view")).toContain(
      "'admin_decided', r.status IN ('agreed', 'declined') AND EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'decided')");
  });

  it("a refund after the handover that kept the card fee says why, in the refund form's words", () => {
    const r = body("declutter_refund_after_handover");
    const line = "That''s all you paid, less the small part the card network kept for the payment, which it doesn''t give back.";
    expect(r.split(`WHEN v_policy = 'keep_card_fee' THEN ' ${line}'`).length - 1).toBe(2);
  });

  it("CLASS: no Declutter notice sends a member to Messages (floor: the notice-writing functions are read)", () => {
    const writers = [...DEFS].filter(([n, d]) => n.startsWith("declutter_") && flat(d.stmt).includes("public.declutter_notify("));
    expect(writers.length).toBeGreaterThan(20);
    const offenders = writers.filter(([, d]) => /\bin Messages\b/.test(flat(d.stmt))).map(([n]) => n);
    expect(offenders).toEqual([]);
  });
});
