/**
 * The "Report a problem" form on a Declutter order card (buyer or seller). Moved out of DeclutterHandoverViews.tsx
 * unchanged (component size limit, lead 10-31).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { reportProblem, type ProblemReason } from "@/lib/declutter/handover";
import { invalidate } from "./paidOrders";
import { ProblemPhotoPicker, uploadProblemPhotos } from "./DeclutterProblemPhotos";
import { PROBLEM_FORM_PHOTOS_READY } from "@/lib/declutter/problemPhotos";
import { PROBLEM_REASONS, type ProblemStage } from "./problemReasons";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { DISPUTE_DETAILS_MIN } from "@/components/disputeReasons";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

/** `trigger={false}`: the caller has its own "Report a problem" button (seller delivery), so this one shows only the open form (#51). */
export function ProblemForm({ orderId, side, stage, open: openProp, onOpenChange, trigger = true }: { orderId: string; side: "buyer" | "seller"; stage: ProblemStage; open?: boolean; onOpenChange?: (open: boolean) => void; trigger?: boolean }) {
  const qc = useQueryClient();
  const [openState, setOpenState] = useState(false);
  // Controlled from the order card when "Something's not right" opens it (board 159).
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && openProp) formRef.current?.scrollIntoView?.({ block: "center" }); }, [open, openProp]);
  const reasons = PROBLEM_REASONS[side][stage];
  const [picked, setReason] = useState<ProblemReason | null>(null);
  // Q2627 (seller) and audit 11-10 F387 (buyer): nothing is preselected, so a rushed tap never sends the wrong reason.
  const reason: ProblemReason | null = picked && reasons.some(([r]) => r === picked) ? picked : null;
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]); // D2-7: up to 3, uploaded on Send (once the server takes them)
  const send = useMutation({
    mutationFn: async () => reportProblem(orderId, reason as ProblemReason, note.trim(), PROBLEM_FORM_PHOTOS_READY && photos.length ? await uploadProblemPhotos(orderId, photos) : []),
    onSuccess: () => {
      toast("Reported. Nobody is paid until Louisiana Helpr decides.");
      setOpen(false);
      setNote("");
      setPhotos([]);
      invalidate(qc, orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!open) return trigger ? <Button type="button" variant="outline" size="sm" className="text-sm font-semibold" onClick={() => setOpen(true)}>Report a problem</Button> : null;
  return (
    <div ref={formRef} className="space-y-2 rounded-xl border border-border p-3">
      {/* BUY-35: the shared pick-one list, as Jobs' dispute and Declutter's refund use. */}
      <p className="text-xs font-medium" aria-hidden="true">What went wrong?</p>
      <RadioCardList label="What went wrong?" value={reason ?? ""} onChange={(r) => setReason(r as ProblemReason)}
        options={reasons.map(([r, words]) => ({ value: r, label: words }))} />
      <label htmlFor={`dcl-note-${orderId}`} className="block text-xs font-medium">Tell us what happened</label>
      <Textarea id={`dcl-note-${orderId}`} className={input} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="What's wrong, and what would make it right?" />
      {/* BUY-35: one letter isn't a report; the same floor as Jobs' dispute (and said, so Send isn't dark for no reason). */}
      {note.trim().length > 0 && note.trim().length < DISPUTE_DETAILS_MIN && (
        <p className="text-ds-12 text-muted-foreground" data-problem-note-short="">{DISPUTE_DETAILS_MIN - note.trim().length} more characters, please, so Louisiana Helpr can help.</p>
      )}
      {!reason && <p className="text-ds-12 text-muted-foreground" data-problem-pick="">Pick what went wrong.</p>}
      {PROBLEM_FORM_PHOTOS_READY && <ProblemPhotoPicker files={photos} onChange={setPhotos} disabled={send.isPending} />}
      {/* Audit 11-10 F387: what Send does, in the toast's own words (onSuccess). */}
      <p className="text-ds-12 text-muted-foreground" data-problem-after="">Once you send it, nobody is paid until Louisiana Helpr looks at it and decides.</p>
      {/* F388: one main button; "Not now" is the quiet way out, not a second button the same size. */}
      <div className="flex flex-col items-start gap-1">
        <Button type="button" variant="primary" size="sm" className="w-full text-sm font-semibold sm:w-auto" disabled={send.isPending || !reason || note.trim().length < DISPUTE_DETAILS_MIN} onClick={() => send.mutate()}>Send</Button>
        <Button type="button" variant="link" size="sm" className="px-0 text-sm font-semibold" onClick={() => setOpen(false)}>Not now</Button>
      </div>
    </div>
  );
}
