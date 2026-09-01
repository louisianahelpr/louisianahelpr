import { useState } from "react";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";
import { fireSlackAlert } from "@/lib/slackAlerts";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { unwrapMutation } from "@/lib/mutationResult";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import type { Database } from "@/integrations/supabase/types";

const DISPUTE_REASONS = [
  { value: "work_not_done", label: "Work was not done" },
  { value: "poor_quality", label: "Poor quality work" },
  { value: "no_show", label: "Helpr didn't show up" },
  { value: "incomplete", label: "Work was left incomplete" },
  { value: "other", label: "Other" },
];

interface DisputeDialogProps {
  jobId: string;
  jobTitle: string;
  userId: string;
  open: boolean;
  onClose: () => void;
  onDisputed: () => void;
}

export const DisputeDialog = ({ jobId, jobTitle, userId, open, onClose, onDisputed }: DisputeDialogProps) => {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const disputedStatus: Database["public"]["Enums"]["job_status"] = "disputed";

  // Known precondition codes get human copy; anything else keeps the raw
  // message (still more useful than a generic string when it is an RLS or
  // network failure). Raw Postgres codes like "dispute_already_open" were
  // reaching the toast verbatim — owner, 2026-08-25: "I'm trying to file a
  // dispute but it's not letting me".
  const getErrorMessage = (error: unknown) =>
    lifecycleErrorMessage(error) ??
    (error instanceof Error ? error.message : "Couldn't file the dispute — try again?");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`"${f.name}" exceeds 5 MB limit.`);
        return false;
      }
      return true;
    });
    setEvidenceFiles((prev) => [...prev, ...validFiles].slice(0, 5));
  };

  const removeFile = (index: number) => {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!reason) {
      hapticError();
      toast.error("Please select a reason.");
      return;
    }
    hapticHeavy();
    setSubmitting(true);
    try {
      // Upload evidence photos. The proof-photos INSERT policy requires the
      // FIRST path segment to be the uploader's uid, so evidence must live
      // under `<uid>/disputes/<jobId>/…` — the old `disputes/<jobId>/…` shape
      // was rejected 400 by RLS on every single file, and the per-file
      // `continue` swallowed it, so disputes were filed with zero evidence and
      // the admin resolved them blind. Failures are now surfaced, not skipped.
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      const evidenceUrls: string[] = [];
      let failedUploads = 0;
      for (const file of evidenceFiles) {
        const ext = file.name.split(".").pop();
        const path = `${uid}/disputes/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("proof-photos").upload(path, file);
        if (uploadError) {
          report(uploadError, { tags: { source: "DisputeDialog.uploadEvidence" } });
          failedUploads += 1;
          continue;
        }
        const { data: urlData, error: signedUrlError } = await supabase.storage.from("proof-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
        if (signedUrlError) {
          report(signedUrlError, { tags: { source: "DisputeDialog.createSignedUrl" } });
          failedUploads += 1;
          continue;
        }
        if (urlData?.signedUrl) evidenceUrls.push(urlData.signedUrl);
      }
      // Evidence decides the dispute, so a silent partial upload is not
      // acceptable: stop and let them retry rather than filing short.
      if (failedUploads > 0) {
        hapticError();
        toast.error(
          `${failedUploads} of ${evidenceFiles.length} photo${evidenceFiles.length === 1 ? "" : "s"} didn't upload. Try again — your evidence matters here.`,
        );
        setSubmitting(false);
        return;
      }

      const reasonText = `${DISPUTE_REASONS.find((r) => r.value === reason)?.label}: ${details}`.trim();

      // Prefer the formal rpc_open_dispute path (writes a dedicated
      // disputes row + mirrors onto the legacy jobs.dispute_* columns
      // + flips job.status to 'disputed'). Migrations don't auto-deploy
      // (see CLAUDE.md), so when the RPC isn't pushed yet we fall back
      // to the prior direct-update path so the feature isn't broken
      // between merge and `supabase db push`.
      //
      // Cast through `any` until the next `supabase gen types` lands —
      // this RPC is added in migration 20260609140000 which hasn't been
      // reflected in `src/integrations/supabase/types.ts` yet.
      const { data: disputeId, error: rpcError } = await (supabase.rpc as any)(
        "rpc_open_dispute",
        { _job_id: jobId, _reason: reasonText, _evidence_urls: evidenceUrls },
      );

      if (rpcError && rpcError.code !== "PGRST202") {
        throw rpcError;
      }

      // The RPC returns the dispute's uuid. A null error is not proof it
      // filed — this is the one screen where "we said it worked and it did
      // not" freezes someone's money on a promise the database never made, so
      // the returned id is checked rather than discarded.
      if (!rpcError && !disputeId) {
        throw new Error(
          "This job couldn't be disputed — it may have already been resolved or closed. Refresh and try again.",
        );
      }

      if (rpcError?.code === "PGRST202") {
        // Fallback — RPC not deployed yet. Direct-update the legacy
        // columns so the disputed state is still surfaced everywhere
        // that reads from `jobs`.
        // .select("id"): the legacy fallback writes the disputed state that
        // holds the payment. If RLS or a stale id makes it match zero rows the
        // update returns error === null, and this would have gone on to alert
        // admins about a dispute the job row never entered.
        unwrapMutation(
          await supabase.from("jobs").update({
            status: disputedStatus,
            dispute_reason: reasonText,
            dispute_evidence_urls: evidenceUrls,
            disputed_at: new Date().toISOString(),
            disputed_by: userId,
          }).eq("id", jobId).select("id"),
          {
            action: "open a dispute on this job",
            rejectedMessage: "This job couldn't be disputed — it may have already been resolved or closed. Refresh and try again.",
            context: { jobId },
          },
        );
      }

      // NO client-side admin fan-out. There used to be one here — read
      // `user_roles` for every admin, then bulk-INSERT a notification for
      // each — and it could never have worked. Both halves are refused by
      // RLS, and both refusals are silent:
      //
      //   1. `user_roles` has no SELECT policy for an ordinary user, so the
      //      read returns `{ data: [], error: null }`. The `if
      //      (adminRoles?.length)` guard then skipped the insert entirely, so
      //      even the error path never ran.
      //   2. The insert itself is 403 / 42501 — the only surviving
      //      `notifications` INSERT policies are admin-only and
      //      service-role-only (the two user-facing ones were dropped in
      //      20260403180249 and 20260412180149 and never recreated).
      //
      // Both verified against production on 2026-08-31 with an ordinary
      // authenticated account: the role read returned 0 rows, and a direct
      // insert for another user returned 42501. So no admin has ever received
      // an in-app notification for a filed dispute, and the `report()` on the
      // insert error never fired because the insert was never reached.
      //
      // Notifying is the SERVER's job, and it is the only place that can do
      // it: `rpc_open_dispute` is SECURITY DEFINER and already holds the job's
      // both-party ids. Routing it through `create-notification` would not
      // work either — that function allows self, admin, or a shared-job
      // counterparty, and a filer shares no job with an admin.
      //
      // The Slack ops alert below is the channel that does work today.

      // Fire Slack ops alert (non-blocking)
      const reasonLabel = DISPUTE_REASONS.find((r) => r.value === reason)?.label || "Unknown";
      fireSlackAlert({
        kind: "dispute_filed",
        severity: "critical",
        title: "Job disputed",
        message: `*${jobTitle}* — ${reasonLabel}. Payment is on hold pending admin review.`,
        fields: {
          "Job ID": jobId,
          Reason: reasonLabel,
          "Disputed by": userId,
          "Evidence files": evidenceUrls.length,
        },
        // `?view=`, not `?tab=`. Admin.tsx reads `searchParams.get("view")`
        // (Admin.tsx:86) and falls back to "home" for anything else, so the
        // `?tab=disputes` this used to send dropped every responder on the
        // admin dashboard with no idea which queue to open — on the one alert
        // that says real money is frozen.
        link: `https://www.louisianahelpr.com/admin?view=disputes`,
      });

      hapticSuccess();
      onDisputed();
      onClose();
    } catch (err: unknown) {
      hapticError();
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          title="File a Dispute"
        />
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              Reason
            </Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label="Reason" className="rounded-ds-md bg-background/60 border-border/60 focus:border-primary/40">
                <SelectValue placeholder="Pick the closest fit…" />
              </SelectTrigger>
              <SelectContent>
                {DISPUTE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              What happened?
            </Label>
            <Textarea
              aria-label="What happened?"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="The more specific you are, the faster admin can help…"
              rows={3}
              maxLength={1000}
              className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14 leading-relaxed"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              Photo evidence — up to 5
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
                  <button onClick={() => removeFile(i)} aria-label="Remove file" className="inline-flex items-center justify-center h-10 w-10 -my-2 -mr-2 active:opacity-70" style={{ color: "hsl(var(--burnt-sienna))" }}>
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

          <div
            className="rounded-ds-md p-3"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              boxShadow: "var(--elev-inset-gloss)",
            }}
          >
            <ul
              className="font-serif italic space-y-0.5 list-disc pl-4 leading-snug text-ds-12"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              <li>Payment is held for <strong className="not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>72 hours only</strong> while admin reviews.</li>
              <li>If unresolved in 72 hours, payment auto-releases to the Helpr.</li>
              <li>Evidence (photos, messages) makes your case stronger.</li>
              <li>False or frivolous disputes can lead to warnings or suspension.</li>
              <li>3+ disputes in 30 days flags your account for review.</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>Cancel</DialogSecondaryAction>
          {/* Destructive: a filed dispute cannot be withdrawn from this
              screen and it freezes the counterparty's escrow, so it belongs to
              the same family as "Confirm No-Show". Shared `destructive`
              variant, not a hand-copied burnt-sienna style block. */}
          <DialogDestructiveAction
            onClick={handleSubmit}
            disabled={submitting || !reason}
          >
            {submitting ? "Submitting…" : "Submit Dispute"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
