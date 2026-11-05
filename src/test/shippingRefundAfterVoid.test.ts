/**
 * Q2259 shipping S6 part 2d (spec 5.3 "Buyer cancels / admin buyer-fault": items + fee now, SHIPPING only when the void
 * succeeds; section 11 fixes 3 and 5): a buyer-fault close of a shipped order whose label was bought leaves the shipping
 * out of the refund (declutter_shipping_reserved_cents), asks for the test label's void, and the shipping goes back as
 * ONE declutter_delivery_refunds row ('ship_void_refunded') once the label is voided. Read from the newest definition of
 * each function. Behaviour proven in PGlite: src/test/pglite/shippingRefundAfterVoid.pglite.mjs (66/66; skip and plants
 * RED).
 *
 * @mutate supabase/migrations/20261103203204_shipping_lost_sweep.sql | v_fee_reason, o.total_cents - v_reserved - v_ship, | v_fee_reason, o.total_cents - v_reserved,
 * @mutate supabase/migrations/20261103203204_shipping_lost_sweep.sql |   IF v_fee_reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout') THEN  -- CHANGED (Q1928 gap 3)\n    v_ship | IF v_fee_reason IN ('buyer_no_show') THEN  -- CHANGED (Q1928 gap 3)\n    v_ship
 * @mutate supabase/migrations/20261102051521_shipping_refund_after_void.sql | AND s.label_state IN ('bought', 'void_requested', 'voided', 'void_rejected')) THEN o.shipping_cents | AND s.label_state IN ('voided')) THEN o.shipping_cents
 * @mutate supabase/migrations/20261105042758_declutter_gift_refund_rows.sql |                                         + v_order.shipping_cents - public.declutter_shipping_reserved_cents(p_order_id) THEN |                                         THEN
 * @mutate supabase/migrations/20261105052751_declutter_gift_delivery_refunds.sql |   VALUES (o.id, o.stripe_payment_intent_id, 'ship_void_refunded', o.shipping_cents, v_gift) |   VALUES (o.id, o.stripe_payment_intent_id, 'ship_void_refunded', o.total_cents, v_gift)
 * @mutate supabase/migrations/20261105052751_declutter_gift_delivery_refunds.sql |                        AND d.paid_cents <= o.total_cents - o.shipping_cents) THEN |                        AND d.paid_cents <= o.total_cents) THEN
 * @mutate supabase/migrations/20261102051521_shipping_refund_after_void.sql |   IF NEW.label_state = 'voided' AND OLD.label_state IS DISTINCT FROM 'voided' | IF NEW.label_state IN ('voided', 'void_rejected') AND OLD.label_state IS DISTINCT FROM NEW.label_state
 * @mutate supabase/migrations/20261103203204_shipping_lost_sweep.sql |       IF v_label.label_mode = 'test' THEN\n        UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now() |       IF true THEN\n        UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");
/** The newest CREATE of a function: its own statement only (to the next dollar-quote close of any tag). */
const newestFn = (name: string) => {
  const head = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`);
  for (const f of [...files].reverse()) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const m = head.exec(sql);
    if (!m) continue;
    const tag = /AS (\$[A-Za-z_]*\$)/.exec(sql.slice(m.index))?.[1] ?? "$$";
    const open = sql.indexOf(tag, m.index);
    const close = sql.indexOf(tag, open + tag.length);
    return { file: f, sql: flat(sql.slice(m.index, close + tag.length)) };
  }
  throw new Error(`no migration defines ${name}`);
};
const newestStmt = (re: RegExp) => {
  for (const f of [...files].reverse()) {
    const sql = flat(blankSqlComments(readFileSync(join(DIR, f), "utf8")));
    const m = re.exec(sql);
    if (m) return { file: f, stmt: m[0] };
  }
  throw new Error(`no migration matches ${re}`);
};
const BUYER_FAULT = ["'admin_buyer_fault'", "'buyer_cancelled'", "'buyer_no_show'", "'buyer_restarted_checkout'"];
const quoted = (s: string | undefined) => (s?.match(/'[a-z_]+'/g) ?? []).sort();

describe("a buyer-fault close of a shipped order gives the shipping back only after the void (S6 2d)", () => {
  it("the shipping held back is a bought label's shipping on a ship order", () => {
    const { file, sql } = newestFn("declutter_shipping_reserved_cents");
    expect(file >= "20261102051521").toBe(true);
    expect(sql).toContain("WHEN o.handover IS DISTINCT FROM 'ship' OR o.shipping_cents <= 0 THEN 0");
    expect(sql).toContain("AND s.label_state IN ('bought', 'void_requested', 'voided', 'void_rejected')) THEN o.shipping_cents ELSE 0 END");
  });

  it("declutter_close_paid_order holds it back for exactly the buyer-fault reasons and asks for the test label's void", () => {
    const { file, sql } = newestFn("declutter_close_paid_order");
    expect(file >= "20261102051521").toBe(true);
    // Q1928 gap 3 (20261102063343) restated it from this one, the list now read off v_fee_reason (seller_out swaps in first).
    const held = /IF (?:p_reason|v_fee_reason) IN \(([^)]*)\) THEN v_ship := COALESCE\(public\.declutter_shipping_reserved_cents\(o\.id\), 0\);/.exec(sql)?.[1];
    expect(quoted(held)).toEqual(BUYER_FAULT);
    expect(quoted(held).length).toBeGreaterThan(3);
    expect(sql).toContain("v_fee_reason, o.total_cents - v_reserved - v_ship, public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));");
    expect(sql).toContain("IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL THEN IF v_label.label_mode = 'test' THEN UPDATE public.shipments SET label_state = 'void_requested'");
    expect(sql).toContain("ELSIF v_label.label_state = 'voided' THEN PERFORM public.declutter_ship_refund_after_void(o.id);");
  });

  it("declutter_record_refund's whole-order check counts the shipping not held back", () => {
    const { file, sql } = newestFn("declutter_record_refund");
    expect(file >= "20261102051521").toBe(true);
    expect(sql).toContain("- public.declutter_delivery_reserved_cents(p_order_id) + v_order.shipping_cents - public.declutter_shipping_reserved_cents(p_order_id) THEN");
  });

  it("the voided label writes ONE shipping refund of the shipping, only for a buyer-fault refund that left it out", () => {
    const { file, sql } = newestFn("declutter_ship_refund_after_void");
    expect(file >= "20261102051521").toBe(true);
    expect(quoted(/AND d\.reason IN \(([^)]*)\)/.exec(sql)?.[1])).toEqual(BUYER_FAULT);
    expect(sql).toContain("AND d.paid_cents <= o.total_cents - o.shipping_cents) THEN RETURN NULL;");
    expect(sql).toContain("s.label_state = 'voided')");
    expect(sql).toContain("VALUES (o.id, o.stripe_payment_intent_id, 'ship_void_refunded', o.shipping_cents, v_gift) ON CONFLICT (order_id) DO NOTHING");
    const trg = newestFn("declutter_ship_voided_refund");
    expect(trg.sql).toContain("IF NEW.label_state = 'voided' AND OLD.label_state IS DISTINCT FROM 'voided' AND NEW.declutter_order_id IS NOT NULL THEN PERFORM public.declutter_ship_refund_after_void(NEW.declutter_order_id);");
    const t = newestStmt(/CREATE TRIGGER trg_shipments_voided_refund [^;]*;/);
    expect(t.stmt).toBe("CREATE TRIGGER trg_shipments_voided_refund AFTER UPDATE OF label_state ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_voided_refund();");
  });
});
