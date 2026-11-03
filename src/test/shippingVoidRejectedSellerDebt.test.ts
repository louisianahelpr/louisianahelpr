/**
 * Q2259 shipping S6 part 2c (+ 2f: admin_no_fault): a rejected label void on an order refunded on the SELLER books the spent postage as ONE
 * seller fee debt (ship_void_rejected), read from the newest declutter_ship_void_rejected_debt() and its trigger.
 * Behaviour proven in PGlite: src/test/pglite/shippingVoidRejectedSellerDebt.pglite.mjs (53/53; plants RED).
 *
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql |                   AND d.reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described', 'admin_no_fault', 'seller_out')); |                   AND d.reason IS NOT NULL);
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql |   IF NEW.label_state <> 'void_rejected' OR | IF NEW.label_state NOT IN ('void_rejected', 'voided') OR
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql | VALUES (v_seller, 'ship_void_rejected', NEW.id, NEW.label_cost_cents, NEW.label_cost_cents) | VALUES (v_seller, 'ship_void_rejected', NEW.id, NEW.label_cost_cents, 0)
 * @mutate supabase/migrations/20261102045553_shipping_void_rejected_seller_debt.sql | AFTER UPDATE OF label_state ON public.shipments | AFTER UPDATE OF tracking_status ON public.shipments
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");
const newest = (re: RegExp) => {
  for (const f of [...files].reverse()) {
    const sql = flat(blankSqlComments(readFileSync(join(DIR, f), "utf8")));
    if (re.test(sql)) return { file: f, sql };
  }
  throw new Error(`no migration matches ${re}`);
};

describe("a rejected label void on a seller-fault refund is the seller's debt", () => {
  it("the function books ship_void_rejected for seller-fault refunds only, once, at the label cost", () => {
    const { file, sql } = newest(/FUNCTION public\.declutter_ship_void_rejected_debt\(\)/);
    expect(file >= "20261103211330").toBe(true);
    expect(sql).toContain("IF NEW.label_state <> 'void_rejected' OR OLD.label_state = 'void_rejected'");
    const reasons = /d\.reason IN \(([^)]*)\)/.exec(sql)?.[1].match(/'[a-z_]+'/g) ?? [];
    // 2f (20261102055653): admin_no_fault joins (decision 6: a spent label on a no-fault refund is the seller's).
    // 20261103211330: seller_out joins (admin_no_fault while the seller can no longer sell, Q1928 gap 3).
    expect(reasons.sort()).toEqual(["'admin_no_fault'", "'not_as_described'", "'seller_backed_out'", "'seller_no_show'", "'seller_out'"]);
    expect(reasons.length).toBeGreaterThan(3);
    expect(sql).toContain("VALUES (v_seller, 'ship_void_rejected', NEW.id, NEW.label_cost_cents, NEW.label_cost_cents) ON CONFLICT (source_kind, source_ref) DO NOTHING");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_ship_void_rejected_debt() FROM PUBLIC, anon, authenticated;");
  });
  it("runs on every label_state change of a shipment", () => {
    const { sql } = newest(/CREATE TRIGGER trg_shipments_void_rejected_debt/);
    expect(sql).toContain("CREATE TRIGGER trg_shipments_void_rejected_debt AFTER UPDATE OF label_state ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_void_rejected_debt();");
  });
});
