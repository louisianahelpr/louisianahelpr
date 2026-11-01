/**
 * App Review sees only what ordinary members see (lead 2026-11-01).
 *
 * The App Review demo account is in test_accounts (Stripe TEST mode, kept out
 * of stats and alerts), and feature_enabled_for_user() treated every
 * test_accounts row as a tester, so the reviewer was shown every testers-only
 * switch (quotes, declutter_shipping, refund_requests, suggest_category).
 * store_review_accounts rows get ONLY switches open to everyone. Every switch
 * read (useFeature, require_feature, requireFeature) goes through
 * feature_enabled_for_user, so its newest definition must exclude them inside
 * the testers branch, before any of the three tester grounds.
 * PGlite proof: ~/.lh-pglite/release-store-reviewer.mjs (3x, red without the exclusion).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

// @mutate supabase/migrations/20261101154236_store_reviewer_sees_member_switches.sql |                NOT EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = p_user_id) |                true
// @mutate supabase/migrations/20261101154236_store_reviewer_sees_member_switches.sql |  WHERE lower(u.email) = 'apple-reviewer@louisianahelpr.com' |  WHERE lower(u.email) = 'nobody@louisianahelpr.com'

const DIR = join(__dirname, "..", "..", "supabase", "migrations");
const defs = effectiveDefs(DIR);

describe("store review accounts get only switches open to everyone", () => {
  it("reads the newest feature_enabled_for_user and the switch readers that call it", () => {
    expect(defs.size).toBeGreaterThan(500);
    for (const fn of ["feature_enabled_for", "require_feature", "feature_switches_for_me"]) {
      expect(defs.get(fn)?.stmt ?? "").toMatch(/feature_enabled_for(_user)?\(/);
    }
  });

  it("the testers branch refuses a store_review_accounts member before any tester ground", () => {
    const body = blankSqlComments(defs.get("feature_enabled_for_user")?.stmt ?? "");
    const testers = body.slice(body.indexOf("WHEN 'testers'"));
    expect(testers).toMatch(/^WHEN 'testers' THEN\s+NOT EXISTS \(SELECT 1 FROM public\.store_review_accounts r WHERE r\.user_id = p_user_id\)\s+AND \(/);
    expect(testers.indexOf("store_review_accounts")).toBeLessThan(testers.indexOf("test_accounts t"));
  });

  it("the App Review demo account is enrolled, and the table is service_role only", () => {
    const sql = blankSqlComments(readFileSync(join(DIR, "20261101154236_store_reviewer_sees_member_switches.sql"), "utf8"));
    expect(sql).toMatch(/INSERT INTO public\.store_review_accounts[\s\S]*WHERE lower\(u\.email\) = 'apple-reviewer@louisianahelpr\.com'/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.store_review_accounts FROM PUBLIC, anon, authenticated;/);
  });
});
