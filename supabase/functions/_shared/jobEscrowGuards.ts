/**
 * Escrow-checkout guards shared by create-payment's two funding paths: the
 * Stripe path (create-payment/index.ts) and the PayPal path
 * (create-payment/paypalEscrow.ts, PayPal Plan A phase 3). Moved here
 * unchanged from create-payment/index.ts so both paths run the same checks.
 */
import { PublicError } from "./publicError.ts";

/**
 * Q1862: where a cancelled escrow checkout returns. Post a Job is the default;
 * a quote checkout returns to its request page, /quotes/request/<uuid>. Any
 * other returnPath is refused (never used as a redirect). Returns the quote
 * request id, or null for the default; the caller spells each target as a
 * literal buildRedirectUrl path (src/test/deepLinkOneRouter.test.ts proves
 * every literal is a route App.tsx serves).
 */
const QUOTE_REQUEST_RETURN_PATH = /^\/quotes\/request\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function escrowCancelQuoteRequestId(returnPath: unknown): string | null {
  if (returnPath === undefined || returnPath === null) return null;
  const m = typeof returnPath === "string" ? QUOTE_REQUEST_RETURN_PATH.exec(returnPath) : null;
  if (m) return m[1];
  throw new PublicError("That page can't be used to come back from checkout.");
}

/**
 * Q1867: refuse to charge a job booked from an agreed quote at anything but
 * the accepted quote's price. Reads every quote request linked to the job and
 * its accepted quote; an unreadable table refuses the checkout.
 */
export async function refuseQuoteJobPriceMismatch(
  // deno-lint-ignore no-explicit-any
  db: any,
  jobId: string,
  budget: unknown,
): Promise<void> {
  const { data: links, error: linkErr } = await db
    .from("job_quote_requests").select("id").eq("job_id", jobId).limit(5);
  if (linkErr) {
    console.error(`[create-payment] quote request read failed for job ${jobId}; refusing escrow:`, linkErr);
    throw new PublicError("Could not check this job's agreed quote. Please try again in a moment.");
  }
  const ids = ((links ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return;
  const { data: accepted, error: acceptedErr } = await db
    .from("job_quotes").select("price_cents").in("request_id", ids).eq("status", "accepted");
  if (acceptedErr) {
    console.error(`[create-payment] accepted quote read failed for job ${jobId}; refusing escrow:`, acceptedErr);
    throw new PublicError("Could not check this job's agreed quote. Please try again in a moment.");
  }
  const budgetCents = Math.round(Number(budget) * 100);
  const mismatch = ((accepted ?? []) as Array<{ price_cents: unknown }>).some((q) => Number(q.price_cents) !== budgetCents);
  if (mismatch) {
    console.error(`[create-payment] job ${jobId} budget ${budgetCents} != accepted quote price; refusing escrow`);
    throw new PublicError("This job's price doesn't match the quote you agreed, so it can't be paid for. Contact support.");
  }
}
