/**
 * Q2259 shipping S6 part 2f (spec 5.3 row "Admin no-fault": "spent = seller debt", decision 6): an admin_no_fault refund
 * of a shipped order books a spent label (scanned or delivered) as ONE seller debt ('ship_label'), sends an unscanned
 * test label to be voided (a live one is paged), and a void rejected afterwards is the seller's debt (2c's reason list).
 * Read from the newest declutter_ship_no_fault_label() and its AFTER INSERT trigger on declutter_refunds.
 * Behaviour proven in PGlite: src/test/pglite/shippingAdminNoFaultLabelDebt.pglite.mjs (59/59; skip 9 FAIL; plants RED).
 *
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql |   IF NEW.reason IS NULL OR NEW.reason NOT IN ('admin_no_fault', 'ship_lost', 'not_as_described', | IF NEW.reason IS NULL OR NEW.reason NOT IN ('admin_no_fault', 'ship_lost', 'buyer_cancelled', 'not_as_described',
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql |   IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL AND v_label.delivered_at IS NULL THEN |   IF v_label.label_state = 'bought' THEN
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql |   VALUES (v_seller, v_kind, v_label.id, v_label.label_cost_cents, v_label.label_cost_cents) |   VALUES (v_seller, v_kind, v_label.id, v_label.label_cost_cents, 0)
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql |   v_kind := CASE WHEN v_label.label_state = 'bought' THEN 'ship_label' |   v_kind := CASE WHEN v_label.label_state = 'bought' THEN 'ship_void_rejected'
 * @mutate supabase/migrations/20261102055653_shipping_admin_no_fault_label_debt.sql | AFTER INSERT ON public.declutter_refunds | AFTER UPDATE ON public.declutter_refunds
 * @mutate supabase/migrations/20261103211330_shipping_seller_fault_label_debt.sql |     IF v_label.label_mode = 'test' THEN\n      UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()\n       WHERE id = v_label.id AND label_state = 'bought' AND accepted_at IS NULL AND delivered_at IS NULL; |     IF v_label.label_mode = 'none' THEN\n      UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()\n       WHERE id = v_label.id AND label_state = 'bought' AND accepted_at IS NULL AND delivered_at IS NULL;
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
const body = (sql: string, fn: string) => {
  const start = sql.indexOf(`FUNCTION public.${fn}()`);
  const tag = /AS (\$[a-z_]*\$)/i.exec(sql.slice(start))?.[1] ?? "$$";
  const open = sql.indexOf(tag, start);
  return sql.slice(open, sql.indexOf(tag, open + tag.length) + tag.length);
};

describe("an admin no-fault refund of a shipped order makes a spent label the seller's debt", () => {
  const { file, sql } = newest(/FUNCTION public\.declutter_ship_no_fault_label\(\)/);
  const fn = body(sql, "declutter_ship_no_fault_label");

  it("acts only on no-fault, lost and seller-fault refunds of ship orders, never a buyer-side one", () => {
    expect(file >= "20261102055653").toBe(true);
    // ship_lost (20261103203204): a parcel the carrier lost is the seller's too (decision 5).
    // seller-fault reasons (20261103211330): spec 5.3, a spent label on a refund on the seller is the seller's.
    expect(fn).toContain("IF NEW.reason IS NULL OR NEW.reason NOT IN ('admin_no_fault', 'ship_lost', 'not_as_described', 'seller_no_show', 'seller_backed_out', 'seller_out') OR NEW.order_id IS NULL THEN RETURN NEW;");
    expect(fn).not.toMatch(/NOT IN \([^)]*'(buyer_cancelled|admin_buyer_fault|refund_request_full|refund_request_part|buyer_no_show|buyer_restarted_checkout)'/);
    expect(fn).toContain("WHERE o.id = NEW.order_id AND o.handover = 'ship';");
  });
  it("an unscanned label is voided (test) or paged (live), never booked as a debt", () => {
    expect(fn).toContain("IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL AND v_label.delivered_at IS NULL THEN IF v_label.label_mode = 'test' THEN UPDATE public.shipments SET label_state = 'void_requested'");
    expect(fn).toContain("PERFORM public.log_cron_defect('declutter_ship_no_fault_label-live-void'");
  });
  it("a spent label is ONE debt at the label cost, keyed on the shipment", () => {
    expect(fn).toContain("v_kind := CASE WHEN v_label.label_state = 'bought' THEN 'ship_label' WHEN v_label.label_state = 'void_rejected' THEN 'ship_void_rejected' END;");
    expect(fn).toContain("VALUES (v_seller, v_kind, v_label.id, v_label.label_cost_cents, v_label.label_cost_cents) ON CONFLICT (source_kind, source_ref) DO NOTHING");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_ship_no_fault_label() FROM PUBLIC, anon, authenticated;");
  });
  it("runs on every new refund row", () => {
    const t = newest(/CREATE TRIGGER trg_declutter_refunds_ship_no_fault_label/);
    expect(t.sql).toContain("CREATE TRIGGER trg_declutter_refunds_ship_no_fault_label AFTER INSERT ON public.declutter_refunds FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_no_fault_label();");
    expect(files.length).toBeGreaterThan(100);
  });
});
