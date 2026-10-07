// Q1490 (owner decision 2026-10-07: the tax follows the fee). Since Q1472 the
// poster's service fee on a TAXABLE job is taxed with the labor. Refunds keep
// the service fee (non-refundable), so they keep the tax charged ON that fee
// too: the kept fee is a completed taxable sale, and refunding its tax would
// leave the platform paying Louisiana tax on revenue it kept, out of that
// revenue.
//
// The figure is read from the job's Checkout Session (the "Service fee" line's
// own amount_tax), never recomputed (lh-money-escrow review). A job on an
// exempt category, with no session, or paid before the fee was taxed has 0.
// An unreadable session answers null: the caller then keeps only the fee (the
// poster gets the tax back), which is the poster-favourable side of a read
// failure, and reports it.
import { isLaborTaxable } from "./salesTax.ts";
import { caughtMessage } from "./caughtMessage.ts";

export const SERVICE_FEE_LINE_NAME = "Service fee";

type LineItemLister = {
  checkout: {
    sessions: {
      listLineItems: (id: string, params?: { limit?: number }) => Promise<{ data?: Array<{ description?: string | null; amount_tax?: number | null }> } | undefined>;
    };
  };
};

/** Tax charged on the Service fee line of `sessionId`, in cents; 0 when none applies; null when it could not be read. */
export async function serviceFeeTaxCents(
  stripe: LineItemLister,
  sessionId: string | null | undefined,
  category: string | null | undefined,
): Promise<number | null> {
  if (!sessionId || !isLaborTaxable(category)) return 0;
  try {
    const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
    const line = (items?.data ?? []).find((l) => (l.description ?? "") === SERVICE_FEE_LINE_NAME);
    // No Service fee line on a taxable session: unknown, not "no tax" (a
    // description mismatch must not silently turn the policy off; review).
    if (!line) return null;
    return Math.max(0, Math.round(Number(line.amount_tax ?? 0)));
  } catch (e) {
    console.warn(`[serviceFeeTax] could not read the line items of ${sessionId}: ${caughtMessage(e)}`);
    return null;
  }
}
