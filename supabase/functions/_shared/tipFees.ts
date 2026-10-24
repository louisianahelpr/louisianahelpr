// tipFees — the ONE definition of what a tip costs the poster and what the
// Helpr receives, shared by every tip quote and every tip charge.
//
// Policy (owner, 2026-09-25: "The poster pays the fee so helpr gets 100%"):
// the Helpr receives exactly the tip amount. Stripe's card-processing cost on
// the tip charge is added ON TOP for the poster, never taken out of the tip.
//
// Mechanics: a tip is a destination charge to the Helpr's connected account.
// Stripe transfers `amount - application_fee_amount` to the destination and
// debits its own processing fee from the platform balance. So the charge is
// `tip + fee`, the application fee is `fee`, and the Helpr's transfer is
// exactly `tip`. The fee has to cover Stripe's cost on the WHOLE charge
// (tip + fee), which is a fixed point — `stripeProcessingCostCents(tip)` alone
// under-collects by 1-9 cents because Stripe prices the larger total.
//
// Callers: create-payment (action "tip"), auto-tip-charge, and the client tip
// dialogs (TipDialog, CompletionPrompts) and the Auto-tip settings example,
// which import this file directly so the number a poster is shown and the
// number Stripe charges come from one function.
// `src/test/tipFeesOneDefinition.test.ts` fails if any of them computes a tip
// fee on its own or pays the Helpr less than the tip.

import { STRIPE_FLAT_CENTS, STRIPE_PCT, stripeProcessingCostCents } from "./stripeFees.ts";
import { PAYPAL_RATES, TIP_PAYPAL_METHOD, paypalProcessingCostCents, type PayPalMethod } from "./payments/providerFees.ts";

/** Smallest tip, in cents ($3; owner 2026-09-24/25). create-payment, the tip
 *  dialogs and auto-tip-charge all read this; below it the card fee would be a
 *  third of the tip. */
export const TIP_MIN_CENTS = 300;
/** Largest tip create-payment accepts, in cents ($1,000; `tips.amount` CHECK is <= 1000). */
export const TIP_MAX_CENTS = 100_000;

/**
 * The only payment methods a tip Checkout Session offers (Q383, 2026-09-26).
 * The fee above recovers Stripe's CARD rate. Without an explicit list the
 * account's default configuration also offers Klarna, Affirm, Afterpay,
 * Cash App and US bank account (measured in test mode 2026-09-26); Klarna/
 * Affirm/Afterpay cost 5.99% + 30c, so the platform would pay the gap on
 * every such tip. Apple Pay and Google Pay are card wallets and stay offered
 * under "card"; Link is billed at card rates. auto-tip-charge already charges
 * only a saved card (paymentMethods.list type "card").
 */
export const TIP_PAYMENT_METHOD_TYPES: ("card" | "link")[] = ["card", "link"];

/**
 * The card-processing fee added on top of a tip of `tipCents`, in cents: the
 * smallest whole-cent `fee` with `fee >= stripeProcessingCostCents(tip + fee)`,
 * so the platform recovers Stripe's card-rate cost on the full charge and keeps
 * nothing beyond it. Returns 0 for a non-positive tip.
 */
function tipCardFeeCents(tipCents: number): number {
  return smallestCoveringFee(tipCents, STRIPE_PCT, STRIPE_FLAT_CENTS, stripeProcessingCostCents);
}

/**
 * The smallest whole-cent `fee` with `fee >= cost(tip + fee)`: the fee covers
 * the processor's cost on the WHOLE charge and keeps nothing beyond it.
 * `pct`/`flat` only seed the search; `cost` is the exact answer it settles on.
 */
function smallestCoveringFee(tipCents: number, pct: number, flatCents: number, cost: (amountCents: number) => number): number {
  if (!(tipCents > 0)) return 0;
  // Closed-form starting point from the real-valued equation
  // fee = (tip + fee) * pct + flat, then settle on the exact integer answer
  // against the round-based cost the processor's rate produces.
  let fee = Math.ceil((tipCents * pct + flatCents) / (1 - pct));
  while (fee > 0 && fee - 1 >= cost(tipCents + fee - 1)) fee--;
  while (fee < cost(tipCents + fee)) fee++;
  return fee;
}

export interface TipChargeBreakdown {
  /** The tip the poster chose, in cents. */
  tipCents: number;
  /** Card-processing fee the poster pays on top, in cents (= application_fee_amount). */
  feeCents: number;
  /** What the poster's card is charged, in cents (tip + fee). */
  chargeCents: number;
  /** What the Helpr's connected account receives, in cents. Always equals `tipCents`. */
  helperCents: number;
}

/** Every number a tip quote or tip charge needs, from the tip in cents. */
export function tipChargeBreakdown(tipCents: number): TipChargeBreakdown {
  const tip = tipCents > 0 ? Math.round(tipCents) : 0;
  const feeCents = tipCardFeeCents(tip);
  return { tipCents: tip, feeCents, chargeCents: tip + feeCents, helperCents: tip };
}

/**
 * A tip paid through PayPal (paypal-tip; behind the paypal_payments switch).
 * TODAY'S RULE, unchanged (owner 2026-09-25; lead 2026-10-23: "keep today's
 * rule ... using PayPal's published rate for the method used"): the Helpr
 * receives exactly the tip, and PayPal's processing cost on the whole charge is
 * added on top for the poster, at the rate of the method the tip order uses
 * (TIP_PAYPAL_METHOD, _shared/payments/providerFees.ts). The platform keeps
 * nothing beyond that cost. Same shape as tipChargeBreakdown, so every quote and
 * every charge reads one function.
 */
export function paypalTipChargeBreakdown(tipCents: number, method: PayPalMethod = TIP_PAYPAL_METHOD): TipChargeBreakdown {
  const tip = tipCents > 0 ? Math.round(tipCents) : 0;
  // `method`: how the tip is paid. A tip prompt is PayPal Checkout (the default); an auto-tip
  // charged to a saved card (phase 6, chargeSaved) is priced at that card method's rate.
  const rate = PAYPAL_RATES[method];
  const feeCents = smallestCoveringFee(tip, rate.pct, rate.flatCents, (a) => paypalProcessingCostCents(a, rate));
  return { tipCents: tip, feeCents, chargeCents: tip + feeCents, helperCents: tip } satisfies TipChargeBreakdown;
}
