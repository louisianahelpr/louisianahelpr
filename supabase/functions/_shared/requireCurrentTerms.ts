/**
 * An edge function refuses a money or commitment action from a member who has
 * not accepted the current Terms of Service (owner-approved, 2026-11-08).
 *
 * The database refuses the same thing at the table
 * (20261108154435_terms_accepted_before_commitments: tr_require_current_terms),
 * but it reads auth.uid(), and an edge function that verified its caller with
 * auth.getUser() and then writes as the SERVICE ROLE has no auth.uid(). So each
 * such function asks the database's own rule for the user it just verified:
 * public.terms_accepted_is_current(user_id), granted to service_role only.
 *
 * The 403 body follows the edge convention (see requireConfirmedEmail.ts):
 * `error` is the sentence shown, `code` the machine-readable reason. The app's
 * fetch wrapper (src/lib/termsGate.ts) reads `code: "terms_not_accepted"`,
 * opens the re-agree dialog and sends the request again once the member agrees.
 *
 * A failed check is NOT reported as "not accepted": that would open the dialog
 * for a member who already agreed. It answers 503 terms_check_failed instead,
 * so the action is refused (fail closed) with a try-again message.
 *
 * Called by: create-payment (escrow, capture_hold, tip, recurring_visit),
 * declutter-checkout, shop-checkout, instant-payout, cash-out-credits.
 * Guard: src/test/termsAcceptedBeforeCommitments.test.ts.
 */
import { caughtMessage } from "./caughtMessage.ts";

const TERMS_NOT_ACCEPTED = "terms_not_accepted";
const TERMS_NOT_ACCEPTED_MESSAGE = "Please agree to the updated Terms of Service to continue.";
const TERMS_CHECK_FAILED_MESSAGE = "We couldn't check your account just now. Please try again.";

export interface TermsCheckClient {
  rpc(
    fn: "terms_accepted_is_current",
    args: { p_user_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

/**
 * null when the verified caller has accepted the current Terms; otherwise a
 * Response to return (403 terms_not_accepted, or 503 when the check failed).
 * Pass the service-role client and the user auth.getUser() returned.
 */
export async function refuseStaleTerms(
  client: TermsCheckClient,
  user: { id: string } | null | undefined,
  headers: Record<string, string>,
): Promise<Response | null> {
  if (!user?.id) return json({ error: TERMS_NOT_ACCEPTED_MESSAGE, code: TERMS_NOT_ACCEPTED }, 403, headers);
  let data: unknown;
  try {
    const res = await client.rpc("terms_accepted_is_current", { p_user_id: user.id });
    if (res.error) {
      console.error(`[requireCurrentTerms] terms_accepted_is_current failed: ${res.error.message}`);
      return json({ error: TERMS_CHECK_FAILED_MESSAGE, code: "terms_check_failed" }, 503, headers);
    }
    data = res.data;
  } catch (err) {
    console.error(`[requireCurrentTerms] terms_accepted_is_current threw: ${caughtMessage(err)}`);
    return json({ error: TERMS_CHECK_FAILED_MESSAGE, code: "terms_check_failed" }, 503, headers);
  }
  if (data === true) return null;
  return json({ error: TERMS_NOT_ACCEPTED_MESSAGE, code: TERMS_NOT_ACCEPTED }, 403, headers);
}
