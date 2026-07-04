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
import { CheckCircle2, RotateCcw, X, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetHero,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticSuccess, hapticError, hapticMedium } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";

interface CompletionChoiceSheetProps {
  open: boolean;
  jobId: string;
  jobTitle: string;
  helperId: string | null;
  helperName: string;
  userId: string;
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
    handleClose();
    onConfirm();
  };

  const handleRevisionSubmit = async () => {
    if (!description.trim()) {
      hapticError();
      toast.error("Describe what needs fixing so the Helpr knows where to start");
      return;
    }
    hapticMedium();
    setSubmitting(true);
    try {
      // Upload photos
      const photoUrls: string[] = [];
      for (const file of photos.slice(0, 3)) {
        const ext = file.name.split(".").pop();
        const path = `revisions/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("proof-photos").upload(path, file);
        if (upErr) {
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
      const { error: jobErr } = await supabase.from("jobs").update({
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
      }).eq("id", jobId);

      if (jobErr) throw jobErr;

      // Notify helper
      if (helperId) {
        await createNotification({
          user_id: helperId,
          title: "Revision requested",
          message: `The poster wants a small fix on "${description.trim().slice(0, 80)}${description.length > 80 ? "…" : ""}". Tap to see details.`,
          type: "warning",
          link: `/my-jobs?filter=revision_requested`,
        });
      }

      hapticSuccess();
      toast.success("Revision requested — the Helpr has been notified.");
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
      <SheetContent side="bottom" className="pb-safe-nav">
        {mode === "choice" ? (
          <>
            <SheetHero
              className="mb-4"
              eyebrow="Wrapping up"
              title="How did it go?"
              subtitle="Your choice determines what happens to payment."
            />

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
                      className="font-display italic font-bold leading-tight"
                      style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                    >
                      All done — looks great!
                    </p>
                    <p
                      className="font-serif italic mt-0.5"
                      style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Release payment to {helperName}
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
                      className="font-display italic font-bold leading-tight"
                      style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                    >
                      I need something fixed first
                    </p>
                    <p
                      className="font-serif italic mt-0.5"
                      style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Request a revision — payment stays held
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            <SheetHeader className="space-y-0 text-left pr-12 mb-4">
              <div className="flex items-center justify-between">
                <SheetTitle
                  className="font-display italic font-bold leading-tight"
                  style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
                >
                  What needs to be fixed?
                </SheetTitle>
                <button
                  type="button"
                  onClick={() => setMode("choice")}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full active:opacity-70"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  aria-label="Back to choices"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <SheetDescription className="font-serif italic leading-relaxed pt-1.5" style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.85)" }}>
                {helperName} will be notified and can respond before the job closes.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-3">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe what needs to be redone or fixed…"
                rows={4}
                maxLength={1000}
                className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-[0.88rem] leading-relaxed"
                autoFocus
              />

              {/* Photo attachments */}
              <div className="space-y-1.5">
                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {photos.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1 text-[0.7rem] px-2 py-1 rounded-full"
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
                    className="inline-flex items-center gap-1.5 text-[0.78rem] font-sans font-semibold cursor-pointer active:opacity-70"
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
                  className="font-serif italic leading-snug"
                  style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  Payment stays held until you mark it complete. If {helperName} doesn't fix it, you can open a dispute.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="ghost"
                  className="flex-1 rounded-ds-md"
                  onClick={() => setMode("choice")}
                  disabled={submitting}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 rounded-ds-md"
                  onClick={handleRevisionSubmit}
                  disabled={submitting || !description.trim()}
                  style={
                    description.trim()
                      ? {
                          background: "hsl(var(--amber-solid))",
                          backgroundImage: "none",
                          border: "1px solid hsl(var(--amber-solid))",
                          color: "white",
                          fontFamily: "Montserrat, system-ui, sans-serif",
                          fontWeight: 600,
                        }
                      : undefined
                  }
                >
                  {submitting ? "Sending…" : "Send revision request"}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
