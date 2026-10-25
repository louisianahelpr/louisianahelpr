/**
 * Payout setup only after a hire (owner decision 2026-10-25, item 9).
 *
 * Stripe rejected 45 of Helpr's 46 live connected accounts as rejected.fraud
 * (GET /v1/accounts, 2026-10-25); 30 of the 33 linked to a live profile
 * belonged to people nobody ever hired, most opened within an hour of sign-up.
 * So stripe-connect opens, finishes or resets a payout account only for a
 * member someone chose for a job that holds money (or who is owed money, or a
 * Declutter / Shops / Rentals seller): public.payout_setup_hire_allowed
 * (migration 20261025162003), asked for the VERIFIED caller with the service
 * client. It fails CLOSED: an RPC error, a missing function or any answer but
 * a literal true is "not hired", so no account is created on an answer the
 * server could not read.
 *
 * This applies to EVERY member (lead answer 2(a), 2026-10-25: the restriction
 * ships without a switch). The App Store review account is exempt in
 * stripe-connect (APP_REVIEW_ACCOUNT_IDS).
 *
 * The app hides every setup entry point first (usePayoutSetupPaused reads
 * payout_setup_hire_allowed_for_me); this refusal is what stops an old build
 * or a direct call. Guards: src/test/payoutSetupNeedsHire.test.ts (static) and
 * src/test/edge/stripeConnectNeedsHire.test.ts (the real function).
 */
import { caughtMessage } from "./caughtMessage.ts";

/** The machine code of the refusal (403). */
const PAYOUT_SETUP_NEEDS_HIRE_CODE = "payout_setup_needs_hire";

/**
 * The same words as the app notice (PAYOUT_SETUP_NEEDS_HIRE_COPY in
 * src/lib/payoutSetupPaused.ts; the guard keeps the two equal), so an old build
 * that toasts the `error` field still reads the notice.
 */
const PAYOUT_SETUP_NEEDS_HIRE_MESSAGE = "You'll set up payouts when you're hired for your first job.";

/** The one call this needs from a supabase-js client. */
export interface HireCheckClient {
  rpc(fn: "payout_setup_hire_allowed", args: { p_user_id: string }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** True only when the server says this member may set up payouts (fails closed). */
export async function payoutSetupHireAllowed(client: HireCheckClient, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await client.rpc("payout_setup_hire_allowed", { p_user_id: userId });
    if (error) {
      console.error(`[payoutSetupHire] payout_setup_hire_allowed failed for ${userId}: ${error.message}`);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error(`[payoutSetupHire] payout_setup_hire_allowed threw for ${userId}: ${caughtMessage(err)}`);
    return false;
  }
}

/** The 403 every setup action answers for a member nobody has hired, before any Stripe call. */
export function payoutSetupNeedsHireResponse(headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ error: PAYOUT_SETUP_NEEDS_HIRE_MESSAGE, code: PAYOUT_SETUP_NEEDS_HIRE_CODE, reason: PAYOUT_SETUP_NEEDS_HIRE_CODE }),
    { status: 403, headers: { ...headers, "Content-Type": "application/json" } },
  );
}
