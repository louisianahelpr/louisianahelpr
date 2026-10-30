/**
 * Q2084 (measured live 2026-10-17): the five non-job Checkout Sessions (gift
 * card, Pro, boost, background check, setup fee) set no payment_method_types,
 * so Stripe offered the account default list (card, Afterpay, Klarna, Link,
 * ACH, Affirm, Cash App, Amazon Pay) with Adaptive Pricing on. A buy-now-pay-
 * later payment costs about 6% + 30c, more than the card cost these prices
 * cover (owner: "we never eat a fee unless it's our fault").
 *
 * CLASS, widened from src/test/jobCheckoutsNameTheirPaymentMethods.test.ts
 * (create-payment only) to EVERY checkout.sessions.create in supabase/functions:
 *   - every file that opens a Checkout Session names payment_method_types at
 *     least once per session it opens, and none ever offers Affirm, Cash App
 *     or Amazon Pay;
 *   - the five older checkouts are card only (Apple Pay and Google Pay ride on
 *     card) with Adaptive Pricing off (Pro: on its one-time purchase only; a
 *     subscription session with it is not proven in Stripe TEST mode).
 * The file inventory is read from the source and exact both ways.
 *
 * @mutate supabase/functions/create-gift-card-checkout/index.ts |       payment_method_types: ["card"], |       payment_method_types: ["card", "klarna"],
 * @mutate supabase/functions/create-gift-card-checkout/index.ts |       adaptive_pricing: { enabled: false }, |
 * @mutate supabase/functions/create-bgc-payment/index.ts |       payment_method_types: ["card"], |
 * @mutate supabase/functions/create-boost-payment/index.ts |       payment_method_types: ["card"], |       payment_method_types: ["card", "affirm"],
 * @mutate supabase/functions/pay-onboarding-fee/index.ts |         payment_method_types: ["card"], |
 * @mutate supabase/functions/pay-onboarding-fee/index.ts |         adaptive_pricing: { enabled: false }, |
 * @mutate supabase/functions/create-pro-checkout/index.ts |       payment_method_types: ["card"], |
 * @mutate supabase/functions/create-pro-checkout/index.ts |     if (isOneTime) sessionParams.adaptive_pricing = { enabled: false }; |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = join(__dirname, "..", "..");
const CREATE = /\bcheckout\.sessions\.create\(/g;
const code = (f: string) => blankComments(readFileSync(join(REPO, f), "utf8"));

const edgeFiles = (readdirSync(join(REPO, "supabase/functions"), { recursive: true }) as string[])
  .map((f) => `supabase/functions/${String(f).split("\\").join("/")}`)
  .filter((f) => f.endsWith(".ts"))
  .sort();
const opening = edgeFiles.filter((f) => /\bcheckout\.sessions\.create\(/.test(code(f)));

/** Every file that opens a Checkout Session, and how many it opens. Exact: a new one is added on purpose. */
const SESSION_OPENERS: Record<string, number> = {
  "supabase/functions/create-bgc-payment/index.ts": 1,
  "supabase/functions/create-boost-payment/index.ts": 1,
  "supabase/functions/create-gift-card-checkout/index.ts": 1,
  "supabase/functions/create-payment/index.ts": 5,
  "supabase/functions/create-pro-checkout/index.ts": 1,
  "supabase/functions/declutter-card/index.ts": 1,
  "supabase/functions/declutter-checkout/index.ts": 3,
  "supabase/functions/pay-onboarding-fee/index.ts": 1,
  "supabase/functions/shop-checkout/index.ts": 1,
};

/** The five older checkouts (Q2084): card only, dollars only. */
const CARD_ONLY = [
  "supabase/functions/create-bgc-payment/index.ts",
  "supabase/functions/create-boost-payment/index.ts",
  "supabase/functions/create-gift-card-checkout/index.ts",
  "supabase/functions/create-pro-checkout/index.ts",
  "supabase/functions/pay-onboarding-fee/index.ts",
];

describe("Q2084: every Checkout Session names its payment methods", () => {
  it("finds every file that opens a Checkout Session, exactly", () => {
    expect(opening.length).toBeGreaterThan(5);
    const counts = Object.fromEntries(opening.map((f) => [f, (code(f).match(CREATE) ?? []).length]));
    expect(counts).toEqual(SESSION_OPENERS);
  });

  it("each names payment_method_types once per session it opens, and none offers Affirm, Cash App or Amazon Pay", () => {
    for (const f of opening) {
      const src = code(f);
      const sessions = (src.match(CREATE) ?? []).length;
      const named = (src.match(/\bpayment_method_types\s*[:=]/g) ?? []).length;
      expect(named, f).toBeGreaterThanOrEqual(sessions);
      expect(src, f).not.toMatch(/["'](affirm|cashapp|amazon_pay)["']/);
    }
  });

  it("the five older checkouts are card only with Adaptive Pricing off", () => {
    for (const f of CARD_ONLY) {
      const src = code(f);
      expect(src, f).toMatch(/\bpayment_method_types:\s*\["card"\],/);
      expect(src, f).not.toMatch(/\bpayment_method_types:\s*\["card",/);
      if (f.includes("create-pro-checkout")) {
        expect(src, f).toMatch(/if \(isOneTime\) sessionParams\.adaptive_pricing = \{ enabled: false \};/);
      } else {
        expect(src, f).toMatch(/\badaptive_pricing:\s*\{\s*enabled:\s*false\s*\}/);
      }
    }
  });
});
