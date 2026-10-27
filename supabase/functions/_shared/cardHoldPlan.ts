// cardHoldPlan — the PURE half of the card hold (Q2399): when a hold is
// placed, which Checkout options hold a card, and whether a saved card may be
// held or charged without the poster. No Deno, no network, no Stripe client, so
// the app's tests and the edge functions read the same numbers
// (_shared/cardHold.ts re-exports every name here).
import { jobLocalStartMs } from "./cancellationFee.ts";
import { isLaborTaxable } from "./salesTax.ts";
import { THREE_D_SECURE_MIN_CENTS } from "./threeDSecure.ts";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/**
 * A job starting within 6 days is held at posting: a card authorization made
 * with the poster present lasts 7 days on every brand (Stripe, "Place a hold
 * on a payment method", validity table), so the hold outlives the listing.
 */
const HOLD_AT_POST_WITHIN_MS = 6 * DAY_MS;
/**
 * A job further out saves the card and the hold is placed 4 days before the
 * start. The hold is then off-session, and Visa's off-session window is
 * 4 days 18 hours (same table), the shortest of the brands.
 */
export const PLACE_BEFORE_START_MS = 4 * DAY_MS;
/** An authorization this close to its capture_before is renewed (or the poster asked) by the sweep. */
export const RENEW_WITHIN_MS = 12 * HOUR_MS;
/**
 * Checkout takes payment_method_options[card|link].capture_method from this
 * API version (Stripe changelog 2025-09-30.clover, "capture method for
 * specific payment methods with the Checkout Sessions API"); the rest of the
 * code pins 2025-08-27.basil. Sent on the hold checkout's create call only.
 */
export const CARD_HOLD_CHECKOUT_API_VERSION = "2025-09-30.clover";

export type HoldPlan = { kind: "hold_now" } | { kind: "schedule"; placeAt: Date };

/** Hold at posting, or save the card and hold it 4 days before the job's start (America/Chicago). */
export function holdPlanFor(dateNeeded: string | null | undefined, startTime: string | null | undefined, nowMs: number = Date.now()): HoldPlan {
  const start = dateNeeded ? jobLocalStartMs(dateNeeded, startTime ?? null) : NaN;
  if (!Number.isFinite(start) || start - nowMs <= HOLD_AT_POST_WITHIN_MS) return { kind: "hold_now" };
  return { kind: "schedule", placeAt: new Date(start - PLACE_BEFORE_START_MS) };
}

/**
 * Checkout's payment_method_options for a hold: card and Link are held; ACH
 * (us_bank_account) carries no capture_method because a bank debit cannot be
 * held (Stripe), so a poster paying by bank is charged at posting, as today.
 * The card is saved off-session too (lh-money-escrow review #6a): a hold that
 * nears its expiry is renewed on it, and a series charges later visits to it
 * (charge-recurring-visits seriesCard). `threeDS` is threeDSecureOptions(total)
 * (Q202: from $300 the hosted page runs 3D Secure).
 */
export function holdCheckoutPaymentMethodOptions(
  threeDS: { card?: Record<string, unknown> } | undefined,
): { card: Record<string, unknown>; link: { capture_method: "manual"; setup_future_usage: "off_session" } } {
  return {
    card: { ...(threeDS?.card ?? {}), capture_method: "manual", setup_future_usage: "off_session" },
    link: { capture_method: "manual", setup_future_usage: "off_session" },
  };
}

/**
 * May the hold (or the charge at the hire) on a SAVED card go through without
 * the poster? Not from $300 (Q210(b): a large charge is on-session, with 3D
 * Secure), and not on a taxed category: its sales tax is computed only by
 * Checkout from the poster's address, and a later refund reads the tax off the
 * Checkout Session (refundAmount.checkoutChargeTaxCents), which an off-session
 * payment has none of. Either way the poster confirms on a Checkout page.
 */
export function offSessionAllowed(amountCents: number, category: string | null | undefined): { ok: true } | { ok: false; why: "large" | "taxed" } {
  if (!(amountCents < THREE_D_SECURE_MIN_CENTS)) return { ok: false, why: "large" };
  if (isLaborTaxable(category ?? null)) return { ok: false, why: "taxed" };
  return { ok: true };
}
