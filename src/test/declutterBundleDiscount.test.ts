/**
 * Q2427 Declutter bundle discounts (owner 2026-10-27): "Buy 2+, get N% off".
 *
 * One rule per seller (5-50%). At checkout every PAID line from that seller is N% off its own price when there are 2
 * or more, never below the item's private lowest price (or $1), never above the original; free lines never count or
 * change. The discount lands on the line prices, so the fee is on the discounted paid total, the seller is paid it,
 * and refunds are of what was paid. A changed or removed rule opens a new order. Members see "Bundle discount -$X"
 * and the total, never fee math.
 *
 * Behaviour: src/test/pglite/declutterBundleDiscount.pglite.mjs (65 PASS with 20261027211754 applied 3x on the
 * safe-meetup world, prod's bodies md5-checked; RED with it absent, the floor clamp planted out (1), Buy 2+ planted
 * to 1+ (3+), the new idempotency clause planted out (3+), and the cart's original-price display planted out (1)).
 *
 * @mutate supabase/migrations/20261027211754_declutter_bundle_discount.sql |              THEN LEAST(b.base, GREATEST(100, COALESCE(b.floor, 100),\n                         round(b.base * (100 - (SELECT percent FROM r)) / 100.0)::integer)) |              THEN round(b.base * (100 - (SELECT percent FROM r)) / 100.0)::integer
 * @mutate supabase/migrations/20261027211754_declutter_bundle_discount.sql |         CASE WHEN b.base > 0 AND (SELECT paid FROM n) >= 2 AND EXISTS (SELECT 1 FROM r) |         CASE WHEN b.base > 0 AND (SELECT paid FROM n) >= 1 AND EXISTS (SELECT 1 FROM r)
 * @mutate supabase/migrations/20261101201500_shipping_s3_checkout_claim.sql |      AND v_existing.items_cents = v_items |
 * @mutate supabase/migrations/20261027211754_declutter_bundle_discount.sql |   IF p_percent NOT BETWEEN 5 AND 50 THEN |   IF p_percent NOT BETWEEN 1 AND 100 THEN
 * @mutate supabase/migrations/20261101201500_shipping_s3_checkout_claim.sql |    v_delivery := public.declutter_seller_delivery_rate_cents(sd.base_rate_cents, sd.free_over_cents, v_items); |    v_delivery := sd.rate_cents;
 * @mutate supabase/migrations/20261027211754_declutter_bundle_discount.sql |   SELECT COALESCE(sum(t.target_cents), 0)::integer INTO v_items FROM public.declutter_bundle_targets(p_seller, p_lines) t; |   SELECT COALESCE(sum(c.price_cents), 0)::integer INTO v_items FROM public.declutter_cart_items c WHERE c.id = ANY (p_lines);
 * @mutate src/components/declutter/DeclutterBundleRow.tsx |         {b.offer ? <span className="font-semibold text-primary" data-bundle-offer=""> {b.offer}.</span> : null} |
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       <BundleDiscountCard />\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { bundleLabel, BUNDLE_PERCENTS } from "@/lib/declutter/bundle";

const FILE = "20261027211754";
const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");

describe("Q2427 bundle discounts: the server", () => {
  it("reads the newest definitions (floor)", () => {
    const names = ["declutter_bundle_targets", "declutter_set_bundle_discount", "declutter_bundle_rule", "declutter_bundle_preview",
      "declutter_start_checkout", "declutter_my_cart", "declutter_seller_delivery_check"];
    // declutter_start_checkout and declutter_my_cart: restated by 20261028235247 (the ways the seller ticked), the bundle rule kept;
    // declutter_my_cart again by DB-5 (20261030064929, each line's source) and DC-18 (20261030131715, the kept title and
    // closed_at), and 20261101175510 (test items left out of the cart), the bundle rule kept (asserted below).
    const RESTATED: Record<string, string> = { declutter_start_checkout: "20261101191500", declutter_my_cart: "20261101175510" };
    // declutter_start_checkout: restated again by 20261101191500 (B110: the pickup time, kept and frozen; the bundle rule verbatim), 20261101032626 (BUY-1 follow-up: no new page after the hold + 10 min, two predicates only), 20261030164712 (D-NEW14 porch places, insertion only) and 20261031164337
    // (LEAD-PLACE-TIMES: door pickup at the place, one condition), the bundle rule kept.
    for (const n of names) expect(newestFunction(n).file, n).toContain(RESTATED[n] ?? FILE);
    expect(names.length).toBeGreaterThan(5);
  });

  it("each paid line N% off its own original, 2+ paid lines, never below the floor or $1, never above the original", () => {
    const t = code("declutter_bundle_targets");
    expect(t).toContain("COALESCE(c.list_price_cents, c.price_cents) AS base, p.floor_price_cents AS floor");
    expect(t).toContain("CASE WHEN b.base > 0 AND (SELECT paid FROM n) >= 2 AND EXISTS (SELECT 1 FROM r)");
    expect(t).toContain("THEN LEAST(b.base, GREATEST(100, COALESCE(b.floor, 100), round(b.base * (100 - (SELECT percent FROM r)) / 100.0)::integer))");
    expect(t).toContain("count(*) FILTER (WHERE b.base > 0) AS paid");
  });

  it("checkout applies it to the locked lines, records it, and never hands back an order at another total", () => {
    const sc = code("declutter_start_checkout");
    const apply = sc.indexOf("UPDATE public.declutter_cart_items c SET price_cents = t.target_cents");
    expect(apply).toBeGreaterThan(sc.indexOf("ORDER BY c.item_id FOR UPDATE"));
    expect(apply).toBeLessThan(sc.indexOf("v_premium := CASE"));
    expect(sc).toContain("AND v_existing.items_cents = v_items");
    expect(sc).toContain("setup_fee_cents, bundle_discount_cents) VALUES");
    // The fee is on the discounted items (v_items after the update), the seller-delivery rate included.
    expect(sc).toContain("ELSE public.declutter_buyer_fee_cents(v_items) END;");
  });

  it("seller delivery's free-over-$X reads the bundle total, so the offer and checkout agree (lh-money-escrow #1)", () => {
    const check = code("declutter_seller_delivery_check");
    expect(check).toContain("SELECT COALESCE(sum(t.target_cents), 0)::integer INTO v_items FROM public.declutter_bundle_targets(p_seller, p_lines) t;");
    expect(check).not.toContain("sum(c.price_cents)");
    // Checkout prices the delivery from its own locked items total, never the check's later re-computation.
    const sc = code("declutter_start_checkout");
    expect(sc).toContain("v_delivery := public.declutter_seller_delivery_rate_cents(sd.base_rate_cents, sd.free_over_cents, v_items);");
    expect(sc).not.toContain("v_delivery := sd.rate_cents;");
  });

  it("the rule: 5-50, the caller's own, Declutter on; members read only the percent; the computation stays server-side", () => {
    const set = code("declutter_set_bundle_discount");
    expect(set).toContain("PERFORM public.require_feature('declutter');");
    expect(set).toContain("IF p_percent NOT BETWEEN 5 AND 50 THEN");
    expect(set).toContain("v_uid := public.declutter_assert_member(true);");
    const sql = blankSqlComments(readFileSync(`supabase/migrations/${FILE}_declutter_bundle_discount.sql`, "utf8")).replace(/\s+/g, " ");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_bundle_targets(uuid, uuid[]) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.declutter_bundle_rules FROM PUBLIC, anon, authenticated;");
    expect(code("declutter_my_cart")).toContain("CASE WHEN c.status = 'in_cart' THEN COALESCE(c.list_price_cents, c.price_cents) ELSE c.price_cents END");
  });
});

describe("Q2427 bundle discounts: the screens", () => {
  it("the label and the choices", () => {
    expect(bundleLabel(10)).toBe("Buy 2+, get 10% off");
    expect([...BUNDLE_PERCENTS].every((p) => p >= 5 && p <= 50)).toBe(true);
    expect(BUNDLE_PERCENTS.length).toBeGreaterThan(4);
  });

  it("the item page's bundle row says the offer; Declutter settings shows the setting; no fee numbers in the new copy", () => {
    // The row's summary hook names the rule (bundleLabel) and the row prints it as its own sentence.
    expect(read("src/components/declutter/DeclutterBundleRow.tsx")).toContain("bundleLabel(rule.data)");
    expect(read("src/components/declutter/DeclutterBundleRow.tsx")).toContain("{b.offer}.</span>");
    // LEAD-BUNDLE-DROPDOWN (2026-10-31): a row in Listing defaults (on Declutter settings), under the free-after row.
    expect(read("src/components/declutter/DeclutterListingDefaults.tsx")).toContain("<BundleDiscountCard />");
    expect(read("src/pages/declutter/DeclutterSettingsPage.tsx")).toContain("<ListingDefaultsCard userId={user.id} />");
    const card = blankComments(readFileSync("src/components/declutter/BundleDiscountCard.tsx", "utf8"));
    expect(card).not.toMatch(/\bfees?\b|\$\d/i);
  });
});
