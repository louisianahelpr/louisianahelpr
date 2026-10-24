/**
 * Edge-harness double for the PayPal ledger reads (PayPal Plan A, phase 5).
 *
 * The Stripe-era refund paths (create-payment, void-cancelled-payments, execute-dispute-split,
 * refund-request-sweep) ask the PayPal ledger first and step aside for a PayPal-paid job. Their
 * harness tests drive Stripe jobs, so this double answers "no PayPal payment" and the Stripe path
 * runs exactly as before. The PayPal side itself is proved against real SQL
 * (src/test/pglite/paypalRefundsAndFee.pglite.mjs) and the PayPal sandbox, and where each path
 * steps aside is pinned by src/test/stripePathsSkipPayPalJobs.test.ts.
 */
export async function readPayPalJobPayment(_db: unknown, _jobId: string): Promise<{ payment: null; error: null }> {
  return { payment: null, error: null };
}

export async function payPalFundedJobIds(_db: unknown, _jobIds: string[]): Promise<{ ids: Set<string>; error: null }> {
  return { ids: new Set(), error: null };
}

export async function payPalRefundDoorFor(..._args: unknown[]): Promise<Response | null> {
  return null;
}

export async function settleRefundAgreement(..._args: unknown[]): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: 500, body: { error: "the edge harness does not settle PayPal agreements" } };
}

export function payPalFromEnv(): never {
  throw new Error("the edge harness has no PayPal");
}
