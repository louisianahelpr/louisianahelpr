/**
 * Every JOB Checkout Session names its payment methods and presents dollars
 * only (owner 2026-10-18).
 *
 * Left unset, Checkout offers the account's default payment-method
 * configuration, measured live 2026-10-17 (GET /v1/checkout/sessions, recent
 * sessions): card, Afterpay, Klarna, Link, ACH, Affirm, Cash App, Amazon Pay,
 * with adaptive_pricing.enabled = true. Klarna/Afterpay/Affirm cost about 6% +
 * 30c, more than the 5% + 70c fee covers; Adaptive Pricing adds a 2-4%
 * conversion to what the poster pays. So every create-payment Checkout Session
 * (escrow, gift shortfall, tip, recurring visit):
 *   - sets `payment_method_types`, never offering Affirm, and the escrow and
 *     gift-shortfall sessions take it from the shared allowlist
 *     (JOB_CHECKOUT_PAYMENT_METHOD_TYPES: card, Link, ACH). Pay in 4 (Klarna
 *     + Afterpay) was removed with the poster-fee model (owner 2026-10-23);
 *   - sets `adaptive_pricing: { enabled: false }`.
 * The inventory is read from the source, exact: a new Checkout Session in
 * create-payment without both fails here.
 *
 * @mutate supabase/functions/create-payment/index.ts |           payment_method_types: [...JOB_CHECKOUT_PAYMENT_METHOD_TYPES],\n          adaptive_pricing: { enabled: false }, |           adaptive_pricing: { enabled: false },
 * @mutate supabase/functions/create-payment/index.ts |         payment_method_types: TIP_PAYMENT_METHOD_TYPES,\n        adaptive_pricing: { enabled: false }, |         payment_method_types: TIP_PAYMENT_METHOD_TYPES,
 * @mutate supabase/functions/_shared/jobCheckout.ts | export const JOB_CHECKOUT_PAYMENT_METHOD_TYPES: readonly JobCheckoutMethod[] = ["card", "link", "us_bank_account"]; | export const JOB_CHECKOUT_PAYMENT_METHOD_TYPES: readonly string[] = ["card", "link", "us_bank_account", "klarna"];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import {
  JOB_CHECKOUT_PAYMENT_METHOD_TYPES,
} from "../../supabase/functions/_shared/jobCheckout";

const FILE = "supabase/functions/create-payment/index.ts";
const CREATE = "checkout.sessions.create(";

/** The argument text of every `checkout.sessions.create(` call, balanced on parens outside strings. */
function checkoutCalls(src: string): string[] {
  const out: string[] = [];
  for (let at = src.indexOf(CREATE); at !== -1; at = src.indexOf(CREATE, at + 1)) {
    let depth = 0;
    let quote: string | null = null;
    let i = at + CREATE.length - 1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) break;
    }
    out.push(src.slice(at, i + 1));
  }
  return out;
}

describe("job Checkout Sessions name their payment methods and present dollars only (owner 2026-10-18)", () => {
  const calls = checkoutCalls(blankComments(readFileSync(FILE, "utf8")));

  it("finds every create-payment Checkout Session (escrow, gift shortfall, tip, recurring visit)", () => {
    // FLOOR and exact: four sessions today; a new one must be added here on purpose.
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.length).toBe(4);
  });

  it("each sets payment_method_types and turns Adaptive Pricing off", () => {
    for (const c of calls) {
      const head = c.slice(0, 160);
      expect(c, head).toMatch(/\bpayment_method_types:/);
      expect(c, head).toMatch(/\badaptive_pricing:\s*\{\s*enabled:\s*false\s*\}/);
      expect(c, head).not.toMatch(/["']affirm["']/);
    }
  });

  it("the escrow and gift-shortfall sessions take the shared allowlist", () => {
    const shared = calls.filter((c) => /payment_method_types:\s*\[\.\.\.JOB_CHECKOUT_PAYMENT_METHOD_TYPES\]/.test(c));
    expect(shared.length).toBe(2);
  });

  it("the allowlist is card + Link + ACH: no Pay in 4, never Affirm", () => {
    expect([...JOB_CHECKOUT_PAYMENT_METHOD_TYPES]).toEqual(["card", "link", "us_bank_account"]);
  });
});
