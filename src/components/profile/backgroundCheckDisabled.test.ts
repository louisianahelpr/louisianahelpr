import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

/**
 * The background-check purchase is switched off while the screening provider
 * has no accounts.
 *
 * The reason it needs a guard and not just a comment: `create-bgc-payment`
 * charges live money, and `verification-webhook` 401s without
 * CHECKR_WEBHOOK_SECRET / CERTIFICIAL_WEBHOOK_SECRET — so a helper can pay for
 * a check whose result can never be recorded, and sit at "in progress" forever
 * with no badge and no refund path.
 *
 * Both halves must stay off together. Turning only the card off leaves the
 * endpoint callable; turning only the endpoint off leaves a button that
 * charges nothing but fails.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("background-check purchase stays disabled", () => {
  it("hides the purchase card", () => {
    const src = read("./BackgroundCheckCard.tsx");
    expect(src).toMatch(/const BGC_PURCHASE_ENABLED = false/);
    expect(src).toMatch(/if \(!BGC_PURCHASE_ENABLED\) return null/);
  });

  it("still renders verified and pending, which are facts about the user", () => {
    // Switching the purchase off must not erase a badge someone already
    // earned, or hide a check already in flight.
    const src = read("./BackgroundCheckCard.tsx");
    const guardAt = src.indexOf("if (!BGC_PURCHASE_ENABLED) return null");
    expect(src.indexOf('status === "verified"')).toBeLessThan(guardAt);
    expect(src.indexOf('status === "pending"')).toBeLessThan(guardAt);
  });

  it("refuses at the edge function, which is the real enforcement point", () => {
    // An edge function is callable directly with any signed-in token, so
    // hiding a button stops nobody who has already seen the endpoint.
    const src = read("../../../supabase/functions/create-bgc-payment/index.ts");
    expect(src).toMatch(/const BGC_PURCHASE_ENABLED = false/);
    expect(src).toMatch(/status: 503/);
    // The refusal must come BEFORE any Stripe work.
    const guardAt = src.indexOf("if (!BGC_PURCHASE_ENABLED)");
    const stripeAt = src.indexOf("stripe.checkout.sessions.create");
    expect(guardAt).toBeGreaterThan(-1);
    if (stripeAt > -1) expect(guardAt).toBeLessThan(stripeAt);
  });

  it("leaves Stripe Identity alone", () => {
    // verification-webhook serves BOTH Checkr/Certificial and Stripe Identity.
    // IDV works and must keep working.
    const src = read("../../../supabase/functions/verification-webhook/index.ts");
    expect(src).toMatch(/STRIPE_IDV_WEBHOOK_SECRET/);
  });
});
