/**
 * Boards 159 + 160: the handover moments as sheets, never a browser confirm().
 *  - PutItOutSheet (159, seller, porch): the photo is checked before it is
 *    sent; "Send photo · it's out" is the handover.
 *  - GotItSheet (159, buyer): what tapping "I got it" does (final, the seller
 *    is paid), the porch photo when there is one, and "Something's not
 *    right" first.
 *  - PickedUpSheet (seller, door pickup): what "Picked up" does.
 *  - NoShowSheet (160): what reporting a no-show really does, from
 *    declutter_report_no_show (owner 10-30): the buyer reporting the seller gives
 *    the seller 24 hours to answer, then a refund and a strike; the seller reporting
 *    the buyer gives the buyer one new booking inside the 7-day pickup
 *    deadline, and a second miss cancels the sale with the item price
 *    refunded (not the buyer's fee) and a strike. The seller does not choose.
 * Board 159's "Where exactly?" note (Q2266, migration 20261021023158): optional, sent with the photo, shown
 * to the buyer under it (the buyer reads it only on a paid order). Names, never pronouns.
 */
import { useEffect, useMemo, useState } from "react";
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
import { safeBlobUrl } from "@/lib/safeBlobUrl";
import { focusSheetItself } from "./focusSheetItself";

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
  onSend: (file: File, note: string) => void;
  onRetake: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  // The preview may only ever be the blob: URL made for the File just picked (safeBlobUrl says why, unit-tested).
  const preview = safeBlobUrl(url);
  return (
    <Sheet open={!!file} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-put-it-out="">
        <SheetHero title="Put it out" />
        <p className="text-ds-14">Take one photo of it where {who} will find it. That photo is the handover.</p>
        {/* Only a local blob: preview is drawn. safeBlobUrl holds the reasoning; the inline startsWith stays on the
            <img> because that is the barrier CodeQL js/xss-through-dom recognises (the PhotoProof pattern). */}
        {preview && preview.startsWith("blob:") && (
          <div className="mt-3 aspect-[4/3] w-full overflow-hidden rounded-2xl bg-photo-empty">
            <img src={preview} alt="Your porch photo" className="h-full w-full object-cover" />
          </div>
        )}
        <label htmlFor="porch-note" className="mt-3 block text-ds-15 font-semibold">
          Where exactly? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="porch-note"
          className="mt-1 h-12 w-full min-w-0 rounded-2xl border border-input glass-field px-4 text-ds-15"
          maxLength={200}
          value={note}
          placeholder="Left side of the porch, by the swing"
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="mt-2 text-ds-13 text-muted-foreground">{who === "the buyer" ? "The buyer" : who} sees this photo and your note, and is told it's out.</p>
        <SheetFooter>
          <SheetSecondaryAction onClick={onRetake} disabled={pending}>Retake</SheetSecondaryAction>
          <SheetPrimaryAction onClick={() => file && onSend(file, note.trim())} disabled={pending || !file}>
            {pending ? "Sending…" : "Send photo · it's out"}
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * BUY-5 (buying audit 10-30 #5): the buyer's porch pickup photo uploaded the moment it was chosen and finished the
 * sale, with no preview, retake or confirm (the seller's porch photo and "I got it" both ask). It now shows here first.
 */
export function PickedUpPhotoSheet({ file, who, free, pending, onSend, onRetake, onClose }: {
  /** The photo just taken; null closes the sheet. */
  file: File | null;
  /** The seller's first name, or "the seller". */
  who: string;
  free: boolean;
  pending: boolean;
  onSend: (file: File) => void;
  onRetake: () => void;
  onClose: () => void;
}) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const shown = safeBlobUrl(url);
  return (
    <Sheet open={!!file} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-picked-up-photo="">
        <SheetHero title="Picked up?" />
        {shown && shown.startsWith("blob:") && (
          <div className="mt-3 aspect-[4/3] w-full overflow-hidden rounded-2xl bg-photo-empty">
            <img src={shown} alt="Your pickup photo" className="h-full w-full object-cover" />
          </div>
        )}
        <Note>{`This photo tells ${who} you have it${free ? "." : ". They're paid 24 hours later, unless you report a problem."}`}</Note>
        <SheetFooter>
          <SheetSecondaryAction onClick={onRetake} disabled={pending}>Retake</SheetSecondaryAction>
          <SheetPrimaryAction onClick={() => file && onSend(file)} disabled={pending || !file}>
            {pending ? "Sending…" : "Send photo · I have it"}
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
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-photo-empty">
        {url.data && <img src={url.data} alt="Where the item was left" className="h-full w-full object-cover" />}
      </div>
      <figcaption className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">
        The porch photo from {time(h.data.set_out_at)}{h.data.set_out_note ? ` · "${h.data.set_out_note}"` : ""}
      </figcaption>
    </figure>
  );
}

/**
 * BUY-17 (buying audit 10-30 #17): on the pickup day "I got it" opens before the seller's porch photo (A1-C2 keeps the
 * day), so a slip would finish the sale on an item nobody put out. Before the photo, the sheet says so first.
 */
function PorchNoPhotoYet({ orderId, who }: { orderId: string; who: string }) {
  const h = useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId) });
  if (!h.data || h.data.set_out_at) return null;
  const Who = who === "the seller" ? "The seller" : who;
  return (
    <p role="note" className="mt-3 text-ds-14 text-foreground" data-got-it-no-porch-photo="">
      {Who} hasn't posted the porch photo yet. Tap I got it only if the item is in your hands.
    </p>
  );
}

export function GotItSheet({
  open,
  onOpenChange,
  orderId,
  porch,
  free = false,
  who,
  pending,
  onConfirm,
  onProblem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  porch: boolean;
  /** #6: a free claim: no refund window, nobody is paid. */
  free?: boolean;
  /** The seller's first name, or "the seller". */
  who: string;
  pending: boolean;
  onConfirm: () => void;
  onProblem: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-got-it-sheet="">
        <SheetHero title="Do you have it?" />
        {porch && <PorchPhotoThumb orderId={orderId} />}
        {porch && <PorchNoPhotoYet orderId={orderId} who={who} />}
        <div className="mt-3">
          <Note>{free
            ? `Tap I got it once you have it. If something is wrong, tap Something's not right first.`
            : <>After you tap I got it, you still have 24 hours to ask {who} for a refund if something is wrong. Then the sale is final and {who} is paid.</>}</Note>
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
  free = false,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The buyer's first name, or "the buyer". */
  who: string;
  /** #6: a free claim: no refund window, no payout. */
  free?: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} data-picked-up-sheet="">
        <SheetHero title={`Did ${who} take it?`} />
        <Note>{free ? `Tap Picked up once ${who} has it. That finishes the free pickup.` : "We ask the buyer to confirm. If they don't say anything, you're paid in about 48 hours."}</Note>
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
  free = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "buyer" | "seller";
  /** The other person's first name, or their role. */
  who: string;
  /** A free item: nothing was paid, so no money words (deep audit part 2, B2-2). */
  free?: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-no-show-sheet="">
        <SheetHero title={side === "seller" ? `${who === "the buyer" ? "The buyer" : who} didn't pick up?` : `${who === "the seller" ? "The seller" : who} didn't show?`} />
        {side === "seller" ? (
          <ul className="space-y-2 text-ds-14" data-no-show-rules="seller">
            <li>The first missed pickup: {who} can book one new time before the 7-day pickup deadline.</li>
            <li>{free ? "A second miss cancels the claim, and your item goes back on sale." : <>A second miss cancels the sale. {who === "the buyer" ? "The buyer" : who} gets the item price back, and your item goes back on sale.</>}</li>
            <li className="text-ds-13 text-muted-foreground">Missed pickups count against the buyer, not you.</li>
          </ul>
        ) : (
          <ul className="space-y-2 text-ds-14" data-no-show-rules="buyer">
            <li>We tell {who} now, and they have 24 hours to answer.</li>
            <li>{free ? "If they don't, your claim is cancelled. Nothing was charged." : "If they don't, the sale is cancelled and you get everything back."}</li>
            <li>If they say they were there, Louisiana Helpr looks at both sides{free ? "." : ", and your money stays held until then."}</li>
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
