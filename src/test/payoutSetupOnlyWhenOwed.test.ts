/**
 * Payout setup only when money is owed (owner 2026-10-27, firm: "no one should
 * have this option ... This is how Stripe got paused, because so many rejected
 * users. So only do it when necessary."; decided the same day: Declutter "list
 * first, set up at first sale", Shops the same, Rentals out).
 *
 * 20261027163240: payout_setup_hire_allowed lets a seller set up only with a
 * paid Declutter order, a captured Shops order, a delivery they took, or a
 * payout recorded (the declutter / shops / rentals switch lines are gone); and
 * listing, relisting, opening a shop and taking a delivery no longer need a
 * payout account (else no new seller could ever reach a first sale).
 * Behaviour: src/test/pglite/payoutSetupOnlyWhenOwed.pglite.mjs (ALL PASS, the
 * migration 3x; 8 FAIL on prod's bodies, a listing-only seller first). This
 * guard pins it on the NEWEST definitions and on the sell screens.
 *
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |                 WHERE o.seller_id = p_user_id AND o.status IN ('paid', 'handed_over')\n |                 WHERE o.seller_id = p_user_id\n
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |                   AND o.paid_with <> 'free') |                   )
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |                 WHERE so.seller_id = p_user_id AND so.captured_at IS NOT NULL\n |                 WHERE so.seller_id = p_user_id\n
 * @mutate supabase/migrations/20261027163240_payout_setup_only_when_owed.sql |   -- Publish's own checks (authz review 7): a pickup time on file. (No payout | IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN RAISE EXCEPTION 'payout_setup_incomplete'; END IF;\n  -- (No payout
 * @mutate src/components/declutter/DeclutterSellView.tsx |         photoCount >= DECLUTTER_MIN_PHOTOS && ( |         photoCount >= DECLUTTER_MIN_PHOTOS && !payoutBlock && (
 * @mutate src/components/shops/ShopPayoutRow.tsx |   if (setupBlock === "needs_hire" && payoutPrompt.kind === "setup") return null; |
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx |   if (!owed) return null; |   if (false) return null;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("payout setup only when money is owed", () => {
  it("reads the newest definitions (floor)", () => {
    for (const n of ["declutter_relist_listing", "shops_assert_owner_eligible", "shop_owner_sell_block_reason"]) {
      expect(newestFunction(n).file, n).toContain("20261027163240");
    }
    // Restated by item B (live on post, 20261030071816), which keeps this file's no-payout-gate body.
    // And by the check after posting (20261031152545), which keeps the same no-payout-gate body (row 23 stays dropped).
    expect(newestFunction("declutter_publish_item").file).toContain("20261031152545");
    // Restated by the review notice (Q2414), which keeps this file's no-payout-gate body.
    // Restated again by the audit-3 notices (20261028200440: "live" now links ?tab=selling), the same no-payout-gate body.
    expect(newestFunction("declutter_admin_review_item").file).toContain("20261028200440");
    // Restated once more by the Free section, which only adds "a free claim is never money owed".
    expect(newestFunction("payout_setup_hire_allowed").file).toContain("20261027170717");
  });

  it("a seller qualifies only by money owed; no section switch grants it", () => {
    const allow = code("payout_setup_hire_allowed");
    expect(allow).not.toMatch(/feature_enabled_for_user\('(declutter|shops|rentals)'/);
    expect(allow).toContain("FROM public.declutter_orders o WHERE o.seller_id = p_user_id AND o.status IN ('paid', 'handed_over') AND o.paid_with <> 'free')");
    expect(allow).toContain("so.seller_id = p_user_id AND so.captured_at IS NOT NULL AND so.status IN ('accepted', 'handed_over', 'partially_refunded'))");
    expect(allow).toContain("ht.helpr_id = p_user_id AND ht.status IN ('accepted', 'picked_up', 'delivered', 'confirmed'))");
    // Hires unchanged.
    expect(allow).toContain("public.job_payment_is_funded(j.payment_status::text)");
  });

  it("listing, relisting, approving a listing, opening a shop and taking a delivery need no payout account", () => {
    // helpr_task_assert_helpr (independent money review 2026-10-27): with the
    // narrowed payout_setup_hire_allowed, a hard payout gate here locks every
    // new delivery Helpr out (no delivery without an account, no account
    // without one). Its newest body may be this file's (no payout check) or
    // 20261027165232's (the payout_after_hire switch, ready/declutter-delivery-
    // open-1027); either order of landing passes, a hard gate never does.
    for (const n of ["declutter_publish_item", "declutter_relist_listing", "shops_assert_owner_eligible",
      "shop_owner_sell_block_reason", "declutter_admin_review_item", "helpr_task_assert_helpr"]) {
      expect(code(n), n).not.toContain("helper_award_block_reason");
    }
  });

  it("the sell screens list without payouts and prompt only once a sale is owed", () => {
    for (const p of ["src/components/declutter/DeclutterSellView.tsx", "src/components/declutter/SellOneScreen.tsx", "src/components/declutter/DeclutterBunchView.tsx"]) {
      const s = read(p);
      expect(s, p).not.toContain("Set up payouts before you list.");
      expect(s, p).toContain("<SellerPayoutPrompt />");
      expect(s, p).not.toMatch(/useAwardBlockReason|payoutBlock/);
    }
    const prompt = read("src/components/declutter/SellerPayoutPrompt.tsx");
    expect(prompt).toContain("if (!owed) return null;");
    expect(prompt).toContain('if (payoutPrompt.kind !== "setup") return null;');
    expect(prompt).toContain("const owed = usePayoutSetupHireAllowed();");
    expect(read("src/components/declutter/DeclutterSellView.tsx")).not.toMatch(/DECLUTTER_MIN_PHOTOS && !payoutBlock/);
    expect(read("src/components/shops/ShopPayoutRow.tsx")).toContain('if (setupBlock === "needs_hire" && payoutPrompt.kind === "setup") return null;');
  });
});
