/**
 * Shops H9 (audit 11-05; spec L46, L69, L70; NOT-LAUNCHED Q2207): shop reviews and the shop's own rating. Reads the
 * EFFECTIVE (newest) definitions and the screens that mount them; behaviour on a real database is
 * src/test/pglite/shopsReviews.pglite.mjs (3x, 11 planted defects each RED).
 *
 * @mutate supabase/migrations/20261105230819_shops_reviews_and_rating.sql |   IF o.handed_over_at IS NULL THEN\n    RAISE EXCEPTION 'not_handed_over' |   IF false THEN\n    RAISE EXCEPTION 'not_handed_over'
 * @mutate supabase/migrations/20261105230819_shops_reviews_and_rating.sql |     CROSS JOIN LATERAL public.shop_review_rating(s.id) rr | CROSS JOIN LATERAL public.get_public_profile_stats(ARRAY[s.owner_id]) rr
 * @mutate supabase/migrations/20261105230819_shops_reviews_and_rating.sql |        AND NOT (r.is_seed AND public.seed_jobs_hidden_publicly())\n |
 * @mutate supabase/migrations/20261105230819_shops_reviews_and_rating.sql | REVOKE ALL ON FUNCTION public.shops_leave_review(uuid, integer, text) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.shops_leave_review(uuid, integer, text) FROM PUBLIC;
 * @mutate src/components/shops/ShopOrderCard.tsx |       <ShopOrderReview orderId={order.id} handedOver={!!order.handed_over_at} />\n |
 * @mutate src/components/shops/ShopView.tsx |         {s.offers_selling && <ShopReviewsCard shopId={s.id} />}\n |
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
const RPCS = ["shops_leave_review", "shops_shop_reviews", "shops_my_order_review"];

describe("Shops H9: shop reviews and the shop's own rating", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of [...RPCS, "shop_review_public", "shop_review_rating", "shop_owner_rating"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(150);
    }
  });

  it("member RPCs are behind the Shops switch and never anon; the helpers are server-only", () => {
    for (const fn of RPCS) {
      expect(flat(fn), fn).toContain("PERFORM public.require_feature('shops')");
      const file = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations", DEFS.get(fn)?.file ?? ""), "utf8")).replace(/\s+/g, " ");
      expect(file, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
  });

  it("a review only after the handover, once a side, through the leak filter", () => {
    const fn = flat("shops_leave_review");
    expect(fn).toContain("IF o.handed_over_at IS NULL THEN RAISE EXCEPTION 'not_handed_over'");
    expect(fn).toContain("public.contact_leak_reason(v_comment) IS NOT NULL THEN RAISE EXCEPTION 'review_contact_info'");
    expect(fn).toContain("ON CONFLICT (order_id, reviewer_side) DO NOTHING");
  });

  it("blind until both or 14 days; removed and test reviews stay out; the rating is the shop's own, from 3", () => {
    const pub = flat("shop_review_public");
    expect(pub).toContain("r.removed_at IS NULL");
    expect(pub).toContain("o.handed_over_at <= now() - interval '14 days'");
    expect(pub).toContain("AND NOT (r.is_seed AND public.seed_jobs_hidden_publicly())");
    expect(flat("shop_owner_rating")).toContain("CROSS JOIN LATERAL public.shop_review_rating(s.id) rr");
    expect(flat("shop_owner_rating")).not.toMatch(/get_public_profile_stats/);
  });

  it("the screens mount it: Leave a review on the order card, the reviews card on the shop page", () => {
    expect(src("src/components/shops/ShopOrderCard.tsx")).toContain("<ShopOrderReview orderId={order.id} handedOver={!!order.handed_over_at} />");
    expect(src("src/components/shops/ShopView.tsx")).toContain("{s.offers_selling && <ShopReviewsCard shopId={s.id} />}");
  });
});
