/**
 * CompletionChoiceSheet — two-path bottom sheet that appears when the
 * poster taps "Approve & release payment" on an in-progress job after
 * the helper has marked it complete.
 *
 * Path A: "All done — looks great!" → calls onConfirm(), which releases
 *          escrow via the existing complete-job flow.
 * Path B: "I need something fixed first" → expands inline revision form.
 *          On submit it writes a `job_revisions` row, updates
 *          `jobs.revision_note / revision_requested_at / status`, and
 *          notifies the helper via the notifications table.
 *
 * PGRST202 (table not found) is caught on the job_revisions insert —
 * if the migration hasn't been pushed to production yet, the action
 * falls back gracefully to the legacy `revision_note` + status update
 * path that already exists on the jobs row.
 */
import { useState } from "react";
import { CheckCircle2, ChevronLeft, RotateCcw, X, Upload, AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetPrimaryAction,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";
import { toast } from "sonner";
import { hapticSuccess, hapticError, hapticMedium } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { PhotoProofGroup } from "@/components/PhotoProof";

interface CompletionChoiceSheetProps {
  open: boolean;
  jobId: string;
  jobTitle: string;
  helperId: string | null;
  helperName: string;
  userId: string;
  /** The helper's uploaded proof photos. Shown read-only on the choice
   *  screen: this sheet IS the release-the-money decision, and it used to ask
   *  for it with the evidence nowhere on screen — the card's PhotoProofGroup
   *  only rendered once status was already `completed`, i.e. after approval. */
  proofBeforeUrls?: string[];
  proofAfterUrls?: string[];
  onClose: () => void;
  /** Called when the poster approves (path A) — parent runs the full
   *  complete-job flow (status transition + CompletionPrompts). */
  onConfirm: () => void;
  /** Called after a revision is submitted (path B) — parent refetches. */
  onRevisionSubmitted: () => void;
}

export function CompletionChoiceSheet({
  open,
  jobId,
  helperName,
  helperId,
  userId,
  proofBeforeUrls = [],
  proofAfterUrls = [],
  onClose,
  onConfirm,
  onRevisionSubmitted,
}: CompletionChoiceSheetProps) {
  const [mode, setMode] = useState<"choice" | "revision">("choice");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setMode("choice");
    setDescription("");
    setPhotos([]);
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleConfirm = () => {
    hapticMedium();
    handleClose();
    onConfirm();
  };

  const handleRevisionSubmit = async () => {
    if (!description.trim()) {
      hapticError();
      toast.error("Describe what needs fixing so the Helpr knows where to start.");
      return;
    }
    hapticMedium();
    setSubmitting(true);
    try {
      // Upload photos
      const photoUrls: string[] = [];
      let uploadFailed = false;
      for (const file of photos.slice(0, 3)) {
        const ext = file.name.split(".").pop();
        // `<jobId>/revisions/…`, NOT `revisions/<jobId>/…`. The proof-photos
        // policies key on storage.foldername(name)[1], so the FIRST segment
        // must be either the caller's uid or a job they are party to. With
        // "revisions" in that slot it matched neither, so every revision photo
        // was rejected by RLS — and the bare `continue` below swallowed it, so
        // a revision request was filed with zero evidence and the helper had
        // nothing to work from.
        //
        // Fourth instance of this exact bug: DisputeDialog documented fixing
        // it, ReviewForm and PhotoProof were fixed on 2026-08-31, and this one
        // survived because nothing in the repo checks upload paths against the
        // policy that governs them.
        const path = `${jobId}/revisions/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("proof-photos").upload(path, file);
        if (upErr) {
          uploadFailed = true;
          report(upErr, { tags: { source: "CompletionChoiceSheet.uploadPhoto" } });
          continue;
        }
        const { data: urlData, error: signedUrlError } = await supabase.storage
          .from("proof-photos")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        if (signedUrlError) {
          report(signedUrlError, { tags: { source: "CompletionChoiceSheet.createSignedUrl" } });
          continue;
        }
        if (urlData?.signedUrl) photoUrls.push(urlData.signedUrl);
      }

      // Tell the user if their evidence didn't attach. The revision request
      // still goes through — it is better than losing their written
      // description — but silently filing it with no photos left the helper
      // with nothing to act on and the poster believing they had sent proof.
      if (uploadFailed) {
        toast.error(
          photoUrls.length > 0
            ? "Some photos couldn't be attached — your revision request was still sent."
            : "Your photos couldn't be attached — your revision request was still sent.",
        );
      }

      // Try the formal job_revisions table first (PGRST202 fallback below)
      const { error: revErr } = await supabase.from("job_revisions").insert({
        job_id: jobId,
        requested_by: userId,
        description: description.trim(),
        photos: photoUrls,
        status: "pending",
      });

      if (revErr && revErr.code !== "PGRST202") {
        throw revErr;
      }
      // PGRST202 = table not yet deployed; silently fall through to the
      // legacy jobs update below so the feature works pre-migration-push.

      // Legacy path — always run to keep jobs.status in sync for all read paths
      const now = new Date().toISOString();
      const { data: jobRows, error: jobErr } = await supabase.from("jobs").update({
        status: "revision_requested",
        revision_note: description.trim(),
        revision_requested_at: now,
        revision_count: (await (async () => {
          // Increment revision_count defensively
          const { data, error } = await supabase
            .from("jobs")
            .select("revision_count")
            .eq("id", jobId)
            .single();
          if (error) {
            // Surface the swallowed read failure, but keep the `?? 0`
            // fallback so a failed read doesn't silently reset the
            // counter to 1 on the update below.
            report(error, { tags: { source: "CompletionChoiceSheet.revisionCount" } });
          }
          return (data?.revision_count ?? 0) + 1;
        })()),
      }).eq("id", jobId).select("id");

      // .select("id") + row check: this is the write that holds the payment in
      // escrow while the fix happens. A zero-row update returns error === null,
      // and the helper would be notified about a revision the job never entered.
      unwrapMutation(
        { data: jobRows, error: jobErr },
        {
          action: "request this revision",
          rejectedMessage: "This revision couldn't be requested — the job may have already been completed or cancelled. Pull to refresh.",
          context: { jobId },
        },
      );

      // Notify helper
      if (helperId) {
        await createNotification({
          user_id: helperId,
          title: "Revision requested",
          message: `The poster wants a small fix on "${description.trim().slice(0, 80)}${description.length > 80 ? "…" : ""}". Tap to see details.`,
          type: "warning",
          // `?job=` — `revision_requested` has no chip; the live bucket is
          // "Needs you" for the helper and moves once they resubmit.
          link: `/my-jobs?job=${jobId}`,
        });
      }

      hapticSuccess();
      reset();
      onClose();
      onRevisionSubmitted();
    } catch (err: unknown) {
      hapticError();
      report(err instanceof Error ? err : new Error(String(err)), {
        tags: { source: "CompletionChoiceSheet.submitRevision" },
      });
      toast.error("Couldn't send the revision request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      {/* No bespoke padding or ground. `side="bottom"` is a centred modal at
          every width now, not a floor-anchored sheet, so the safe-area bottom
          inset each sheet had written differently is dead weight — and
          `.glass-modal` is THE popup surface. Shared `p-4 sm:p-5`, same ramp
          DialogContent uses. */}
      <SheetContent side="bottom">
        {mode === "choice" ? (
          <>
            <SheetHero title="How Did It Go?" />

            {(proofBeforeUrls.length > 0 || proofAfterUrls.length > 0) && (
              <div className="space-y-1.5 mb-3">
                <p
                  className="font-serif italic leading-snug text-ds-12"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {helperName}'s proof photos — the work you're about to pay for.
                </p>
                <PhotoProofGroup
                  jobId={jobId}
                  beforeUrls={proofBeforeUrls}
                  afterUrls={proofAfterUrls}
                  canUpload={false}
                />
              </div>
            )}

            <div className="space-y-3">
              {/* Path A — release payment */}
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full text-left rounded-ds-md p-4 transition-all active:scale-[0.985]"
                style={{
                  background: "hsl(var(--bark) / 0.07)",
                  border: "1px solid hsl(var(--bark) / 0.22)",
                  boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.50)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "hsl(var(--bark) / 0.15)", color: "hsl(var(--bark))" }}
                  >
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <p
                      className="font-display italic font-bold leading-tight text-ds-16"
                      style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                    >
                      All Done — Looks Great!
                    </p>
                    <p
                      className="font-serif italic mt-0.5 text-ds-12"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Release Payment to {helperName}
                    </p>
                  </div>
                </div>
              </button>

              {/* Path B — request revision */}
              <button
                type="button"
                onClick={() => setMode("revision")}
                className="w-full text-left rounded-ds-md p-4 transition-all active:scale-[0.985]"
                style={{
                  background: "hsl(var(--amber-tint) / 0.07)",
                  border: "1px solid hsl(var(--amber-tint) / 0.22)",
                  boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.50)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "hsl(var(--amber-tint) / 0.15)", color: "hsl(var(--amber-ink))" }}
                  >
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div>
                    <p
                      className="font-display italic font-bold leading-tight text-ds-16"
                      style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                    >
                      I Need Something Fixed First
                    </p>
                    <p
                      className="font-serif italic mt-0.5 text-ds-12"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Request a Revision — Payment Stays Held
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Was a hand-copied title stack. Two problems it re-introduced:
                a rendered subtitle (removed app-wide by the 2026-07-25 "one
                main title" decision — copy a sighted user must read belongs in
                the BODY, which is where the "will be notified" line now sits),
                and a SECOND X glyph ~30px from the sheet's own close. Two
                adjacent Xs with different meanings, on the money-release path:
                one goes back a step, one abandons the flow. The back control is
                a left chevron now, which is what it always meant. */}
            <div className="flex items-start gap-2 mb-1">
              <button
                type="button"
                onClick={() => setMode("choice")}
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-full active:opacity-70 -ml-1.5"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                aria-label="Back to choices"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <SheetHero title="What Needs to Be Fixed?" />
              </div>
            </div>
            <p
              className="font-serif italic leading-relaxed text-ds-13 mb-4"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              {helperName} will be notified and can respond before the job closes.
            </p>

            <div className="space-y-3">
              <Textarea
                aria-label="Describe what needs to be redone"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe what needs to be redone or fixed…"
                rows={4}
                maxLength={1000}
                className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14 leading-relaxed"
                autoFocus
              />

              {/* Photo attachments */}
              <div className="space-y-1.5">
                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {photos.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1 text-ds-11 px-2 py-1 rounded-full"
                        style={{
                          background: "hsl(var(--bark) / 0.10)",
                          color: "hsl(var(--bark))",
                          border: "0.5px solid hsl(var(--bark) / 0.22)",
                        }}
                      >
                        <span className="truncate max-w-[120px] font-sans font-medium">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                          aria-label="Remove photo"
                          className="inline-flex items-center justify-center h-10 w-10 -my-2 -mr-2 active:opacity-70"
                          style={{ color: "hsl(var(--burnt-sienna))" }}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {photos.length < 3 && (
                  <label
                    className="inline-flex items-center gap-1.5 text-ds-12 font-sans font-semibold cursor-pointer active:opacity-70"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    <Upload className="w-3.5 h-3.5" strokeWidth={2.25} />
                    {photos.length === 0 ? "Add photos (optional, up to 3)" : "Add more"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        setPhotos((prev) => [...prev, ...files].slice(0, 3));
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* Warning about escrow hold */}
              <div
                className="rounded-ds-md px-3 py-2.5 flex items-start gap-2"
                style={{
                  background: "hsl(var(--amber-tint) / 0.07)",
                  border: "0.5px solid hsl(var(--amber-tint) / 0.22)",
                }}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--amber-ink))" }} />
                <p
                  className="font-serif italic leading-snug text-ds-12"
                  style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  Payment stays held until you mark it complete. If {helperName} doesn't fix it, you can open a dispute.
                </p>
              </div>

              {/* ONE way back, not three (owner: "has 3 back options"). This
                  step used to offer a header chevron labelled "Back to
                  choices", a ghost "Back" button here that fired the exact same
                  `setMode("choice")`, and the dialog's own ✕ — two of which did
                  the same thing and the third did something else entirely.
                  The chevron stays (it is what says "you have drilled in"), the
                  ✕ stays (it closes the sheet, which is a different intent),
                  and the duplicate goes — which also leaves the footer as a
                  single unambiguous primary action. */}
              {/* The SHARED footer and the SHARED glossy primary. This was a
                  hand-rolled `flex` row holding a flat `--amber-solid` fill
                  that explicitly set `backgroundImage: "none"` — a seventh
                  primary colour in the app, and a flat one, against the
                  standing "primary controls are glossy, never flat" rule.
                  Asking for a revision is reversible, so it is the ordinary
                  primary. */}
              <SheetFooter className="pt-1">
                <SheetPrimaryAction
                  onClick={handleRevisionSubmit}
                  disabled={submitting || !description.trim()}
                >
                  {submitting ? "Sending…" : "Send Revision Request"}
                </SheetPrimaryAction>
              </SheetFooter>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
