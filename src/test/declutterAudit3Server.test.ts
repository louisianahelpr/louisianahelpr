/**
 * Declutter audit 3 server fixes (lead 2026-10-28; migration 20261028200440), read from the EFFECTIVE
 * definitions (helpers/effectiveFunctionDefs):
 *   - LO2-1: an empty cart with a seller is an answer ({available: false, reason: 'cart_empty'}), never a raise
 *     (Buying turned the raise into a 500 and an error_logs row on every load);
 *   - A3-4: every listing sent tells the seller (no 10-minute skip; since 20261030174314 a run of listings is one
 *     notice that counts them all, and a lone listing's notice names its item);
 *   - the approval's notices open ?tab=selling.
 * The seller's Helpr-delivery links are src/test/declutterSellerNoticesOpenSelling.test.ts. Backend proof:
 * src/test/pglite/declutterAudit3Server.pglite.mjs (3x; 10 FAIL without the migration; 5 planted defects RED).
 */
// @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql |     RETURN jsonb_build_object('available', false, 'reason', 'cart_empty', |     RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000'; RETURN jsonb_build_object('available', false, 'reason', 'cart_empty',
// @mutate supabase/migrations/20261030174314_declutter_listings_one_summary_notice.sql |     IF v_prior IS NOT NULL THEN\n      -- A named notice |     IF v_prior IS NOT NULL THEN\n      RETURN NULL;\n      -- A named notice
// @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql | 'Your listing is live',\n      '"' \|\| COALESCE(v_title, 'Your item') \|\| '" is approved. Buyers can see it now.',\n      '/declutter?tab=selling' | 'Your listing is live',\n      '"' \|\| COALESCE(v_title, 'Your item') \|\| '" is approved. Buyers can see it now.',\n      '/declutter?view=selling'
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const OFFER = flat("declutter_seller_delivery_offer");
const SUBMITTED = flat("declutter_listing_submitted_notice");
const REVIEW = flat("declutter_admin_review_item");

describe("Declutter audit 3 server fixes", () => {
  it("reads the three definitions (floors)", () => {
    for (const b of [OFFER, SUBMITTED, REVIEW]) expect(b.length).toBeGreaterThan(800);
  });

  it("an empty cart answers cart_empty, never raises it", () => {
    expect(OFFER).not.toMatch(/RAISE EXCEPTION 'cart_empty'/);
    expect(OFFER).toContain("IF cardinality(v_lines) = 0 THEN RETURN jsonb_build_object('available', false, 'reason', 'cart_empty',");
  });

  it("every listing sent tells the seller: a time window counts it, never skips it", () => {
    // 20261030174314: inside the window the next listing updates the notice's count (declutterBunchOneNotice.test.ts).
    expect(SUBMITTED).toContain("IF v_prior IS NOT NULL THEN v_n := COALESCE(");
    expect(SUBMITTED).toContain("UPDATE public.notifications");
    expect(SUBMITTED).toContain("'Listing sent for review'");
  });

  it("the approval's notices open the Selling tab", () => {
    expect(REVIEW).not.toContain("?view=selling");
    expect((REVIEW.match(/'\/declutter\?tab=selling', v_uid\)/g) ?? []).length).toBe(2);
  });
});
