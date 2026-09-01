/**
 * DisputeTimelineDialog — read-only timeline + follow-up evidence
 * uploader for jobs whose status is already 'disputed'.
 *
 * Mounts inside the existing disputed-state panels on PostedJobCard /
 * AppliedJobCard so either party can:
 *   - see when the dispute was filed, by whom, and the reason
 *   - browse the evidence both parties have uploaded so far
 *   - upload follow-up evidence (only while status='open')
 *   - read the admin's decision once status='decided'
 *
 * Reads the dedicated `public.disputes` row when available (the new
 * formal flow); falls back to the legacy `jobs.dispute_*` columns
 * when the row hasn't been written (e.g. dispute filed before the
 * migration shipped to production). Either way the UI is the same.
 */
import { useEffect, useState } from "react";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Upload, X, Clock, CheckCircle2, FileImage } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import { formatDistanceToNow } from "date-fns";

interface DisputeRow {
  id: string;
  job_id: string;
  opener_id: string;
  reason: string;
  evidence_urls: string[];
  status: "open" | "decided" | "withdrawn";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_text: string | null;
  payout_split: { poster?: number; helper?: number } | null;
  /** What the split ACTUALLY settled at, once execute-dispute-split ran. */
  execution_status: string | null;
  execution_helper_cents: number | null;
  execution_refund_cents: number | null;
}

interface DisputeTimelineDialogProps {
  jobId: string;
  jobTitle: string;
  userId: string;
  /** Legacy fallback when no `disputes` row exists yet. */
  legacy?: {
    reason: string | null;
    evidence_urls: string[];
    disputed_at: string | null;
    disputed_by: string | null;
    dispute_resolved_at?: string | null;
  };
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const DisputeTimelineDialog = ({
  jobId,
  jobTitle: _jobTitle,
  userId,
  legacy,
  open,
  onClose,
  onUpdated,
}: DisputeTimelineDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [dispute, setDispute] = useState<DisputeRow | null>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Load the formal disputes row when present. Falls back gracefully
  // when the table doesn't exist yet (PGRST205) or no row matches —
  // the legacy jobs.dispute_* fields drive the read-only view in that
  // case.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase.from as any)("disputes")
        .select("id, job_id, opener_id, reason, evidence_urls, status, created_at, decided_at, decided_by, decision_text, payout_split, execution_status, execution_helper_cents, execution_refund_cents")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error && error.code !== "PGRST116" && error.code !== "PGRST205" && error.code !== "42P01") {
        // PGRST116 = no row, PGRST205 = relation missing, 42P01 same.
        // Any other shape we want to know about.
        report(error, { tags: { source: "DisputeTimelineDialog.load" } });
      }

      setDispute((data as DisputeRow | null) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const valid = files.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`"${f.name}" exceeds 5 MB limit.`);
        return false;
      }
      return true;
    });
    setEvidenceFiles((prev) => [...prev, ...valid].slice(0, 5));
  };

  const removeFile = (i: number) => setEvidenceFiles((prev) => prev.filter((_, idx) => idx !== i));

  // Upload follow-up evidence. We append to the dispute's
  // evidence_urls via a direct UPDATE — RLS already restricts this to
  // (opener_id = auth.uid() AND status = 'open'), per the migration.
  // Falls back to updating the legacy jobs.dispute_evidence_urls
  // array when the disputes row hasn't been created yet.
  const handleSubmit = async () => {
    if (evidenceFiles.length === 0) return;
    hapticHeavy();
    setSubmitting(true);
    try {
      // Path must start with the uploader's uid — see DisputeDialog: the
      // proof-photos INSERT policy keys on `(storage.foldername(name))[1]`,
      // so a `disputes/…` prefix is rejected by RLS on every file.
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      const newUrls: string[] = [];
      let failedUploads = 0;
      for (const file of evidenceFiles) {
        const ext = file.name.split(".").pop();
        const path = `${uid}/disputes/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("proof-photos").upload(path, file);
        if (uploadError) {
          report(uploadError, { tags: { source: "DisputeTimelineDialog.upload" } });
          failedUploads += 1;
          continue;
        }
        const { data: urlData, error: signedUrlError } = await supabase.storage.from("proof-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
        if (signedUrlError) {
          report(signedUrlError, { tags: { source: "DisputeTimelineDialog.createSignedUrl" } });
          failedUploads += 1;
          continue;
        }
        if (urlData?.signedUrl) newUrls.push(urlData.signedUrl);
        else failedUploads += 1;
      }

      // Fail LOUD on a partial upload — the same rule DisputeDialog already
      // follows on the filing screen. This twin kept the old behaviour: it
      // only threw when EVERY file failed, so 2-of-3 landing reported success
      // and the photo that would have decided the dispute was never attached
      // and never mentioned. Evidence is not a "best effort" payload.
      if (failedUploads > 0) {
        throw new Error(
          `${failedUploads} of ${evidenceFiles.length} photo${evidenceFiles.length === 1 ? "" : "s"} didn't upload. Nothing was attached — try again, your evidence matters here.`,
        );
      }

      if (newUrls.length === 0) {
        throw new Error("No evidence files uploaded.");
      }

      if (dispute) {
        // Re-read the array immediately before merging. This UPDATE sends the
        // WHOLE array, so it is last-write-wins: merging onto the copy loaded
        // when the dialog opened would silently DELETE anything added since —
        // including, once both sides can file, the other party's evidence.
        const { data: fresh, error: freshErr } = await (supabase.from as any)("disputes")
          .select("evidence_urls")
          .eq("id", dispute.id)
          .maybeSingle();
        if (freshErr) {
          report(freshErr, { tags: { source: "DisputeTimelineDialog.reReadEvidence" } });
          throw new Error("Couldn't attach your evidence — try again?");
        }
        const existingUrls: string[] = (fresh?.evidence_urls as string[] | null) ?? dispute.evidence_urls ?? [];
        const merged = [...existingUrls, ...newUrls];
        // .select("id"): evidence that silently fails to attach is evidence
        // the admin deciding this dispute never sees, while the uploader was
        // told it landed.
        unwrapMutation(
          await (supabase.from as any)("disputes")
            .update({ evidence_urls: merged })
            .eq("id", dispute.id)
            .select("id"),
          {
            action: "attach this evidence to the dispute",
            rejectedMessage: "This evidence couldn't be attached — the dispute may have already been decided.",
            context: { disputeId: dispute.id },
          },
        );
        setDispute({ ...dispute, evidence_urls: merged });
      } else {
        // Legacy path — append onto jobs.dispute_evidence_urls.
        const existing = legacy?.evidence_urls || [];
        const merged = [...existing, ...newUrls];
        unwrapMutation(
          await supabase
            .from("jobs")
            .update({ dispute_evidence_urls: merged })
            .eq("id", jobId)
            .select("id"),
          {
            action: "attach this evidence to the dispute",
            rejectedMessage: "This evidence couldn't be attached — the dispute may have already been decided.",
            context: { jobId },
          },
        );
      }

      hapticSuccess();
      toast.success(
        `${newUrls.length} photo${newUrls.length === 1 ? "" : "s"} attached to the dispute.`,
      );
      setEvidenceFiles([]);
      onUpdated();
    } catch (err: unknown) {
      hapticError();
      toast.error(mutationErrorMessage(err, err instanceof Error ? err.message : "Couldn't upload your evidence — try again?"));
    } finally {
      setSubmitting(false);
    }
  };

  // Render-time helpers — keep the timeline rows DRY.
  const reason = dispute?.reason ?? legacy?.reason ?? null;
  const createdAt = dispute?.created_at ?? legacy?.disputed_at ?? null;
  const openerId = dispute?.opener_id ?? legacy?.disputed_by ?? null;
  const evidenceUrls = dispute?.evidence_urls?.length
    ? dispute.evidence_urls
    : (legacy?.evidence_urls ?? []);
  const decidedAt = dispute?.decided_at ?? legacy?.dispute_resolved_at ?? null;
  const decisionText = dispute?.decision_text ?? null;
  const payoutSplit = dispute?.payout_split ?? null;
  const isOpener = openerId === userId;
  // Who may actually attach evidence, per the ONLY UPDATE policy on
  // `disputes`: `USING (auth.uid() = opener_id AND status = 'open')`
  // (20260609140000). This used to test the status alone, so the accused
  // party was shown "Add follow-up evidence", let them pick files, uploaded
  // them to storage — and then the UPDATE matched zero rows and they were
  // told "the dispute may have already been decided", which is not what
  // happened. A control nobody can use is worse than no control: it reads as
  // a right to reply that is not there.
  //
  // The legacy path (no formal `disputes` row yet, evidence lives on
  // `jobs.dispute_evidence_urls`) is governed by the job-party policy
  // instead, so it is left open to both sides.
  const canAddEvidence = dispute
    ? dispute.status === "open" && isOpener
    : true;
  // The counterparty's real channel, so the dialog explains rather than
  // just going quiet on them.
  const blockedFromEvidence = !!dispute && dispute.status === "open" && !isOpener;

  const usd = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

  const eyebrowCls = "text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          title="Timeline"
        />

        {loading ? (
          <DialogBody><p>Loading…</p></DialogBody>
        ) : (
          <div className="space-y-3">
            {/* Created */}
            <div className="rounded-ds-md p-3" style={{ background: "hsl(var(--burnt-sienna) / 0.06)", border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)" }}>
              <p className={`${eyebrowCls} inline-flex items-center gap-1.5`}>
                <Clock className="w-3 h-3" /> Filed
                {createdAt && (
                  <span className="font-sans normal-case tracking-normal" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    · {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
                  </span>
                )}
              </p>
              {reason && (
                <p className="font-serif italic mt-1.5 leading-snug text-ds-14" style={{ color: "hsl(var(--ink-deep) / 0.88)" }}>
                  "{reason}"
                </p>
              )}
              <p className="font-sans text-ds-10 mt-1.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {isOpener ? "Filed by you." : "Filed by the other party."}
              </p>
            </div>

            {/* Evidence */}
            <div>
              <p className={`${eyebrowCls} inline-flex items-center gap-1.5`}>
                <FileImage className="w-3 h-3" /> Evidence on file
                <span className="font-sans normal-case tracking-normal" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  · {evidenceUrls.length}
                </span>
              </p>
              {evidenceUrls.length === 0 ? (
                <p className="font-serif italic mt-1.5 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  No evidence uploaded yet.
                </p>
              ) : (
                <div className="flex gap-2 flex-wrap mt-1.5">
                  {evidenceUrls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-16 h-16 rounded-ds-sm overflow-hidden border border-border hover:border-primary transition-colors"
                    >
                      <img loading="lazy" decoding="async" src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Decision (only when decided) */}
            {decidedAt && (
              <div className="rounded-ds-md p-3" style={{ background: "hsl(var(--primary) / 0.08)", border: "0.5px solid hsl(var(--primary) / 0.25)" }}>
                <p className={`${eyebrowCls} inline-flex items-center gap-1.5`} style={{ color: "hsl(var(--primary))" }}>
                  <CheckCircle2 className="w-3 h-3" /> Decided
                  <span className="font-sans normal-case tracking-normal" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    · {formatDistanceToNow(new Date(decidedAt), { addSuffix: true })}
                  </span>
                </p>
                {decisionText && (
                  <p className="font-serif italic mt-1.5 leading-snug text-ds-14" style={{ color: "hsl(var(--ink-deep) / 0.88)" }}>
                    "{decisionText}"
                  </p>
                )}
                {payoutSplit && (
                  <p className="font-sans text-ds-11 mt-1.5" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                    Payout: poster <span className="tabular-nums font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{Math.round((payoutSplit.poster ?? 0) * 100)}%</span>
                    {" · "}
                    Helpr <span className="tabular-nums font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{Math.round((payoutSplit.helper ?? 0) * 100)}%</span>
                  </p>
                )}
                {/* THE AMOUNTS, not just the percentages. This is the screen
                    where each party finds out what a dispute over their money
                    actually cost them, and it was quoting a ratio and nothing
                    else — "poster 50% · Helpr 50%" of an escrow neither side
                    is shown anywhere on this dialog. These are the settled
                    figures execute-dispute-split stamped, so they are what
                    moved, not a recomputation. */}
                {dispute?.execution_status === "executed" &&
                  (dispute.execution_helper_cents != null || dispute.execution_refund_cents != null) && (
                    <p className="font-sans text-ds-11 mt-1" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                      Settled: poster{" "}
                      <span className="tabular-nums font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                        {usd(dispute.execution_refund_cents ?? 0)}
                      </span>
                      {" · "}
                      Helpr{" "}
                      <span className="tabular-nums font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                        {usd(dispute.execution_helper_cents ?? 0)}
                      </span>
                    </p>
                  )}
              </div>
            )}

            {/* The other party can't attach here — say so, and point at the
                channel that does work, instead of silently rendering nothing
                where the filer sees an uploader. */}
            {blockedFromEvidence && (
              <p
                className="font-serif italic text-ds-12 pt-1"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                Only the person who filed can add evidence here. Your side of it
                goes in the response box on this job's card, and an admin reads
                both before deciding.
              </p>
            )}

            {/* Follow-up evidence uploader */}
            {canAddEvidence && (
              <div className="space-y-1.5 pt-1">
                <Label className={eyebrowCls}>
                  Add follow-up evidence
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {evidenceFiles.map((file, i) => (
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
                        onClick={() => removeFile(i)}
                        aria-label="Remove file"
                        className="inline-flex items-center justify-center h-10 w-10 -my-2 -mr-2 active:opacity-70"
                        style={{ color: "hsl(var(--burnt-sienna))" }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {evidenceFiles.length < 5 && (
                  <label
                    className="inline-flex items-center gap-1.5 text-ds-12 font-sans font-semibold cursor-pointer active:opacity-70"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    <Upload className="w-3.5 h-3.5" strokeWidth={2.25} /> {evidenceFiles.length === 0 ? "Add photos" : "Add more"}
                    <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {/* `outline`: the Upload button beside it is conditional, so most of
              the time this is the footer's only control. */}
          <DialogSecondaryAction onClick={onClose}>
            Close
          </DialogSecondaryAction>
          {/* Uploading follow-up evidence adds to the record — it removes
              nothing and penalises nobody — so this is the ordinary glossy
              primary, not the destructive treatment it was wearing. */}
          {canAddEvidence && evidenceFiles.length > 0 && (
            <DialogPrimaryAction
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Uploading…" : `Upload ${evidenceFiles.length} File${evidenceFiles.length === 1 ? "" : "s"}`}
            </DialogPrimaryAction>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DisputeTimelineDialog;
