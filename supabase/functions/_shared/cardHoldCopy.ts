/**
 * Q2399: every member-facing sentence about a card hold, in one place, shared
 * by the edge functions (_shared/cardHold.ts, the webhook) and the app
 * (PaymentSuccess, the posted-job card). Pure: no Deno, no network.
 * Names no fee but the one-time $2 setup fee (owner 2026-10-25), and that one it
 * explains (owner 2026-10-30: once per account, ever); every amount is the whole hold.
 */
/**
 * Whole dollars when the hold is whole ("$40", audit 2026-10-28 F17: "$40.00" on a $40 job, where every job card
 * says "$40"); cents only when there are some ("$136.40"). Never rounded: the sum is the real hold.
 */
export function holdDollars(cents: number): string {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const fraction = c % 100 !== 0;
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: fraction ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/**
 * A hold that carries the setup fee says so, and that it is paid once: a new poster with two
 * holds sees $2 inside both, and the second hire is charged $2 less (cardHold.ts). Empty when
 * the hold carries no fee.
 */
function setupFeeNote(amountCents: number, feeCents: number): { including: string; once: string } {
  if (!(feeCents > 0)) return { including: "", once: "" };
  const fee = holdDollars(feeCents);
  return {
    including: `, including the one-time ${fee} setup fee`,
    once: `, and you pay the ${fee} once: if it's already paid by then, you're charged ${holdDollars(amountCents - feeCents)}`,
  };
}

/** Every member-facing sentence about a hold, in one place. */
export const CARD_HOLD_COPY = {
  heldTitle: "Your card is on hold",
  held: (amountCents: number, feeCents = 0) => {
    const note = setupFeeNote(amountCents, feeCents);
    return `Your card is on hold for ${holdDollars(amountCents)}${note.including}. You're only charged when you hire someone${note.once}.`;
  },
  scheduledTitle: "Your card is saved",
  scheduled: (amountCents: number, feeCents = 0) => {
    const note = setupFeeNote(amountCents, feeCents);
    return feeCents > 0
      ? `Your card is saved. We'll hold ${holdDollars(amountCents)} about 4 days before the job${note.including}. You're only charged when you hire someone${note.once}.`
      : `Your card is saved. We'll hold ${holdDollars(amountCents)} about 4 days before the job, and you're only charged when you hire someone.`;
  },
  releasedTitle: "Your card was not charged",
  released: (title: string) => `Nobody was hired for "${title}", so the hold on your card was released. Your card was not charged.`,
  failedTitle: "Your card hold didn't go through",
  failed: (title: string) => `We couldn't hold your card for "${title}", so nobody can be hired yet. Open the job to update your card.`,
  /** Stripe refused the capture at the hire: the hold is released, so nothing was charged. */
  captureRefusedTitle: "Your payment didn't go through",
  captureRefused: (title: string) =>
    `We couldn't charge your card for "${title}", so the hire didn't go through. Your card was not charged and the hold is released. Open the job to pay again.`,
  confirmTitle: "Confirm your card",
  confirm: (title: string) => `Confirm your card for "${title}" so you can hire. Open the job to confirm it.`,
  helprWaitingTitle: "Waiting on payment",
  helprWaiting: (title: string) =>
    `"${title}" is waiting on payment from the person who posted it. We've let them know, and we'll tell you when you can accept.`,
  helprReadyTitle: "You can accept now",
  helprReady: (title: string) => `The payment for "${title}" is ready. You can accept the job now.`,
};

