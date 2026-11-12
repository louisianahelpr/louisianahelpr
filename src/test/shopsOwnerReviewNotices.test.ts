/**
 * Shops audit 11-12: S007 (test shop items never show in the owner's new-items card), S008 (the seller hears an
 * approve or reject), S048 (the pickup-problem admin alert skips test data by itself). Reads the EFFECTIVE (newest)
 * definitions; behaviour on a real database is src/test/pglite/shopsOwnerReviewNotices.pglite.mjs (3x; skip red;
 * 11 planted defects each RED).
 *
 * @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql | (i.is_seed OR s.is_seed OR public.is_test_subject(i.owner_id)) | (i.is_seed OR s.is_seed)
 * @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql | PERFORM public.declutter_notify(v_owner, 'info', 'Your item is live', | PERFORM public.declutter_notify(v_owner, 'info', 'Approved',
 * @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql | PERFORM public.declutter_notify(v_owner, 'warning', 'Your item wasn''t approved', | PERFORM public.declutter_notify(v_owner, 'warning', 'Rejected',
 * @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql |   IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN |   IF true THEN
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |   return withoutTestRows(await fetchPendingShopItems()); |   return fetchPendingShopItems();
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("S007 / S008 / S048: Shops owner-side review and alerts", () => {
  it("S007: the pending-items queue says which rows are test, and the owner's card drops them", () => {
    const q = flat("shops_admin_pending_items");
    expect(q.length).toBeGreaterThan(800);
    expect(q).toContain("owner_last_rejection_note text, is_seed boolean)");
    expect(q).toContain("(i.is_seed OR s.is_seed OR public.is_test_subject(i.owner_id))");
    const card = readFileSync(resolve(__dirname, "../components/admin/settings/ShopItemsReviewCard.tsx"), "utf8");
    expect(card).toContain("return withoutTestRows(await fetchPendingShopItems());");
    expect(card).toContain("queryFn: loadPendingItems");
  });

  it("S008: approving or rejecting a held item tells the seller", () => {
    const r = flat("shops_admin_review_item");
    expect(r).toContain("IF p_approve THEN PERFORM public.declutter_notify(v_owner, 'info', 'Your item is live',");
    expect(r).toContain("ELSE PERFORM public.declutter_notify(v_owner, 'warning', 'Your item wasn''t approved',");
    expect(r).toContain("Why: %s. For the next 30 days, your new items get a quick check before they show.");
    expect(r).toContain("v_title, rtrim(v_note, '.')), 1000), '/shops/mine');");
    // The notices are sent only after the decision was written (a refused or stale review sends nothing).
    expect(r.indexOf("INSERT INTO public.admin_audit_log")).toBeLessThan(r.indexOf("'Your item is live'"));
  });

  it("S048: the pickup-problem admin alert skips test orders and test accounts itself", () => {
    const r = flat("shops_report_not_received");
    expect(r).toMatch(
      /IF NOT \(o\.is_seed OR public\.is_test_subject\(o\.buyer_id\) OR public\.is_test_subject\(o\.seller_id\)\) THEN FOR a IN SELECT DISTINCT ur\.user_id FROM public\.user_roles ur WHERE ur\.role = 'admin' LOOP PERFORM public\.declutter_notify\(a\.user_id, 'warning', 'Shops pickup problem reported',/,
    );
  });
});
