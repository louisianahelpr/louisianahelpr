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
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { storageExtFor } from "@/lib/storageExt";
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
import { Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProofPhotoUrls } from "@/hooks/useProofPhotoUrls";
import { ProofPhotoImg } from "@/components/ProofPhotoImg";
import { toast } from "sonner";
import { PROOF_PHOTO_TYPES, isAllowedUploadType, unsupportedUploadCopy } from "@/lib/uploadTypes";
import { report } from "@/lib/errorLogger";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { disputeEvidenceChannel, isAdminReopened } from "@/components/disputeEvidenceChannel";
import { disputeCloseReason, closeMovedNothing } from "@/components/disputeCloseReason";
import { partitionEvidenceUrls } from "@/lib/evidenceUrl";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { MoneyNote } from "@/components/money/MoneyNote";
import { DisputeDecisionCard, DisputeTrack, cardCls, cardStyle, outcomeHeadline } from "@/components/disputeTimeline/DisputeDecisionCard";
import { userFacingError } from "@/lib/userFacingError";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

interface DisputeRow {
  id: string;
  job_id: string;
  opener_id: string | null;
  reason: string;
  evidence_urls: string[];
  status: "open" | "decided" | "withdrawn" | "superseded";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_text: string | null;
  payout_split: { poster?: number; helper?: number } | null;
  /** What the split ACTUALLY settled at, once execute-dispute-split ran. */
  execution_status: string | null;
  execution_helper_cents: number | null;
  execution_refund_cents: number | null;
  /** Why a settlement closed without moving money (e.g. a lost card chargeback, Q342). */
  execution_error?: string | null;
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
  // Which side of the job the viewer is on, so the decision reads "back to
  // you" or "you take home" (board 142). null = unknown or a crew member: both
  // amounts are shown, labelled, exactly as before.
  const [side, setSide] = useState<"poster" | "helpr" | null>(null);
  // The job's payment state, so "the payment stays held" shows only while it
  // really is (escrow). A dispute can be filed on an unfunded job, or sit on a
  // chargeback (lh-money-escrow review, 2026-10-21).
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  // A failed dispute read shows an error, never an "under review" view built
  // from nothing (lh-silent-failure review, 2026-10-21).
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
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
      setLoadError(false);
      const { data, error } = await supabase.from("disputes")
        .select("id, job_id, opener_id, reason, evidence_urls, status, created_at, decided_at, decided_by, decision_text, payout_split, execution_status, execution_helper_cents, execution_refund_cents, execution_error")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error && error.code !== "PGRST116" && error.code !== "PGRST205" && error.code !== "42P01") {
        // PGRST116 = no row, PGRST205 = relation missing, 42P01 same.
        // Any other shape we want to know about.
        report(error, { tags: { source: "DisputeTimelineDialog.load" } });
        setLoadError(true);
        setLoading(false);
        return;
      }

      setDispute((data as DisputeRow | null) ?? null);

      // The viewer's side. A failed read falls back to the neutral two-line
      // view (reported, never silent), so a miss costs wording, not money.
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .select("customer_id, helper_id, payment_status")
        .eq("id", jobId)
        .maybeSingle();
      if (cancelled) return;
      if (jobErr) report(jobErr, { tags: { source: "DisputeTimelineDialog.side" } });
      setSide(job?.customer_id === userId ? "poster" : job?.helper_id === userId ? "helpr" : null);
      setPaymentStatus((job?.payment_status as string | null | undefined) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, jobId, userId, reloadKey]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const valid = files.filter((f) => {
      if (!isAllowedUploadType(f, PROOF_PHOTO_TYPES)) {
        toast.error(unsupportedUploadCopy(f, "a JPG, PNG, WebP or HEIC photo"));
        return false;
      }
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
        // Extension comes from the file's MIME type, never its name — both
        // because a client-chosen name must never set a storage key's
        // extension (docs/OPEN.md LIVE DEFECT #5), and because the MIME map's
        // values are always plain [a-z0-9], which also keeps the stored URL's
        // path segment inside the server's anchored evidence check
        // ([^/?#]+…): a filename like "photo.jp#g" could otherwise put a `#`
        // in the object path, and the upload would succeed while the dispute
        // RPC then refused the URL with a misleading "not your upload" error.
        const ext = storageExtFor(file, "jpg");
        const path = `${uid}/disputes/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("proof-photos").upload(path, file, { cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
        if (uploadError) {
          report(uploadError, { tags: { source: "DisputeTimelineDialog.upload" } });
          failedUploads += 1;
          continue;
        }
        // Store the PATH, never a signed URL — same rule as DisputeDialog, and
        // the same reason: a stored `exp` turns decisive evidence into an empty
        // box a year later with nothing failing on either side. Signed at
        // display time by useProofPhotoUrls in both readers.
        newUrls.push(path);
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

      if (dispute && disputeEvidenceChannel(dispute, userId) === "reopened") {
        // A dispute an admin re-opened has no opener, so the opener-only UPDATE
        // below matches nobody. rpc_add_dispute_evidence is the channel for
        // either party there (party check, own-upload path check, set-like
        // append, jobs mirror — all server-side), and it returns the merged
        // array, so there is no last-write-wins window to re-read around.
        const { data: merged, error: rpcErr } = await supabase.rpc("rpc_add_dispute_evidence", {
          _dispute_id: dispute.id,
          _evidence_urls: newUrls,
        });
        if (rpcErr) {
          // PGRST202: the function is not deployed yet (migration lag). Say so
          // plainly; it is not a defect to report.
          if ((rpcErr as { code?: string }).code === "PGRST202") {
            throw new Error("Adding evidence here isn't available yet — try again in a few minutes.");
          }
          // A refusal the server explains is not a defect: say what it said.
          const known = rpcErrorMessage("rpc_add_dispute_evidence", rpcErr);
          if (known) throw new Error(known);
          report(rpcErr, { tags: { source: "DisputeTimelineDialog.addEvidenceReopened" } });
          throw new Error("Couldn't attach your evidence — the dispute may have been decided. Refresh and try again.");
        }
        setDispute({ ...dispute, evidence_urls: (merged as string[] | null) ?? [...(dispute.evidence_urls ?? []), ...newUrls] });
      } else if (dispute) {
        // Re-read the array immediately before merging. This UPDATE sends the
        // WHOLE array, so it is last-write-wins: merging onto the copy loaded
        // when the dialog opened would silently DELETE anything added since —
        // including, once both sides can file, the other party's evidence.
        const { data: fresh, error: freshErr } = await supabase.from("disputes")
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
          await supabase.from("disputes")
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
        // Legacy path — append onto jobs.dispute_evidence_urls. The server
        // holds this column append-only for the parties, and every element
        // added must be the caller's own `<uid>/disputes/<job>/…` upload
        // (trg_jobs_dispute_evidence_append_only, 20260925154842, Q398). The
        // UPDATE sends the WHOLE array, so re-read it first, as the disputes
        // branch above does: merging onto the copy loaded with the card would
        // drop anything the other party added since, which the server now
        // refuses as a removal.
        const { data: freshJob, error: freshJobErr } = await supabase.from("jobs")
          .select("dispute_evidence_urls")
          .eq("id", jobId)
          .maybeSingle();
        if (freshJobErr) {
          report(freshJobErr, { tags: { source: "DisputeTimelineDialog.reReadLegacyEvidence" } });
          throw new Error("Couldn't attach your evidence — try again?");
        }
        const existing: string[] = (freshJob?.dispute_evidence_urls as string[] | null) ?? legacy?.evidence_urls ?? [];
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
      toast.error(mutationErrorMessage(err, userFacingError(err, "Couldn't upload your evidence — try again?")));
    } finally {
      setSubmitting(false);
    }
  };

  // Render-time helpers — keep the timeline rows DRY.
  const reason = dispute?.reason ?? legacy?.reason ?? null;
  const createdAt = dispute?.created_at ?? legacy?.disputed_at ?? null;
  const openerId = dispute?.opener_id ?? legacy?.disputed_by ?? null;
  // Only this project's signed proof-photo URLs render as a link or image; any
  // other string a party stored is counted and withheld (src/lib/evidenceUrl.ts).
  const { trusted: evidenceUrls, withheld: withheldEvidence } = partitionEvidenceUrls(
    dispute?.evidence_urls?.length ? dispute.evidence_urls : (legacy?.evidence_urls ?? []),
  );
  // Stored as a storage path, signed here for the life of this dialog. Same
  // length and order as `evidenceUrls`, so the two zip; a legacy full URL
  // still resolves through extractProofPhotoPath.
  const evidenceSrcs = useProofPhotoUrls(evidenceUrls);
  // "Decided" means an outcome: a WITHDRAWN dispute also stamps decided_at
  // (rpc_withdraw_dispute), so it gets its own state, never "Decision".
  const withdrawn = dispute?.status === "withdrawn";
  const decidedAt = dispute
    ? (dispute.status === "decided" || dispute.status === "superseded" ? dispute.decided_at : null)
    : (legacy?.dispute_resolved_at ?? null);
  const decisionText = dispute?.decision_text ?? null;
  const payoutSplit = dispute?.payout_split ?? null;
  // Written by settle_dispute_by_chargeback (20260926034237) or
  // settle_dispute_by_external_refund (20261003181427, Q1191).
  const closeReason = disputeCloseReason(dispute);
  const movedNothing = closeMovedNothing(closeReason);
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
  //
  // One exception (round 5): a dispute an admin re-opened has no opener, and
  // either party adds evidence through rpc_add_dispute_evidence instead.
  const evidenceChannel = disputeEvidenceChannel(dispute, userId);
  const canAddEvidence = evidenceChannel === "opener" || evidenceChannel === "reopened" || evidenceChannel === "legacy";
  // The counterparty's real channel, so the dialog explains rather than
  // just going quiet on them.
  const blockedFromEvidence = evidenceChannel === "blocked";

  const executed = dispute?.execution_status === "executed" && !movedNothing;
  // A close outside the split (chargeback, outside refund, no payment, test
  // mode) leaves payout_split as decided but moves other amounts: its own
  // sentence (DISPUTE_CLOSE_COPY) explains it, so no split headline.
  // Settled FOR THIS VIEWER = their amount was stamped. The 72-hour
  // auto-resolve stamps 'executed' with null amounts while the payout still
  // waits on its hold, so 'executed' alone is not "paid".
  const refundStamped = dispute?.execution_refund_cents != null;
  const helperStamped = dispute?.execution_helper_cents != null;
  const settledForViewer = executed && (side === "poster" ? refundStamped : side === "helpr" ? helperStamped : refundStamped || helperStamped);
  const decisionHeadline = decidedAt && !closeReason ? outcomeHeadline(side, payoutSplit, settledForViewer) : null;
  const heldNow = paymentStatus === "escrow" && !decidedAt && !withdrawn;

  const eyebrowCls = "text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Board 142 (spec v2 §9.28). Real data only: the filed date, the
            reason and photos on file, the decision text and the amounts
            execute-dispute-split stamped. Left out (truth rule): a "decide
            by" date (the 72-hour clock is an auto-settle time, not a promise
            to decide), card digits and bank timing (not stored for jobs), a
            named staff member (lead 10-21: members see "Helpr Support"),
            and "ask for a second look" (only an admin can reopen). */}
        <DialogHero title={loadError ? "Dispute" : decidedAt ? "Decision" : withdrawn ? "Withdrawn" : "Under review"} />

        {loading ? (
          <DialogBody><p>Loading…</p></DialogBody>
        ) : loadError ? (
          <DialogBody>
            <ReportErrorScreen source="DisputeTimelineDialog" title="Couldn't load this dispute." />
            <p role="alert" className="text-ds-14 text-foreground">Couldn't load this dispute.</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-2 text-ds-13 font-semibold"
              style={{ color: "hsl(var(--bark))" }}
            >
              Try again
            </button>
          </DialogBody>
        ) : (
          <div className="space-y-3">
            {/* Status card + the one tracker */}
            <div className={cardCls} style={cardStyle}>
              <p className="font-sans font-bold text-ds-16 leading-snug text-foreground">
                {decidedAt ? "Decided" : withdrawn ? "Withdrawn by the person who filed it" : isOpener ? "You reported a problem" : "A problem was reported"}
              </p>
              <p className="font-sans text-ds-12 mt-0.5 text-muted-foreground">
                {createdAt ? `Opened ${format(new Date(createdAt), "MMM d")}` : "Opened"}
                {decidedAt ? ` · decided ${format(new Date(decidedAt), "MMM d")}` : ""}
                {" · "}
                {isAdminReopened(dispute)
                  ? "re-opened by Helpr Support for a new decision"
                  : dispute && dispute.opener_id === null
                    // No opener and not a re-open: the filer's account is gone.
                    ? "filed on this job"
                    : isOpener ? "filed by you" : "filed by the other person"}
              </p>
              {!withdrawn && <DisputeTrack step={decidedAt ? 2 : 1} />}
              {reason && (
                <p className="font-sans mt-3 leading-snug text-ds-14 text-foreground">
                  "{reason}"
                </p>
              )}
            </div>

            {heldNow && (
              <MoneyNote>
                The payment stays held while this is open. Nobody is paid meanwhile.
              </MoneyNote>
            )}

            {/* Decision (only when decided) */}
            {decidedAt && (
              <DisputeDecisionCard
                dispute={dispute}
                side={side}
                headline={decisionHeadline}
                executed={executed}
                closeReason={closeReason}
                decisionText={decisionText}
              />
            )}

            {/* Evidence */}
            <div className={cardCls} style={cardStyle}>
              <p className={eyebrowCls}>
                Photos on file · {evidenceUrls.length}
              </p>
              {withheldEvidence > 0 && (
                <p className="font-sans mt-1.5 text-ds-12 text-muted-foreground">
                  {withheldEvidence} attachment{withheldEvidence === 1 ? "" : "s"} not shown (not an uploaded photo).
                </p>
              )}
              {evidenceUrls.length === 0 ? (
                withheldEvidence === 0 && (
                  <p className="font-sans mt-1.5 text-ds-13 text-muted-foreground">
                    No photos yet.
                  </p>
                )
              ) : (
                <div className="flex gap-2 flex-wrap mt-2">
                  {evidenceUrls.map((_, i) => {
                    const src = evidenceSrcs[i];
                    return (
                      <a
                        key={i}
                        href={src ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-16 h-16 rounded-ds-sm overflow-hidden border border-border hover:border-primary transition-colors"
                      >
                        <ProofPhotoImg insideControl src={src} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            {/* The other party can't attach here — say so, and point at the
                channel that does work, instead of silently rendering nothing
                where the filer sees an uploader. */}
            {blockedFromEvidence && (
              <p
                className="font-sans text-ds-12 pt-1"
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
                  Add more photos
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
                    className="inline-flex items-center gap-1.5 text-ds-12 font-sans font-semibold cursor-pointer active:opacity-70 focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.45)]"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    <Upload className="w-3.5 h-3.5" strokeWidth={2.25} /> {evidenceFiles.length === 0 ? "Add photos" : "Add more"}
                    <input type="file" accept="image/*" multiple onChange={handleFileChange} className="sr-only" />
                  </label>
                )}
              </div>
            )}
            <p className="font-sans text-ds-12 text-muted-foreground">
              Questions?{" "}
              <Link to="/support?topic=message" onClick={onClose} className="font-semibold" style={{ color: "hsl(var(--bark))" }}>
                Talk to a real person
              </Link>
            </p>
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
