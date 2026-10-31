/**
 * "Take back my report" (owner 2026-10-30 pop-up answer 4; migration 20261030134109, Builder 100): the member who
 * reported an OPEN Declutter problem can withdraw it until Louisiana Helpr decides; the payout hold lifts and the
 * handover clocks run on, because every reader of a problem holds only on status = 'open'.
 *
 * The class this guards: a reader that treated "not decided" as open (status <> 'decided') would keep holding money
 * on a withdrawn problem forever. Every effective function that filters declutter_problems by status must name
 * 'open' or 'decided' exactly. Reads EFFECTIVE definitions (helpers/effectiveFunctionDefs).
 * Backend proof: src/test/pglite/declutterTakeBackProblemReport.pglite.mjs (3x; 19 FAIL without the migration).
 */
// @mutate supabase/migrations/20261031103443_declutter_taken_back_notice_opens_the_tab.sql |   IF p.status <> 'open' THEN\n    RAISE EXCEPTION 'problem_already_decided' |   IF false THEN\n    RAISE EXCEPTION 'problem_already_decided'
// @mutate supabase/migrations/20261031103443_declutter_taken_back_notice_opens_the_tab.sql |      OR p.reporter_id IS DISTINCT FROM v_uid OR p.reporter_side IS DISTINCT FROM v_side THEN |      OR p.reporter_side IS DISTINCT FROM v_side THEN
// @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql | p.reporter_id = v_uid AND p.status = 'withdrawn') THEN | p.reporter_id = v_uid AND p.status = 'nope') THEN
// @mutate supabase/migrations/20261031103443_declutter_taken_back_notice_opens_the_tab.sql |    WHERE problem_id = p.id AND status = 'to_admin' AND v_side = 'buyer'; |    WHERE problem_id = p.id AND status = 'to_admin' AND false;
// @mutate supabase/migrations/20261030134109_declutter_take_back_problem_report.sql | 'open'::text, 'decided'::text, 'withdrawn'::text | 'open'::text, 'decided'::text
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

/** Every effective function body that reads declutter_problems, flattened. */
const readers = [...DEFS.entries()]
  .map(([name, d]) => [name, blankSqlComments(d.stmt).replace(/\s+/g, " ")] as const)
  .filter(([, body]) => /\bdeclutter_problems\b/.test(body));

describe("Declutter: take back my report", () => {
  it("reads the definitions (floors)", () => {
    expect(readers.length).toBeGreaterThan(20);
    expect(flat("declutter_withdraw_problem").length).toBeGreaterThan(1500);
    expect(DEFS.get("declutter_withdraw_problem")?.file).toMatch(/20261031103443_declutter_taken_back_notice_opens_the_tab\.sql$/); // T9 ends a no-show report; LEAD-TAKENBACK-LINK: tab link
    expect(DEFS.get("declutter_report_problem")?.file).toMatch(/20261031100935_declutter_problem_notices_name_the_item\.sql$/); // BUY-30: restated, its notice names the item
  });

  it("no reader treats a not-decided problem as open (status <> 'decided' / NOT IN ('decided'))", () => {
    const bad = readers.filter(([, b]) => /status\s*(<>|!=)\s*'decided'|status NOT IN \('decided'\)/i.test(b)).map(([n]) => n);
    expect(bad).toEqual([]);
    // The money and clock readers hold on 'open' only.
    for (const n of ["declutter_payouts_due", "declutter_handover_sweep", "declutter_admin_open_problems", "declutter_ask_refund"]) {
      expect(flat(n), n).toMatch(/status = 'open'/);
    }
    expect(flat("declutter_sale_decided")).toMatch(/x\.status = 'decided'/);
  });

  it("only the reporter, as that side, only while open; the order is locked before the problem", () => {
    const w = flat("declutter_withdraw_problem");
    expect(w).toContain("o := public.declutter_lock_order(v_order);");
    expect(w.indexOf("declutter_lock_order(v_order)")).toBeLessThan(w.indexOf("FOR UPDATE"));
    expect(w).toContain("OR p.reporter_id IS DISTINCT FROM v_uid OR p.reporter_side IS DISTINCT FROM v_side THEN RAISE EXCEPTION 'problem_not_found'");
    expect(w).toContain("IF p.status <> 'open' THEN RAISE EXCEPTION 'problem_already_decided'");
    expect(w).toContain("UPDATE public.declutter_problems SET status = 'withdrawn', withdrawn_at = now() WHERE id = p.id;");
  });

  it("a request that went to Louisiana Helpr with the report: the buyer's goes with it; a return or a seller's report refuses", () => {
    const w = flat("declutter_withdraw_problem");
    expect(w).toContain("r.problem_id = p.id AND r.status = 'to_admin' AND r.return_agreed_at IS NOT NULL) THEN RAISE EXCEPTION 'problem_has_return'");
    expect(w).toContain("IF v_side = 'seller' AND EXISTS (SELECT 1 FROM public.declutter_refund_requests r WHERE r.problem_id = p.id AND r.status = 'to_admin') THEN RAISE EXCEPTION 'problem_has_refund_request'");
    expect(w).toContain("UPDATE public.declutter_refund_requests SET status = 'withdrawn' WHERE problem_id = p.id AND status = 'to_admin' AND v_side = 'buyer';");
  });

  it("the reporter who took it back cannot report that sale again", () => {
    expect(flat("declutter_report_problem")).toContain(
      "p.order_id = o.id AND p.reporter_id = v_uid AND p.status = 'withdrawn') THEN RAISE EXCEPTION 'problem_taken_back'",
    );
  });

  it("the table allows 'withdrawn' only with no decision (newest CHECK)", () => {
    const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
    const newest = [...files].reverse().find((f) => /declutter_problems_status_check/.test(blankSqlComments(readFileSync(join(MIG, f), "utf8"))));
    expect(newest).toBe("20261030134109_declutter_take_back_problem_report.sql");
    const sql = blankSqlComments(readFileSync(join(MIG, newest!), "utf8")).replace(/\s+/g, " ");
    expect(sql).toContain("'open'::text, 'decided'::text, 'withdrawn'::text");
    expect(sql).toContain("(status = 'withdrawn' AND decision IS NULL AND fault IS NULL AND decided_at IS NULL AND withdrawn_at IS NOT NULL)");
  });
});
