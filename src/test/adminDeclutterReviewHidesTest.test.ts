/**
 * Owner rule (2026-10-25/27): admin never shows test stuff. The lead's prod
 * walkthrough (2026-10-28) saw an [E2E-PRODAUDIT] fixture in "Declutter:
 * listings to review"; declutter_admin_pending_items now leaves out listings
 * whose seller is_seed.
 *
 * @mutate supabase/migrations/20261028022715_admin_declutter_review_hides_test_listings.sql |        AND NOT EXISTS (SELECT 1 FROM public.profiles sp WHERE sp.user_id = i.seller_id AND sp.is_seed) |        AND true
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(__dirname, "..", "..", "supabase", "migrations"));

describe("admin Declutter review card hides test listings", () => {
  it("declutter_admin_pending_items leaves out is_seed sellers", () => {
    const body = blankSqlComments(defs.get("declutter_admin_pending_items")?.stmt ?? "");
    expect(body).toMatch(/AND NOT EXISTS \(SELECT 1 FROM public\.profiles sp WHERE sp\.user_id = i\.seller_id AND sp\.is_seed\)/);
  });
});
