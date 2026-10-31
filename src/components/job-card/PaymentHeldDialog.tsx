import { WhatNextSheet } from "@/components/whatNext/WhatNextSheet";
import { formatJobDate } from "@/lib/dateUtils";

/**
 * Q997 (owner, 2026-10-07): a hired, funded job tells both sides that the
 * money is held. Not on the cards (owner: "as a POP-UP, not on the card"):
 * this pop-up opens once, right after the poster sends an offer and right
 * after the Helpr's accept completes.
 */
export type PaymentHeldSide = "poster" | "helpr";
/** Board 78: the Helpr the poster offered the job to, and the job's date. Either may be unknown. */
export type PaymentHeldWho = { name: string | null; dateNeeded: string | null; jobId?: string; cardHeld?: boolean };

/** The owner's sentence. One place, so both sides read the same words. */
export const PAYMENT_HELD_SENTENCE = "The payment is held by Louisiana Helpr until the job is done.";

export function PaymentHeldDialog({ side, who, onClose }: { side: PaymentHeldSide | null; who?: PaymentHeldWho | null; onClose: () => void }) {
  if (side === "poster") return <PosterWhatNext who={who ?? null} onClose={onClose} />;
  if (side === "helpr") return <HelprWhatNext who={who ?? null} onClose={onClose} />;
  return null;
}

/**
 * Board 78, the poster's "what next" after sending the offer, on the shared WhatNextSheet.
 * True to how hiring works today: the offer still needs the Helpr's accept, so the title is
 * "Offer sent" (not "hired"), the address is not promised, and no amount is printed. A job paid at
 * posting gets the owner's held sentence; a card only held or saved (payment_status 'held', Q2399) has
 * paid nothing yet, so it says when the charge comes (JOBS3-45).
 */
function PosterWhatNext({ who, onClose }: { who: PaymentHeldWho | null; onClose: () => void }) {
  const name = who?.name?.trim().split(/\s+/)[0] || null;
  const them = name ?? "Your Helpr";
  return (
    <WhatNextSheet
      open
      onClose={onClose}
      title="Offer sent"
      lead={<span data-payment-held="">{who?.cardHeld ? `Your card is charged when ${name ?? "your Helpr"} accepts. Then Louisiana Helpr holds the payment until the job is done.` : PAYMENT_HELD_SENTENCE}</span>}
      steps={[
        { key: "sent", label: "You sent the offer", detail: "Today", state: "done" },
        { key: "accept", label: `${them} accepts`, detail: name ? `We'll let you know when ${name} answers` : "We'll let you know when you get an answer", state: "now" },
        {
          key: "day",
          label: who?.dateNeeded ? formatJobDate(who.dateNeeded) : "The job day",
          detail: name ? `You'll see when ${name} is on the way and arrives` : "You'll see when your Helpr is on the way and arrives",
          state: "later",
        },
        { key: "done", label: "You confirm it's done", detail: name ? `Then ${name} is paid` : "Then your Helpr is paid", state: "later" },
      ]}
      primary={{ label: "Got it", acknowledge: true }}
    />
  );
}

/**
 * Board 60, the Helpr's "You're hired" after accepting, on the shared WhatNextSheet. The
 * owner's held sentence stays (Q997). The steps are the tracker's real order: the Helpr's own
 * day-before confirm (it opens the day before; On my way needs it, Q1570), then On my way,
 * then photos and Done. No take-home here (the Working card and job page show it from the
 * real fee functions) and no address line (the card shows it once the server hands it over).
 */
function HelprWhatNext({ who, onClose }: { who: PaymentHeldWho | null; onClose: () => void }) {
  const name = who?.name?.trim().split(/\s+/)[0] || null;
  return (
    <WhatNextSheet
      open
      onClose={onClose}
      title="You're hired"
      lead={<>{name ? `${name} picked you. ` : null}<span data-payment-held="">{PAYMENT_HELD_SENTENCE}</span></>}
      steps={[
        { key: "accepted", label: "You accepted", detail: "Today", state: "done" },
        {
          key: "confirm",
          label: who?.dateNeeded ? `Confirm the day before ${formatJobDate(who.dateNeeded)}` : "Confirm the day before",
          detail: "It opens on the job card the day before",
          state: "now",
        },
        { key: "otw", label: "Tap \"I'm on my way\" when you leave", detail: name ? `${name} sees you're coming` : "The person who posted it sees you're coming", state: "later" },
        { key: "done", label: "Add your photos, then mark it done", state: "later" },
      ]}
      primary={{ label: "Got it", acknowledge: true }}
    />
  );
}
