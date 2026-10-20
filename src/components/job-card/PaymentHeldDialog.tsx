import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogAcknowledgeAction,
} from "@/components/ui/dialog";
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
export type PaymentHeldWho = { name: string | null; dateNeeded: string | null };

/** The owner's sentence. One place, so both sides read the same words. */
export const PAYMENT_HELD_SENTENCE = "The payment is held by Louisiana Helpr until the job is done.";

const TITLE: Record<PaymentHeldSide, string> = {
  poster: "Offer sent",
  helpr: "You're booked",
};

export function PaymentHeldDialog({ side, who, onClose }: { side: PaymentHeldSide | null; who?: PaymentHeldWho | null; onClose: () => void }) {
  if (side === "poster") return <PosterWhatNext who={who ?? null} onClose={onClose} />;
  return (
    <Dialog open={!!side} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHero title={side ? TITLE[side] : ""} />
        <DialogBody>
          <p data-payment-held="">{PAYMENT_HELD_SENTENCE}</p>
        </DialogBody>
        <DialogFooter>
          <DialogAcknowledgeAction>Got it</DialogAcknowledgeAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Board 78, the poster's "what next" after sending the offer, on the shared WhatNextSheet.
 * True to how hiring works today: the offer still needs the Helpr's accept, so the title is
 * "Offer sent" (not "hired"), the address is not promised, and no amount is printed (the card
 * was charged when the job was posted; the owner's held sentence says so in words).
 */
function PosterWhatNext({ who, onClose }: { who: PaymentHeldWho | null; onClose: () => void }) {
  const name = who?.name?.trim().split(/\s+/)[0] || null;
  const them = name ?? "Your Helpr";
  return (
    <WhatNextSheet
      open
      onClose={onClose}
      title="Offer sent"
      lead={<span data-payment-held="">{PAYMENT_HELD_SENTENCE}</span>}
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
      primary={{ label: "Got it", onClick: onClose }}
    />
  );
}
