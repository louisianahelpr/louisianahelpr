/**
 * GUARD (Shops audit 11-12, launch-blocking Highs S002-S006; migration 20261112073633, proof
 * src/test/pglite/shopsAuditHighs.pglite.mjs). Built from the NEWEST definition of each function:
 *   S002 shops_confirm_pickup refuses before the ready day unless ready / handed over; the buyer's button waits too.
 *   S003 shop_mark_order_held's preorder branch runs the accept checks (hidden shop, sell block, ban, home-food
 *        limit WITH this order) before the hold becomes an accept.
 *   S004 shops_report_no_show refuses a Helpr-delivered order not fallen back to pickup; the shop's button hides.
 *   S005 every Shops notice to a buyer whose words say money is coming back is emailed (and every such title the
 *        newest Shops functions send says so in its body).
 *   S006 no Shops notice promises "add your side on the order".
 *   S001 shops_admin_set_hidden refunds every charged open order in full ('shop_removed', the shop pays the card cost)
 *        and closes every waiting one, on every hide; the admin's dialog says so (migration 20261112074135, proof
 *        src/test/pglite/shopsHideRefunds.pglite.mjs).
 *
 * @mutate supabase/migrations/20261112073633_shops_audit_highs.sql |   IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN | IF false THEN
 * @mutate supabase/migrations/20261112073633_shops_audit_highs.sql |      AND public.shop_local_today() < o.ready_date\n |      AND false\n
 * @mutate supabase/migrations/20261112073633_shops_audit_highs.sql |        OR public.shop_owner_sell_block_reason(o.seller_id) IS NOT NULL\n |
 * @mutate supabase/migrations/20261112075702_shops_cottage_limit_strict.sql |                 + v_pre_home_food >= (SELECT c.cap_cents |                 >= (SELECT c.cap_cents
 * @mutate supabase/migrations/20261112073633_shops_audit_highs.sql |          AND (NEW.message ILIKE '%refund%' OR NEW.message ILIKE '%back to your card%' OR NEW.message ILIKE '%coming back%')))) |          AND false))
 * @mutate supabase/migrations/20261112074135_shops_hide_refunds_open_orders.sql |       r := public.shop_write_refund(o.id, 'shop_removed', left(btrim(p_reason), 500)); |       r := NULL;
 * @mutate supabase/migrations/20261112074135_shops_hide_refunds_open_orders.sql |               WHERE so.shop_id = p_shop_id AND so.status IN ('held', 'awaiting_hold') ORDER BY so.id FOR UPDATE |               WHERE false
 * @mutate src/components/shops/ShopOrderCancel.tsx |   const noShowOpen = order.handover_mode === "in_person" && !helprDelivers && (markedReady \|\| isServiceOrder(order)) | const noShowOpen = order.handover_mode === "in_person" && (markedReady \|\| isServiceOrder(order))
 * @mutate src/components/shops/ShopHandoverActions.tsx |           {(due \|\| !!h?.ready_at \|\| !!h?.shop_confirmed_at) && (\n            <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setConfirming(true)}> |           {true && (\n            <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setConfirming(true)}>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIGRATIONS);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const body = (fn: string) => flat(DEFS.get(fn)?.stmt ?? "");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("Shops audit 11-12 Highs", () => {
  it("S004: a Helpr-delivered order is never the buyer's no-show (server and button)", () => {
    expect(body("shops_report_no_show")).toContain("IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN RAISE EXCEPTION 'helpr_delivery_no_show'");
    expect(read("src/components/shops/ShopOrderCancel.tsx")).toMatch(/const helprDelivers = order\.fulfillment === "helpr_delivers" && !order\.helpr_unfilled_at;\s+const noShowOpen = order\.handover_mode === "in_person" && !helprDelivers && \(markedReady \|\| isServiceOrder\(order\)\)/);
  });

  it("S002: \"I got it\" waits for the ready day, a ready mark or the shop's handover (server and button)", () => {
    const b = body("shops_confirm_pickup");
    expect(b).toContain("AND public.shop_local_today() < o.ready_date AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND (h.ready_at IS NOT NULL OR h.shop_confirmed_at IS NOT NULL)) THEN RAISE EXCEPTION 'not_ready_yet'");
    expect(b.indexOf("not_ready_yet")).toBeLessThan(b.indexOf("shop_complete_handover"));
    expect(read("src/components/shops/ShopHandoverActions.tsx")).toMatch(/\{\(due \|\| !!h\?\.ready_at \|\| !!h\?\.shop_confirmed_at\) && \(\s+<Button type="button" size="sm" className="btn-grad-primary" disabled=\{busy\} onClick=\{\(\) => setConfirming\(true\)\}>\s+\{w\.buyerGotIt\}/);
    expect(read("src/lib/shops/errors.ts")).toContain('not_ready_yet: "You can confirm once it\'s ready."');
  });

  it("S003: a preorder's hold runs the accept checks before it becomes an accept", () => {
    const b = body("shop_mark_order_held");
    const checks = b.indexOf("SELECT 1 FROM public.shops s WHERE s.id = o.shop_id AND s.hidden_at IS NOT NULL");
    expect(checks).toBeGreaterThan(0);
    for (const c of ["OR public.shop_owner_sell_block_reason(o.seller_id) IS NOT NULL", "pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')",
      // S033 (20261112075702): ">=", reaching the limit exactly is refused too.
      "+ v_pre_home_food >= (SELECT c.cap_cents FROM public.shop_cottage_settings c WHERE c.id)"]) {
      expect(b, c).toContain(c);
    }
    expect(checks).toBeLessThan(b.indexOf("SET status = 'accepted', accepted_at = now()"));
  });

  it("S005: every buyer Shops notice that says money is coming back is emailed", () => {
    const last = [...files].reverse().find((f) => read(`supabase/migrations/${f}`).includes("CREATE TRIGGER trg_email_shop_order_notice"))!;
    const sql = flat(read(`supabase/migrations/${last}`));
    expect(sql).toContain("OR (NEW.link LIKE '/shops/orders%' AND (NEW.message ILIKE '%refund%' OR NEW.message ILIKE '%back to your card%' OR NEW.message ILIKE '%coming back%'))))");
  });

  it("S006: no newest Shops function promises \"add your side on the order\"", () => {
    for (const [name, def] of DEFS) {
      if (!/^shops?_/.test(name)) continue;
      expect(flat(def.stmt), name).not.toMatch(/add your side on the order/i);
    }
  });

  it("S001: hiding a shop refunds its charged open orders in full and closes its waiting ones", () => {
    const b = body("shops_admin_set_hidden");
    expect(b).toContain("IF p_hidden THEN FOR c IN SELECT so.id FROM public.shop_orders so WHERE so.shop_id = p_shop_id AND so.status = 'accepted'");
    expect(b).toContain("o := public.shop_lock_open_charged_order(c.id, true);");
    expect(b).toContain("r := public.shop_write_refund(o.id, 'shop_removed',");
    expect(b).toContain("WHERE so.shop_id = p_shop_id AND so.status IN ('held', 'awaiting_hold')");
    expect(body("shop_refund_fee_policy")).toContain("WHEN p_reason IN ('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault') THEN 'full_shop_pays_fee'");
    expect(read("src/components/admin/adminReports/ShopReportPanel.tsx")).toContain("Open orders are refunded in full, and orders still waiting are cancelled with no charge.");
  });
});
