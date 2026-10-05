/**
 * Q1200 — an unconfirmed-email session is refused a subscription BEFORE the
 * purchase sheet opens.
 *
 * verify-apple-iap never refuses a purchase Apple already charged (Q837
 * exempts it on purpose), so the gate is subscription_purchase_eligibility,
 * which src/lib/iap.ts calls before StoreKit and create-pro-checkout before
 * Stripe. This pins: the NEWEST definition reads session_email_unconfirmed()
 * and answers allowed=false before any tier logic; both callers still refuse
 * on allowed === false and show the reason. Behaviour:
 * src/test/pglite/iapEligibilityRequiresConfirmedEmail.pglite.mjs (2 FAILED on
 * the live body, ALL PASS applied 3x).
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20261005065813_iap_eligibility_requires_confirmed_email.sql |   IF public.session_email_unconfirmed() THEN |   IF false THEN
// @mutate src/lib/iap.ts |   if (verdict && verdict.allowed === false) { |   if (verdict && verdict.allowed === false && false) {
// @mutate supabase/functions/create-pro-checkout/index.ts |     if (verdict && verdict.allowed === false) { |     if (verdict && verdict.allowed === false && false) {
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const body = blankSqlComments(effectiveDefs(join(ROOT, "supabase/migrations")).get("subscription_purchase_eligibility")?.stmt ?? "").replace(/\s+/g, " ");

describe("Q1200: subscription eligibility refuses an unconfirmed-email session", () => {
  it("the newest definition reads session_email_unconfirmed() and refuses before the tier logic", () => {
    const gate = body.search(/IF public\.session_email_unconfirmed\(\) THEN RETURN jsonb_build_object\( 'allowed', false, 'code', 'email_unconfirmed', 'reason', '[^']{20,}'\); END IF;/);
    const tiers = body.indexOf("SELECT subscription_tier");
    expect(gate, "the unconfirmed-email refusal is missing").toBeGreaterThan(-1);
    expect(tiers).toBeGreaterThan(gate);
  });

  it("both callers refuse on allowed === false and show the reason", () => {
    for (const f of ["src/lib/iap.ts", "supabase/functions/create-pro-checkout/index.ts"]) {
      const src = blankComments(readFileSync(join(ROOT, f), "utf8"));
      expect(src, f).toMatch(/"subscription_purchase_eligibility"/);
      expect(src, f).toMatch(/if \(verdict && verdict\.allowed === false\) \{/);
      expect(src, f).toMatch(/verdict\.reason \?\?/);
    }
  });
});
