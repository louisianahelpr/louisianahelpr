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

/** Smallest tip, in cents ($3; owner 2026-09-24/25). create-payment, the tip
 *  dialogs and auto-tip-charge all read this; below it the card fee would be a
 *  third of the tip. */
export const TIP_MIN_CENTS = 300;
/** Largest tip create-payment accepts, in cents ($1,000; `tips.amount` CHECK is <= 1000). */
export const TIP_MAX_CENTS = 100_000;

/**
 * The card-processing fee added on top of a tip of `tipCents`, in cents: the
 * smallest whole-cent `fee` with `fee >= stripeProcessingCostCents(tip + fee)`,
 * so the platform recovers Stripe's card-rate cost on the full charge and keeps
 * nothing beyond it. Returns 0 for a non-positive tip.
 */
export function tipCardFeeCents(tipCents: number): number {
  if (!(tipCents > 0)) return 0;
  // Closed-form starting point from the real-valued equation
  // fee = (tip + fee) * pct + flat, then settle on the exact integer answer
  // against the round-based cost Stripe's rate produces.
  let fee = Math.ceil((tipCents * STRIPE_PCT + STRIPE_FLAT_CENTS) / (1 - STRIPE_PCT));
  while (fee > 0 && fee - 1 >= stripeProcessingCostCents(tipCents + fee - 1)) fee--;
  while (fee < stripeProcessingCostCents(tipCents + fee)) fee++;
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
