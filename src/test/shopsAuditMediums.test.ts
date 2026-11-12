/**
 * GUARD (Shops audit 11-12 Mediums; migration 20261112075006, proof src/test/pglite/shopsAuditMediums.pglite.mjs):
 *   S012 a handed-over (final) order is grouped under Done, not Accepted, on the buyer's Orders.
 *   S013 the order card shows the cancel rule only while the buyer can still cancel (held / accepted, not handed over).
 *   S015 the shop has no "Handed over" on a Helpr-delivered order (server refuses; button hidden), unless it fell back.
 *   S019 the buyer's missed-delivery notice reads the right way round.
 *   S016 the needs-you reminder sweep reminds the shop about an order waiting on its answer (20261112075428, proof
 *        src/test/pglite/shopsAcceptReminders.pglite.mjs).
 *
 * @mutate supabase/migrations/20261112075428_shops_accept_reminders.sql |      WHERE so.status = 'held' AND so.accept_by IS NOT NULL |      WHERE false AND so.accept_by IS NOT NULL *
 * @mutate src/components/shops/ShopMyOrdersView.tsx |   if (o.status === "accepted") return "accepted"; |   if (o.status === "accepted" \|\| o.status === "handed_over") return "accepted";
 * @mutate src/components/shops/ShopOrderCard.tsx |           {CANCEL_RULE_VISIBLE.has(order.status) && !order.handed_over_at | {true
 * @mutate src/components/shops/ShopHandoverActions.tsx |           {!porch && !byHelpr && due && !h?.shop_confirmed_at && ( |           {!porch && due && !h?.shop_confirmed_at && (
 * @mutate supabase/migrations/20261112075006_shops_audit_mediums.sql |   IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN\n    RAISE EXCEPTION 'helpr_delivers_handover' |   IF false THEN\n    RAISE EXCEPTION 'helpr_delivers_handover'
 * @mutate supabase/migrations/20261112075006_shops_audit_mediums.sql | The shop says you weren''t there for the delivery | The shop says you didn''t receive the delivery
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("Shops audit 11-12 Mediums", () => {
  it("S012: a handed-over order is Done", () => {
    const src = read("src/components/shops/ShopMyOrdersView.tsx");
    expect(src).toMatch(/if \(o\.status === "held"\) return "waiting";[\s\S]*?if \(o\.status === "accepted"\) return "accepted";\s+return "done";/);
    expect(src).not.toMatch(/o\.status === "handed_over"\) return "accepted"/);
  });
  it("S013: the cancel rule shows only while the buyer can still cancel", () => {
    const src = read("src/components/shops/ShopOrderCard.tsx");
    expect(src).toContain('const CANCEL_RULE_VISIBLE = new Set(["held", "accepted"]);');
    expect(src).toContain("{CANCEL_RULE_VISIBLE.has(order.status) && !order.handed_over_at");
  });
  it("S015: no shop \"Handed over\" on a Helpr-delivered order (server and button)", () => {
    expect(body("shops_mark_handed_over")).toContain("IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN RAISE EXCEPTION 'helpr_delivers_handover'");
    const src = read("src/components/shops/ShopHandoverActions.tsx");
    expect(src).toContain('const byHelpr = order.fulfillment === "helpr_delivers" && !order.helpr_unfilled_at;');
    expect(src).toContain("{!porch && !byHelpr && due && !h?.shop_confirmed_at && (");
  });
  it("S019: the missed-delivery notice reads the right way round", () => {
    const b = body("shops_report_no_show");
    expect(b).toContain("The shop says you weren''t there for the delivery");
    expect(b).not.toContain("didn''t receive the delivery");
  });
  it("S016: the shop is reminded before a waiting order drops", () => {
    const b = body("sweep_needs_you_reminders");
    expect(b).toContain("SELECT 'shop_order', so.id, so.accept_by, so.seller_id, so.buyer_id, 'seller',");
    expect(b).toContain("WHERE so.status = 'held' AND so.accept_by IS NOT NULL AND so.accept_by > p_now AND so.accept_by <= p_now + interval '12 hours' AND COALESCE(so.is_seed, false) = false");
    expect(b).toContain("PERFORM public.declutter_notify_strict(r.to_id, 'new_offers', v_title, v_body, '/shops/dashboard', r.other_id);");
  });
});
