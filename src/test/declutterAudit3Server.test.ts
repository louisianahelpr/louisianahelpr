/**
 * Declutter audit 3 server fixes (lead 2026-10-28; migration 20261028200440), read from the EFFECTIVE
 * definitions (helpers/effectiveFunctionDefs):
 *   - LO2-1: an empty cart with a seller is an answer ({available: false, reason: 'cart_empty'}), never a raise
 *     (Buying turned the raise into a 500 and an error_logs row on every load);
 *   - A3-4: every listing sent tells the seller (no 10-minute skip; each notice names its item);
 *   - the approval's notices open ?tab=selling.
 * The seller's Helpr-delivery links are src/test/declutterSellerNoticesOpenSelling.test.ts. Backend proof:
 * src/test/pglite/declutterAudit3Server.pglite.mjs (3x; 10 FAIL without the migration; 5 planted defects RED).
 */
// @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql |     RETURN jsonb_build_object('available', false, 'reason', 'cart_empty', |     RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000'; RETURN jsonb_build_object('available', false, 'reason', 'cart_empty',
// @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql |   BEGIN\n    v_title := CASE | BEGIN\n    IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = NEW.seller_id AND n.created_at > now() - interval '10 minutes') THEN RETURN NULL; END IF;\n    v_title := CASE
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

  it("every listing sent tells the seller: no time-window skip", () => {
    expect(SUBMITTED).not.toMatch(/interval '\d+ minutes'/);
    expect(SUBMITTED).not.toMatch(/FROM public\.notifications/);
    expect(SUBMITTED).toContain("'Listing sent for review'");
  });

  it("the approval's notices open the Selling tab", () => {
    expect(REVIEW).not.toContain("?view=selling");
    expect((REVIEW.match(/'\/declutter\?tab=selling', v_uid\)/g) ?? []).length).toBe(2);
  });
});
