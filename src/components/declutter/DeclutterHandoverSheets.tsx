/**
 * Boards 159 + 160: the handover moments as sheets, never a browser confirm().
 *  - PutItOutSheet (159, seller, porch): the photo is checked before it is
 *    sent; "Send photo · it's out" is the handover.
 *  - GotItSheet (159, buyer): what tapping "I got it" does (final, the seller
 *    is paid), the porch photo when there is one, and "Something's not
 *    right" first.
 *  - PickedUpSheet (seller, door pickup): what "Picked up" does.
 *  - NoShowSheet (160): what reporting a no-show really does, from
 *    declutter_report_no_show (read live 2026-10-21): the buyer reporting the
 *    seller cancels the sale with everything refunded; the seller reporting
 *    the buyer gives the buyer one new booking inside the 7-day pickup
 *    deadline, and a second miss cancels the sale with the item price
 *    refunded (not the buyer's fee) and a strike. The seller does not choose.
 * Truth calls: board 159's "Where exactly?" note is NOT built (the handover
 * row has no field for it: needs a migration). Names, never pronouns.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetPrimaryAction,
  SheetSecondaryAction,
} from "@/components/ui/sheet";
import { fetchMyHandover, handoverPhotoUrl } from "@/lib/declutter/handover";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Money and finality notes wear the money tint with ink text (lead, board 65). */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-sheet-note="">
      {children}
    </p>
  );
}

export function PutItOutSheet({
  file,
  who,
  pending,
  onSend,
  onRetake,
  onClose,
}: {
  /** The photo just taken; null closes the sheet. */
  file: File | null;
  /** The buyer's first name, or "the buyer". */
  who: string;
  pending: boolean;
  onSend: (file: File) => void;
  onRetake: () => void;
  onClose: () => void;
}) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <Sheet open={!!file} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90dvh] overflow-y-auto" data-put-it-out="">
        <SheetHero title="Put it out" />
        <p className="text-ds-14">Take one photo of it where {who} will find it. That photo is the handover.</p>
        {url && (
          <div className="mt-3 aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted">
            <img src={url} alt="Your porch photo" className="h-full w-full object-cover" />
          </div>
        )}
        <p className="mt-2 text-ds-13 text-muted-foreground">{who === "the buyer" ? "The buyer" : who} sees this photo and is told it's out.</p>
        <SheetFooter>
          <SheetSecondaryAction onClick={onRetake} disabled={pending}>Retake</SheetSecondaryAction>
          <SheetPrimaryAction onClick={() => file && onSend(file)} disabled={pending || !file}>
            {pending ? "Sending…" : "Send photo · it's out"}
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The seller's porch photo, read the same way PorchOutPhoto reads it (one cache). */
function PorchPhotoThumb({ orderId }: { orderId: string }) {
  const h = useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId) });
  const path = h.data?.set_out_photo_path ?? null;
  const url = useQuery({
    queryKey: ["declutter", "handover-photo", path],
    queryFn: () => handoverPhotoUrl(path!),
    enabled: !!path,
    staleTime: 5 * 60_000,
  });
  if (!path || !h.data?.set_out_at) return null;
  return (
    <figure className="mt-3 space-y-1.5" data-got-it-photo="">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted">
        {url.data && <img src={url.data} alt="Where the item was left" className="h-full w-full object-cover" />}
      </div>
      <figcaption className="text-ds-13 text-muted-foreground">The porch photo from {time(h.data.set_out_at)}</figcaption>
    </figure>
  );
}

export function GotItSheet({
  open,
  onOpenChange,
  orderId,
  porch,
  who,
  pending,
  onConfirm,
  onProblem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  porch: boolean;
  /** The seller's first name, or "the seller". */
  who: string;
  pending: boolean;
  onConfirm: () => void;
  onProblem: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90dvh] overflow-y-auto" data-got-it-sheet="">
        <SheetHero title="Do you have it?" />
        {porch && <PorchPhotoThumb orderId={orderId} />}
        <div className="mt-3">
          <Note>Once you tap I got it, the sale is final and {who} is paid. Something wrong? Tell us before you tap.</Note>
        </div>
        <SheetFooter>
          <SheetSecondaryAction onClick={onProblem} disabled={pending}>Something's not right</SheetSecondaryAction>
          <SheetPrimaryAction onClick={onConfirm} disabled={pending}>I got it</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function PickedUpSheet({
  open,
  onOpenChange,
  who,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The buyer's first name, or "the buyer". */
  who: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()} data-picked-up-sheet="">
        <SheetHero title={`Did ${who} take it?`} />
        <Note>Tapping Picked up makes the sale final and starts your payout.</Note>
        <SheetFooter>
          <SheetSecondaryAction onClick={() => onOpenChange(false)} disabled={pending}>Not yet</SheetSecondaryAction>
          <SheetPrimaryAction onClick={onConfirm} disabled={pending}>Picked up</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function NoShowSheet({
  open,
  onOpenChange,
  side,
  who,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "buyer" | "seller";
  /** The other person's first name, or their role. */
  who: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90dvh] overflow-y-auto" data-no-show-sheet="">
        <SheetHero title={side === "seller" ? `${who === "the buyer" ? "The buyer" : who} didn't pick up?` : `${who === "the seller" ? "The seller" : who} didn't show?`} />
        {side === "seller" ? (
          <ul className="space-y-2 text-ds-14" data-no-show-rules="seller">
            <li>The first missed pickup: {who} can book one new time before the 7-day pickup deadline.</li>
            <li>A second miss cancels the sale. {who === "the buyer" ? "The buyer" : who} gets the item price back (not the buyer's fee), and your item goes back on sale.</li>
            <li className="text-ds-13 text-muted-foreground">Missed pickups count against the buyer, not you.</li>
          </ul>
        ) : (
          <ul className="space-y-2 text-ds-14" data-no-show-rules="buyer">
            <li>The sale is cancelled and you get everything back, including the buyer's fee.</li>
            <li className="text-ds-13 text-muted-foreground">A no-show counts against the seller, not you.</li>
          </ul>
        )}
        <SheetFooter>
          <SheetSecondaryAction onClick={() => onOpenChange(false)} disabled={pending}>Not now</SheetSecondaryAction>
          <SheetPrimaryAction onClick={onConfirm} disabled={pending}>Report it</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
