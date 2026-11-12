/**
 * Q1947, the rest of "message a shop" (Shops H1 follow-up): the member's shop chats are in Messages -> Shops, an order
 * card opens the chat with the other side, a chat message can be reported (shop_talk_message), and the chat follows
 * the whole shop-state rule. Reads the EFFECTIVE (newest) definitions and the screens that mount it; behaviour on a
 * real database is src/test/pglite/shopsTalkInbox.pglite.mjs (3x, 10 planted defects each RED).
 *
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |       IF v_stm_side = stm.sender_side THEN | IF false THEN
 * @mutate supabase/migrations/20261105225245_shops_talk_inbox_and_reports.sql |   IF NOT public.shop_state_ok(s.id) THEN\n    RAISE EXCEPTION 'talk_closed' |   IF s.hidden_at IS NOT NULL THEN\n    RAISE EXCEPTION 'talk_closed'
 * @mutate supabase/migrations/20261105225245_shops_talk_inbox_and_reports.sql |      OR (v_uid IS DISTINCT FROM o.buyer_id AND v_uid IS DISTINCT FROM v_owner) THEN |      THEN
 * @mutate supabase/migrations/20261105225245_shops_talk_inbox_and_reports.sql | REVOKE ALL ON FUNCTION public.shops_open_order_talk(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.shops_open_order_talk(uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261105225245_shops_talk_inbox_and_reports.sql |   IF NOT public.shop_state_ok(o.shop_id) THEN | IF false THEN
 * @mutate src/pages/messages/useMessageSections.tsx |     if (section === "shops" && shopsOn) empty.Lead = ShopTalkLead;\n |
 * @mutate src/components/shops/ShopOrderCard.tsx |       {order.buyer_id && <ShopOrderMessageButton orderId={order.id} side={side} />}\n |
 * @mutate src/components/shops/ShopTalk.tsx | reportedType="shop_talk_message" | reportedType="message"
 * @mutate src/components/admin/adminReports/reportedShops.ts | ["shop", "shop_item", "shop_talk_message"] | ["shop", "shop_item"]
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).replace(/\s+/g, " ");

describe("Q1947: shop chats in Messages, from an order, and reportable", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of ["shops_open_order_talk", "shops_send_talk_message", "shops_talk_view", "report_message_party_and_copy", "shops_admin_reported"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("a chat message is reported only by the other side of that chat", () => {
    const trg = flat("report_message_party_and_copy");
    expect(trg).toContain("IF NEW.reported_type = 'shop_talk_message' THEN");
    expect(trg).toContain("v_stm_side := public.shop_talk_side(stt.id, NEW.reporter_id); IF v_stm_side IS NULL THEN RAISE EXCEPTION 'report_target_not_found'");
    expect(trg).toContain("IF v_stm_side = stm.sender_side THEN RAISE EXCEPTION 'report_own_content'");
    // The earlier branches stay (H2's shop / shop_item, and the plain message's party rule).
    expect(trg).toContain("IF NEW.reported_type IN ('shop', 'shop_item') THEN");
    expect(trg).toContain("RAISE EXCEPTION 'report_not_allowed'");
    expect(flat("shops_admin_reported")).toContain("'shop_talk_message'::text");
  });

  it("the chat follows the whole shop-state rule, not only hidden_at", () => {
    expect(flat("shops_send_talk_message")).toContain("IF NOT public.shop_state_ok(s.id) THEN RAISE EXCEPTION 'talk_closed'");
    expect(flat("shops_talk_view")).toContain("'open', public.shop_state_ok(s.id) AND NOT public.are_users_blocked(t.buyer_id, s.owner_id)");
  });

  it("an order's chat: either side of the order only, behind the switch, never across a block, never anon", () => {
    const fn = flat("shops_open_order_talk");
    expect(fn).toContain("PERFORM public.require_feature('shops')");
    expect(fn).toContain("OR (v_uid IS DISTINCT FROM o.buyer_id AND v_uid IS DISTINCT FROM v_owner) THEN RAISE EXCEPTION 'order_not_found'");
    expect(fn).toContain("IF public.are_users_blocked(o.buyer_id, v_owner) THEN RAISE EXCEPTION 'talk_blocked'");
    expect(fn).toContain("IF NOT public.shop_state_ok(o.shop_id) THEN RAISE EXCEPTION 'talk_closed'");
    const file = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations", DEFS.get("shops_open_order_talk")?.file ?? ""), "utf8")).replace(/\s+/g, " ");
    expect(file).toContain("REVOKE ALL ON FUNCTION public.shops_open_order_talk(uuid) FROM PUBLIC, anon;");
  });

  it("the screens mount it: the Shops chip lists the chats, the order card has Message, the chat sheet reports", () => {
    expect(src("src/pages/messages/useMessageSections.tsx")).toContain('if (section === "shops" && shopsOn) empty.Lead = ShopTalkLead;');
    expect(src("src/components/messages/ShopTalkInbox.tsx")).toContain("<ShopTalkFromLink />");
    expect(src("src/components/shops/ShopOrderCard.tsx")).toContain("{order.buyer_id && <ShopOrderMessageButton orderId={order.id} side={side} />}");
    for (const f of ["src/components/shops/ShopMyOrdersView.tsx", "src/components/shops/ShopDashboardView.tsx"]) {
      expect(src(f), f).toContain("<ShopTalkFromLink />");
    }
    const sheet = src("src/components/shops/ShopTalk.tsx");
    expect(sheet).toContain('reportedType="shop_talk_message"');
    expect(sheet).toContain("{!m.mine && (");
    expect(src("src/components/admin/adminReports/reportedShops.ts")).toContain('["shop", "shop_item", "shop_talk_message"]');
  });
});
