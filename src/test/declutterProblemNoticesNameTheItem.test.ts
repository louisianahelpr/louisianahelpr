/**
 * BUY-30 (buying audit 10-30 #30): the seller's "Refund request" and the other side's "A problem was reported on your
 * sale" named no item and opened a retired ?view= link. Both now name the order's items and open the recipient's own
 * tab (20261031100935). Behaviour: src/test/pglite/declutterProblemNoticesNameTheItem.pglite.mjs (17 PASS, 3x;
 * NEW_MIGRATION=skip 6 FAIL).
 *
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql | format('The buyer asked for a refund on %s. | format('The buyer asked for a refund%s.
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql | format('A problem was reported on %s. The money | format('A problem was reported%s. The money
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql |     '/declutter?tab=' \|\| CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid); |     '/declutter?tab=' \|\| CASE WHEN v_side = 'buyer' THEN 'buying' ELSE 'selling' END, v_uid);
 */
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const flat = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");

describe("BUY-30: problem and refund notices name the item and open the recipient's tab", () => {
  it("reads the newest definitions (this migration)", () => {
    for (const n of ["declutter_ask_refund", "declutter_report_problem"]) {
      expect(newestFunction(n).file, n).toContain("20261031100935");
      expect(flat(n).length, n).toBeGreaterThan(1500);
    }
  });

  it("Refund request: names the item, opens Selling", () => {
    expect(flat("declutter_ask_refund")).toContain(
      "PERFORM public.declutter_notify(o.seller_id, 'warning', 'Refund request', format('The buyer asked for a refund on %s. Answer within 24 hours: refund it all, offer part, or say no. If you don''t answer, Louisiana Helpr decides. Your payout waits until then.', public.declutter_order_items_named(o.id)), '/declutter?tab=selling', v_uid);");
  });

  it("A problem was reported: names the item, opens the recipient's own tab", () => {
    expect(flat("declutter_report_problem")).toContain(
      "'A problem was reported on your sale', format('A problem was reported on %s. The money stays held until Louisiana Helpr looks at it. We may ask you for photos.', public.declutter_order_items_named(o.id)), '/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid);");
  });

  it("no ?view= link left in either", () => {
    expect(flat("declutter_ask_refund")).not.toContain("?view=");
    expect(flat("declutter_report_problem")).not.toContain("?view=");
  });
});
