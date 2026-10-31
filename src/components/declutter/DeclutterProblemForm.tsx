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

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
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
  const reason = picked && reasons.some(([r]) => r === picked) ? picked : reasons[0][0];
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]); // D2-7: up to 3, uploaded on Send (once the server takes them)
  const send = useMutation({
    mutationFn: async () => reportProblem(orderId, reason, note.trim(), PROBLEM_FORM_PHOTOS_READY && photos.length ? await uploadProblemPhotos(orderId, photos) : []),
    onSuccess: () => {
      toast("Reported. Nobody is paid until Louisiana Helpr decides.");
      setOpen(false);
      setNote("");
      setPhotos([]);
      invalidate(qc, orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!open) return trigger ? <button type="button" className={btn} onClick={() => setOpen(true)}>Report a problem</button> : null;
  return (
    <div ref={formRef} className="space-y-2 rounded-xl border border-border p-3">
      {/* BUY-35: the shared pick-one list, as Jobs' dispute and Declutter's refund use. */}
      <p className="text-xs font-medium" aria-hidden="true">What went wrong?</p>
      <RadioCardList label="What went wrong?" value={reason} onChange={(r) => setReason(r as ProblemReason)}
        options={reasons.map(([r, words]) => ({ value: r, label: words }))} />
      <label htmlFor={`dcl-note-${orderId}`} className="block text-xs font-medium">Tell us what happened</label>
      <textarea id={`dcl-note-${orderId}`} className={input} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      {/* BUY-35: one letter isn't a report; the same floor as Jobs' dispute (and said, so Send isn't dark for no reason). */}
      {note.trim().length > 0 && note.trim().length < DISPUTE_DETAILS_MIN && (
        <p className="text-ds-12 text-muted-foreground" data-problem-note-short="">A few more words, please, so Louisiana Helpr can help.</p>
      )}
      {PROBLEM_FORM_PHOTOS_READY && <ProblemPhotoPicker files={photos} onChange={setPhotos} disabled={send.isPending} />}
      <div className="flex gap-2">
        <button type="button" className={primary} disabled={send.isPending || note.trim().length < DISPUTE_DETAILS_MIN} onClick={() => send.mutate()}>Send</button>
        <button type="button" className={btn} onClick={() => setOpen(false)}>Not now</button>
      </div>
    </div>
  );
}
