/**
 * What the Post a Job checkout says before a PayPal payment (PayPal Plan A,
 * phase 3). The server refuses exactly these cases in create-payment's PayPal
 * path (supabase/functions/create-payment/paypalEscrow.ts), so the screen says
 * so BEFORE the job is posted instead of creating a job nobody can pay for.
 *
 * The tax answer comes from the SAME function the charge uses
 * (supabase/functions/_shared/jobSalesTax.ts): the quote and the charge cannot
 * disagree.
 */
import { PAYPAL_TAXABLE_CATEGORY_MESSAGE, payPalJobSalesTax } from "../../supabase/functions/_shared/jobSalesTax";

export const PAYPAL_REPEATING_MESSAGE = "Repeating jobs can't be paid with PayPal yet. Post it as a one-time job for now.";
export const PAYPAL_GIFT_MESSAGE = "Gift cards can't be used with PayPal yet. Remove the gift card to pay with PayPal.";

/** The sentence that blocks this PayPal checkout, or null when it can go ahead. */
export function payPalCheckoutBlock(job: { category: string | null | undefined; isRecurring: boolean; hasGift: boolean }): string | null {
  if (!payPalJobSalesTax(job.category, 0).ok) return PAYPAL_TAXABLE_CATEGORY_MESSAGE;
  if (job.isRecurring) return PAYPAL_REPEATING_MESSAGE;
  if (job.hasGift) return PAYPAL_GIFT_MESSAGE;
  return null;
}
