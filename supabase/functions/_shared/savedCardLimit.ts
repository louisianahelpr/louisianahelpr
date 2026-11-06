/**
 * Q1816 (core-loop-canary #4151, 2026-11-05): Stripe refuses a Checkout Session for a customer that already has
 * the most payment methods Stripe allows attached: "Customer has maximum number of payment methods attached."
 * (StripeInvalidRequestError, HTTP 400, no code). create-payment answered that with a 500.
 *
 * Measured 2026-11-05 (prod function_edge_logs): all 22 create-payment 500s in 24 h came from ONE test account,
 * whose test-mode wallet the journeys' 4242 payments had filled; no real member. The app has no action that
 * removes a saved card, so a member who hit it could not fix it themselves.
 *
 * withSavedCardLimit runs the Checkout create. On that one Stripe error it retries ONCE with saving switched
 * off, and only when the caller was saving AND may drop the save (never a recurring series: its later visits
 * are charged to the card this Checkout saves, Q734, so a series without it would decline every visit). When
 * the retry is not allowed, or fails the same way, it throws TooManySavedCards, which create-payment answers
 * with a 409 and a plain sentence (contact support from Help). Any other error is rethrown untouched.
 */

/** Stripe's refusal for a customer at the payment-method limit, by its type, status and message (it has no code). */
export function isTooManySavedCardsError(err: unknown): boolean {
  const e = err as { type?: unknown; statusCode?: unknown; message?: unknown; raw?: { message?: unknown } } | null;
  const message = typeof e?.message === "string" ? e.message : typeof e?.raw?.message === "string" ? e.raw.message : "";
  if (!/maximum number of payment methods/i.test(message)) return false;
  return e?.type === "StripeInvalidRequestError" || e?.statusCode === 400;
}

export class TooManySavedCards extends Error {
  constructor(message = "the wallet is at Stripe's payment-method limit") {
    super(message);
    this.name = "TooManySavedCards";
  }
}

/** The member-facing sentence on the 409 (no Stripe words, nothing charged). */
export const TOO_MANY_SAVED_CARDS_COPY =
  "This account has too many saved cards for us to open the payment page. Nothing was charged. Contact us from Help & Support in your Profile and we'll clear them for you.";

/**
 * Run `create(save)`, first with `save` as asked. On Stripe's payment-method-limit refusal, retry once with
 * save = false when `save` was true and `mayDropSave`; otherwise (or if the retry is refused the same way)
 * throw TooManySavedCards. `create` must change its idempotency key when `save` is false (the params differ).
 */
export async function withSavedCardLimit<T>(
  save: boolean,
  mayDropSave: boolean,
  create: (save: boolean) => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await create(save);
  } catch (err) {
    if (!isTooManySavedCardsError(err)) throw err;
    if (!save || !mayDropSave) {
      console.warn(`[savedCardLimit] ${label}: the wallet is at Stripe's payment-method limit; nothing to drop (save=${save}, mayDropSave=${mayDropSave})`);
      throw new TooManySavedCards();
    }
    console.warn(`[savedCardLimit] ${label}: the wallet is at Stripe's payment-method limit; retrying once without saving the card`);
  }
  try {
    return await create(false);
  } catch (err) {
    if (isTooManySavedCardsError(err)) throw new TooManySavedCards();
    throw err;
  }
}

/** A copy of a Checkout's payment_intent_data without setup_future_usage (the save-off retry's params). */
export function withoutSave<T extends Record<string, unknown>>(paymentIntentData: T): Omit<T, "setup_future_usage"> {
  const copy: Record<string, unknown> = { ...paymentIntentData };
  delete copy.setup_future_usage;
  return copy as Omit<T, "setup_future_usage">;
}
