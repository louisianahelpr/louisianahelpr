/**
 * Q2399: every member-facing sentence about a card hold, in one place, shared
 * by the edge functions (_shared/cardHold.ts, the webhook) and the app
 * (PaymentSuccess, the posted-job card). Pure: no Deno, no network.
 * Names no fee (owner 2026-10-25: members see no fee but the one-time $2
 * setup fee); every amount is the whole hold.
 */
export function holdDollars(cents: number): string {
  const n = Math.max(0, Math.round(Number(cents) || 0)) / 100;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Every member-facing sentence about a hold, in one place (no fee named: owner 2026-10-25). */
export const CARD_HOLD_COPY = {
  heldTitle: "Your card is on hold",
  held: (amountCents: number) => `Your card is on hold for ${holdDollars(amountCents)}. You're only charged when you hire someone.`,
  scheduledTitle: "Your card is saved",
  scheduled: (amountCents: number) =>
    `Your card is saved. We'll hold ${holdDollars(amountCents)} about 4 days before the job, and you're only charged when you hire someone.`,
  releasedTitle: "Your card was not charged",
  released: (title: string) => `Nobody was hired for "${title}", so the hold on your card was released. Your card was not charged.`,
  failedTitle: "Your card hold didn't go through",
  failed: (title: string) => `We couldn't hold your card for "${title}", so nobody can be hired yet. Open the job to update your card.`,
  confirmTitle: "Confirm your card",
  confirm: (title: string) => `Confirm your card for "${title}" so you can hire. Open the job to confirm it.`,
  helprWaitingTitle: "Waiting on payment",
  helprWaiting: (title: string) =>
    `"${title}" is waiting on payment from the person who posted it. We've let them know, and we'll tell you when you can accept.`,
  helprReadyTitle: "You can accept now",
  helprReady: (title: string) => `The payment for "${title}" is ready. You can accept the job now.`,
};

