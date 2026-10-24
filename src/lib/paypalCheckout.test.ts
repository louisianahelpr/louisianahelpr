/**
 * PayPal phase 3: the checkout screen refuses, before the job is posted, exactly what
 * create-payment's PayPal path refuses, and its tax answer is the charge's own function.
 *
 * @mutate src/lib/paypalCheckout.ts |   if (!payPalJobSalesTax(job.category, 0).ok) return PAYPAL_TAXABLE_CATEGORY_MESSAGE; |
 * @mutate src/lib/paypalCheckout.ts |   if (job.isRecurring) return PAYPAL_REPEATING_MESSAGE; |
 * @mutate supabase/functions/_shared/jobSalesTax.ts |   if (!isLaborTaxable(category)) return { ok: true, taxCents: 0, taxableBaseCents: 0 }; |   return { ok: true, taxCents: 0, taxableBaseCents: 0 };
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PAYPAL_GIFT_MESSAGE, PAYPAL_REPEATING_MESSAGE, payPalCheckoutBlock } from "./paypalCheckout";
import { PAYPAL_TAXABLE_CATEGORY_MESSAGE, payPalJobSalesTax } from "../../supabase/functions/_shared/jobSalesTax";
import { TAXABLE_CATEGORIES } from "../../supabase/functions/_shared/salesTax";
import { blankComments } from "@/test/helpers/blankNonCode";

const base = { category: "cleaning", isRecurring: false, hasGift: false };

describe("PayPal checkout block (screen) = PayPal escrow refusals (server)", () => {
  it("every taxable category is refused, every other one is a known $0 tax (floor: 14 taxable)", () => {
    expect(TAXABLE_CATEGORIES.size).toBeGreaterThanOrEqual(14);
    for (const c of TAXABLE_CATEGORIES) {
      expect(payPalCheckoutBlock({ ...base, category: c })).toBe(PAYPAL_TAXABLE_CATEGORY_MESSAGE);
      expect(payPalJobSalesTax(c, 10000)).toEqual({ ok: false, reason: "tax_rate_unavailable" });
    }
    for (const c of ["cleaning", "moving", "yard_work", "pet_care", "other"]) {
      expect(payPalCheckoutBlock({ ...base, category: c })).toBeNull();
      expect(payPalJobSalesTax(c, 10000)).toEqual({ ok: true, taxCents: 0, taxableBaseCents: 0 });
    }
  });

  it("repeating jobs and gift cards are refused", () => {
    expect(payPalCheckoutBlock({ ...base, isRecurring: true })).toBe(PAYPAL_REPEATING_MESSAGE);
    expect(payPalCheckoutBlock({ ...base, hasGift: true })).toBe(PAYPAL_GIFT_MESSAGE);
  });

  it("the server refuses the same cases with the same tax function", () => {
    const server = blankComments(readFileSync(path.resolve(__dirname, "../../supabase/functions/create-payment/paypalEscrow.ts"), "utf8"));
    expect(server).toMatch(/const tax = payPalJobSalesTax\(job\.category, budgetCents\);\s*if \(!tax\.ok\) throw new PublicError\(PAYPAL_TAXABLE_CATEGORY_MESSAGE\);/);
    expect(server).toMatch(/if \(job\.recurrence_days != null\) throw new PublicError/);
    expect(server).toMatch(/if \(giftCardId\) throw new PublicError/);
  });
});
