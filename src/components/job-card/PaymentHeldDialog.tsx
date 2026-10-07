import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogPrimaryAction,
} from "@/components/ui/dialog";

/**
 * Q997 (owner, 2026-10-07): a hired, funded job tells both sides that the
 * money is held. Not on the cards (owner: "as a POP-UP, not on the card"):
 * this pop-up opens once, right after the poster sends an offer and right
 * after the Helpr's accept completes.
 */
export type PaymentHeldSide = "poster" | "helpr";

/** The owner's sentence. One place, so both sides read the same words. */
export const PAYMENT_HELD_SENTENCE = "The payment is held by Louisiana Helpr until the job is done.";

const TITLE: Record<PaymentHeldSide, string> = {
  poster: "Offer sent",
  helpr: "You're booked",
};

export function PaymentHeldDialog({ side, onClose }: { side: PaymentHeldSide | null; onClose: () => void }) {
  return (
    <Dialog open={!!side} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHero title={side ? TITLE[side] : ""} />
        <DialogBody>
          <p data-payment-held="">{PAYMENT_HELD_SENTENCE}</p>
        </DialogBody>
        <DialogFooter>
          <DialogPrimaryAction onClick={onClose}>Got it</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
