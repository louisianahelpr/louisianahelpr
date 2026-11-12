/**
 * GUARD (Shops audit 11-12 Mediums; migration 20261112075006, proof src/test/pglite/shopsAuditMediums.pglite.mjs):
 *   S012 a handed-over (final) order is grouped under Done, not Accepted, on the buyer's Orders.
 *   S013 the order card shows the cancel rule only while the buyer can still cancel (held / accepted, not handed over).
 *   S015 the shop has no "Handed over" on a Helpr-delivered order (server refuses; button hidden), unless it fell back.
 *   S019 the buyer's missed-delivery notice reads the right way round.
 *   S033 the home-food yearly limit refuses an order that reaches EXACTLY $100,000 (">=", La. R.S. 40:4.9(B)), at accept
 *        and at a preorder's hold (20261112075702, proof src/test/pglite/shopsCottageLimitStrict.pglite.mjs).
 *   S033 follow-up: a custom home-food price counts its own amount (and accepted, not-yet-charged orders) when the shop
 *        sends it and when the buyer orders it (20261112080238, proof src/test/pglite/shopsCustomCottageLimit.pglite.mjs).
 *   S011 the shop's payout notice names the amount really sent (setup fee out of the first payout) and "Verify your ID"
 *        while the payout waits for it; S017 ready / handed over / problem / done notices say "done" for a service and
 *        "delivered" for a delivery (20261112081213, proof src/test/pglite/shopsNoticeWords.pglite.mjs).
 *   S035 a refund that is not the buyer's doing gives the one-time setup fee back too and puts the account's fee back
 *        (20261112082518, proof src/test/pglite/shopsSetupFeeRefund.pglite.mjs).
 *   S016 the needs-you reminder sweep reminds the shop about an order waiting on its answer (20261112075428, proof
 *        src/test/pglite/shopsAcceptReminders.pglite.mjs).
 *
 * @mutate supabase/migrations/20261112080238_shops_custom_order_cottage_limit.sql |     IF public.shop_cottage_would_reach(v_uid, p_quote_cents) THEN |     IF public.shop_cottage_cap_reached(v_uid) THEN
 * @mutate supabase/migrations/20261112080238_shops_custom_order_cottage_limit.sql | public.shop_cottage_would_reach(s.owner_id, r.quote_cents) THEN | public.shop_cottage_cap_reached(s.owner_id) THEN
 * @mutate supabase/migrations/20261112080238_shops_custom_order_cottage_limit.sql |                           + p_add_cents >= c.cap_cents |                           + p_add_cents > c.cap_cents
 * @mutate supabase/migrations/20261112075702_shops_cottage_limit_strict.sql |          + v_home_food >= v_cottage_cap THEN |          + v_home_food > v_cottage_cap THEN
 * @mutate supabase/migrations/20261112075702_shops_cottage_limit_strict.sql |                 + v_pre_home_food >= (SELECT c.cap_cents |                 + v_pre_home_food > (SELECT c.cap_cents *
 * @mutate supabase/migrations/20261112075428_shops_accept_reminders.sql |      WHERE so.status = 'held' AND so.accept_by IS NOT NULL |      WHERE false AND so.accept_by IS NOT NULL *
 * @mutate supabase/migrations/20261112075428_shops_accept_reminders.sql |     WHEN p_type = 'new_offers' AND p_title IN ('Answer the new order', 'Order drops soon') THEN 'needs_you' |     WHEN false THEN 'needs_you'
 * @mutate supabase/migrations/20261112075428_shops_accept_reminders.sql | n.type IN ('declutter_offers', 'declutter_refunds', 'new_offers') THEN | n.type IN ('declutter_offers', 'declutter_refunds') THEN
 * @mutate supabase/migrations/20261112075428_shops_accept_reminders.sql | WHERE so.id = s.ref_id AND so.status = 'held' AND so.accept_by = s.deadline | WHERE so.id = s.ref_id AND so.accept_by = s.deadline
 * @mutate supabase/migrations/20261112081213_shops_notice_words_s011_s017.sql |     v_setup_fee := COALESCE(public.declutter_setup_fee_from_payout_cents(o.seller_id), 0); |     v_setup_fee := 0;
 * @mutate supabase/migrations/20261112081213_shops_notice_words_s011_s017.sql |       WHEN public.payout_waits_on_identity(o.seller_id) THEN |       WHEN false THEN
 * @mutate supabase/migrations/20261112081213_shops_notice_words_s011_s017.sql | (l.kind = 'service' OR COALESCE(l.at_buyer, false)) | (l.kind = 'service')
 * @mutate supabase/migrations/20261112082518_shops_setup_fee_refund.sql | CASE WHEN o.policy IN ('full_shop_pays_fee', 'full_platform_absorbs') THEN o.setup_fee ELSE 0 END | o.setup_fee
 * @mutate supabase/migrations/20261112082518_shops_setup_fee_refund.sql | CASE WHEN so.setup_fee_state = 'claimed' THEN so.setup_fee_cents ELSE 0 END | so.setup_fee_cents
 * @mutate supabase/migrations/20261112082518_shops_setup_fee_refund.sql |     UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL WHERE user_id = o.buyer_id; | 
 * @mutate src/components/shops/ShopDashboardView.tsx | formatCents(accepting.items_cents + (accepting.fulfillment === "shop_delivers" ? accepting.delivery_cents ?? 0 : 0)) | formatCents(accepting.items_cents)
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
  it("S033: reaching the home-food limit exactly is refused (accept and preorder hold)", () => {
    expect(body("shops_accept_order")).toContain("+ v_home_food >= v_cottage_cap THEN");
    expect(body("shop_mark_order_held")).toContain("+ v_pre_home_food >= (SELECT c.cap_cents FROM public.shop_cottage_settings c WHERE c.id))) THEN");
  });
  it("S033 follow-up: a custom home-food price counts its own amount (quote and order)", () => {
    expect(body("shops_quote_custom_request")).toContain("IF public.shop_cottage_would_reach(v_uid, p_quote_cents) THEN");
    expect(body("shops_order_custom_quote")).toContain("IF v_kind = 'home_food' AND public.shop_cottage_would_reach(s.owner_id, r.quote_cents) THEN");
    const h = body("shop_cottage_would_reach");
    expect(h).toContain("x.status = 'accepted' AND x.captured_at IS NULL");
    expect(h).toContain("+ p_add_cents >= c.cap_cents");
  });
  it("S016: the shop is reminded before a waiting order drops", () => {
    const b = body("sweep_needs_you_reminders");
    expect(b).toContain("SELECT 'shop_order', so.id, so.accept_by, so.seller_id, so.buyer_id, 'seller',");
    expect(b).toContain("WHERE so.status = 'held' AND so.accept_by IS NOT NULL AND so.accept_by > p_now AND so.accept_by <= p_now + interval '12 hours' AND COALESCE(so.is_seed, false) = false");
    expect(b).toContain("PERFORM public.declutter_notify_strict(r.to_id, 'new_offers', v_title, v_body, '/shops/dashboard', r.other_id);");
    // Texted as needs-you (ahead of the job-offer row on the same type), and dropped at claim once answered.
    const kind = body("sms_kind_for");
    expect(kind).toContain("WHEN p_type = 'new_offers' AND p_title IN ('Answer the new order', 'Order drops soon') THEN 'needs_you'");
    expect(kind.indexOf("'Answer the new order'")).toBeLessThan(kind.indexOf("'New job offer'"));
    const claim = body("sms_claim_due");
    expect(claim).toContain("n.type IN ('declutter_offers', 'declutter_refunds', 'new_offers') THEN");
    expect(claim).toContain("WHEN 'shop_order' THEN EXISTS ( SELECT 1 FROM public.shop_orders so WHERE so.id = s.ref_id AND so.status = 'held' AND so.accept_by = s.deadline AND so.seller_id = s.user_id)");
  });
  it("S011: the payout notice names what is really sent, and the ID wait", () => {
    const b = body("shop_complete_handover");
    expect(b).toContain("v_setup_fee := COALESCE(public.declutter_setup_fee_from_payout_cents(o.seller_id), 0);");
    expect(b).toContain("IF v_setup_fee <= 0 OR v_send - v_setup_fee < 100");
    expect(b).toContain("WHEN public.payout_waits_on_identity(o.seller_id) THEN format('Verify your ID in Settings to get your $%s.");
    expect(b).not.toContain("format('$%s is on its way to your payout account ($%s card cost you owed was taken out).'");
  });
  it("S017: notices say done for a service and delivered for a delivery", () => {
    expect(body("shop_order_is_service")).toContain("(l.kind = 'service' OR COALESCE(l.at_buyer, false))");
    expect(body("shops_mark_ready")).toContain("WHEN public.shop_order_is_service(o.id) THEN format('The shop is ready for your order for %s.");
    expect(body("shops_mark_handed_over")).toContain("CASE WHEN public.shop_order_is_service(o.id) THEN 'The shop says the work is done'");
    expect(body("shops_report_not_received")).toContain("WHEN o.fulfillment IN ('shop_delivers', 'helpr_delivers') THEN 'Delivery problem reported'");
    expect(body("shop_complete_handover")).toContain("WHEN public.shop_order_is_service(o.id) THEN 'The work is done and the order is final.");
  });
  it("S035: a refund that is not the buyer's doing gives the setup fee back and puts the account's fee back", () => {
    const a = body("shop_refund_amounts");
    expect(a).toContain("CASE WHEN so.setup_fee_state = 'claimed' THEN so.setup_fee_cents ELSE 0 END AS setup_fee");
    expect(a).toContain("CASE WHEN o.policy IN ('full_shop_pays_fee', 'full_platform_absorbs') THEN o.setup_fee ELSE 0 END AS fee_back");
    expect(a).toContain("+ k.fee_back, k.fee_back FROM k;");
    const w = body("shop_write_refund");
    expect(w).toContain("IF a.setup_fee_refund_cents > 0 AND o.buyer_id IS NOT NULL THEN UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL WHERE user_id = o.buyer_id;");
  });
  it("S047: the accept dialog's amount includes the shop's own delivery fee", () => {
    const src = read("src/components/shops/ShopDashboardView.tsx");
    expect(src).toContain('formatCents(accepting.items_cents + (accepting.fulfillment === "shop_delivers" ? accepting.delivery_cents ?? 0 : 0))');
  });
});
