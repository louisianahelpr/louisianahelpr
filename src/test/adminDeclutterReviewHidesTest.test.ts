/**
 * Owner rule (2026-10-25/27): admin never shows test stuff. The lead's prod
 * walkthrough (2026-10-28) saw an [E2E-PRODAUDIT] fixture in "Declutter:
 * listings to review"; declutter_admin_pending_items leaves out listings
 * whose seller is_seed.
 *
 * 2026-10-28 (#14, builder 3's admin switch): it takes p_include_test boolean
 * DEFAULT false (20261028194414). The DEFAULT keeps the rule: a call with no
 * argument (every installed build) still hides test listings; only an admin
 * who asks sees them. Backend proof:
 * src/test/pglite/declutterAdminPendingIncludeTest.pglite.mjs (3x; 5 planted
 * defects RED, incl. the old no-argument overload left in place, which makes
 * a no-argument call ambiguous).
 *
 * @mutate supabase/migrations/20261028194414_declutter_admin_pending_include_test.sql |        AND (COALESCE(p_include_test, false) OR NOT EXISTS (SELECT 1 FROM public.profiles sp WHERE sp.user_id = i.seller_id AND sp.is_seed)) |        AND true
 * @mutate supabase/migrations/20261028194414_declutter_admin_pending_include_test.sql | p_include_test boolean DEFAULT false) | p_include_test boolean DEFAULT true)
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(__dirname, "..", "..", "supabase", "migrations"));
const body = blankSqlComments(defs.get("declutter_admin_pending_items")?.stmt ?? "");

describe("admin Declutter review card hides test listings", () => {
  it("reads the definition (floor)", () => {
    expect(body.length).toBeGreaterThan(500);
  });

  it("declutter_admin_pending_items leaves out is_seed sellers unless the admin asks", () => {
    expect(body).toMatch(/AND \(COALESCE\(p_include_test, false\) OR NOT EXISTS \(SELECT 1 FROM public\.profiles sp WHERE sp\.user_id = i\.seller_id AND sp\.is_seed\)\)/);
  });

  it("by default (a call with no argument) the test listings stay hidden", () => {
    expect(body).toMatch(/declutter_admin_pending_items\(p_include_test boolean DEFAULT false\)/);
  });
});
