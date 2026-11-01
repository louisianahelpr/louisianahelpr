/**
 * BUY-25 and BUY-23 (owner's rulings 10-30; migration 20261031010243). "Never got it" with Refund in full refunds at once
 * with no return; and a drop-off, which shows the buyer the seller's address, exists only where the seller offered pickup.
 * Reads EFFECTIVE definitions. Backend proof: src/test/pglite/declutterNeverGotItNoReturn.pglite.mjs (3x).
 */
// @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |     IF r.reason = 'not_received' THEN\n      v_out := | IF false THEN\n      v_out :=
// @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |       v_out := public.declutter_refund_after_handover(o.id, 'seller_no_show', NULL); |       v_out := public.declutter_refund_after_handover(o.id, 'refund_request_full', NULL);
// @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |   IF p_way = 'drop_off' AND o.handover NOT IN ('pickup_home', 'porch') THEN |   IF false THEN
// @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |   IF r.status = 'returning' AND r.return_way = 'drop_off' AND o.handover IN ('pickup_home', 'porch') THEN |   IF true THEN
// @mutate src/components/declutter/DeclutterRefundRequest.tsx | const [choice, setChoice] = useState<Answer \| null>(null); | const [choice, setChoice] = useState<Answer \| null>("full");
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("BUY-25 and BUY-23", () => {
  it("reads the definitions (floors)", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    for (const n of ["declutter_answer_refund", "declutter_accept_refund_with_return", "declutter_refund_after_handover", "declutter_refund_request_view"]) {
      expect(flat(n).length, n).toBeGreaterThan(1500);
    }
  });

  it("never got it: Refund in full refunds at once, with the seller paying the card fee (lead 10-30)", () => {
    const a = flat("declutter_answer_refund");
    expect(a).toMatch(/IF r\.reason = 'not_received' THEN v_out := public\.declutter_refund_after_handover\(o\.id, 'seller_no_show', NULL\)/);
    expect(flat("declutter_record_refund")).toContain("WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'");
    expect(flat("declutter_refund_item_returned")).toContain("public.declutter_refund_after_handover(o.id, 'refund_request_full', NULL)");
    expect(flat("declutter_accept_refund_with_return")).toContain("IF r.reason = 'not_received' THEN RAISE EXCEPTION 'no_return_needed'");
  });

  it("a drop-off only where the seller offered pickup, and its address only while it is open", () => {
    expect(flat("declutter_accept_refund_with_return")).toContain("IF p_way = 'drop_off' AND o.handover NOT IN ('pickup_home', 'porch') THEN RAISE EXCEPTION 'drop_off_not_offered'");
    expect(flat("declutter_refund_request_view")).toContain("IF r.status = 'returning' AND r.return_way = 'drop_off' AND o.handover IN ('pickup_home', 'porch') THEN SELECT string_agg");
  });

  it("the seller's answer starts on nothing, and sending asks once", () => {
    const src = readFileSync(resolve(__dirname, "../components/declutter/DeclutterRefundRequest.tsx"), "utf8");
    expect(src).toContain("useState<Answer | null>(null)");
    expect(src).toContain('testId="refund-answer"');
    expect(src).toContain("onClick={() => setAskingSend(true)}");
  });
});
