import { useState } from "react";
import { Button } from "@/components/ui/button";
import { JobActionRow, JobActionChip } from "@/components/activity/JobActionRow";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, MessageSquare, Send, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { formatDistanceToNow } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { helperDisputeCopy } from "./helperDisputeCopy";
import { disputeSupportSubject } from "@/lib/supportSubject";
import type { AppliedApp, Job } from "../activityConstants";

interface DisputedSectionProps {
  app: AppliedApp;
  job: Job;
  navigate: (to: string) => void;
  onViewDispute: (job: Job) => void;
  onRefresh: () => void;
  disputeResponse: string;
  setDisputeResponse: (value: string) => void;
  respondingJobId: string | null;
  setRespondingJobId: (id: string | null) => void;
  submittingResponse: boolean;
  setSubmittingResponse: (value: boolean) => void;
}

/** Disputed */
export function DisputedSection({
  app,
  job,
  navigate,
  onViewDispute,
  onRefresh,
  disputeResponse,
  setDisputeResponse,
  respondingJobId,
  setRespondingJobId,
  submittingResponse,
  setSubmittingResponse,
}: DisputedSectionProps) {
  const disputeStatus = job.dispute_status || "open";
  const hasResponded = !!job.dispute_helper_response;
  // WHO FILED IT decides every sentence on this panel, and until 2026-09-06
  // every sentence assumed the poster did. See helperDisputeCopy.ts for the
  // production case that proved otherwise and what each branch now says; the
  // rules live there rather than inline so helperDisputeCopy.test.ts can walk
  // the whole state space without a render.
  const { awaitingAdmin, headline, reasonLabel, consequenceText, canRespond, canWithdraw } =
    helperDisputeCopy(job, app.helper_id);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // The helper's only non-admin exit from a dispute they raised. Mirrors the
  // poster's Resolve & Pay handler (PostedJobActions) minus the money: a
  // withdrawal moves nothing, it un-freezes the job and hands it back to the
  // status it held before the dispute — `completed`/payout_pending if the
  // poster had already approved, `in_progress` if not.
  //
  // REPORTED, not just toasted, for exactly the reason the poster's twin is:
  // this RPC was a 100%-failing call for the opener-helper until 20260908024937
  // (42501 "Helpers may not modify jobs.dispute_resolved_at" — the helper
  // column whitelist did not list the stamp the RPC's own UPDATE writes), and
  // a money control that is dead for months with zero Sentry events is what
  // this line exists to prevent.
  const withdrawDispute = async () => {
    setWithdrawing(true);
    try {
      const { error } = await supabase.rpc("rpc_withdraw_dispute" as never, { _job_id: app.job_id } as never);
      if (error) {
        report(error, { tags: { source: "DisputedSection.withdrawDispute" }, context: { job_id: app.job_id } });
        hapticError();
        toast.error("We couldn't withdraw that dispute — please try again.");
        return;
      }
      if (job.customer_id) {
        await createNotification({
          user_id: job.customer_id,
          title: "Dispute withdrawn",
          message: `The Helpr withdrew the dispute on "${job.title}". The payment is off hold and back on its normal schedule.`,
          type: "info",
          // `?job=` — the job returns to whichever bucket its restored status
          // computes; a fixed `?filter=` would be wrong for one of the two.
          link: `/my-posts?job=${job.id}`,
        });
      }
      hapticSuccess();
      toast.success("Dispute withdrawn — the payment is off hold.");
      setWithdrawConfirmOpen(false);
      onRefresh();
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div
      className="px-4 py-3 space-y-2.5"
      onClick={(e) => e.stopPropagation()}
      style={{
        borderTop: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
        background: "hsl(var(--burnt-sienna) / 0.06)",
      }}
    >
      {/* Dispute info */}
      <div
        className="rounded-ds-md p-3"
        style={{
          background: "hsl(var(--burnt-sienna) / 0.10)",
          border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
        }}
      >
        <span
          className="font-sans uppercase inline-flex items-center gap-1.5 text-ds-10"
          style={{ color: "hsl(var(--sienna-ink))", letterSpacing: "0.18em" }}
        >
          <AlertTriangle className="w-3 h-3" />
          {/* Keyed to `awaitingAdmin`, NOT to `escalated` alone. With the
              narrower test, a dispute sitting at `under_review` printed
              "Dispute open" here and "Both sides are talking it out." below
              — while the paragraph a few lines further down said "An admin is
              deciding this one." One card, two contradictory answers to the
              only question the helper has. */}
          {awaitingAdmin ? "Admin reviewing" : "Dispute open"}
        </span>
        <p
          className="font-display italic font-bold leading-tight mt-2 text-ds-16"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          {headline}
        </p>
        {job.dispute_reason && (
          <p
            className="font-sans mt-1.5 text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            {/* "Reason:" alone read as an accusation against the reader even
                when the reader wrote it. */}
            {reasonLabel}{job.dispute_reason}
          </p>
        )}
        {job.disputed_at && (
          <p
            className="font-sans mt-1 text-ds-11"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Filed {formatDistanceToNow(new Date(job.disputed_at), { addSuffix: true })}
          </p>
        )}
      </div>

      {job.dispute_deadline && (
        <DeadlineCountdown
          deadline={job.dispute_deadline}
          expiredText="Deadline passed — payment auto-releasing to you"
          /* Both branches state the SAME mechanism —
             `auto-resolve-disputes` settles every non-escalated expired
             dispute with `_outcome: "helper"` (index.ts:196) — but only one of
             them can be read as "complain and wait, and you win". The
             helper-opened branch says what the clock does without dressing it
             up as a reward, and names the move that actually resolves it. */
          consequenceText={consequenceText}
          variant="destructive"
        />
      )}

      {/* Photo proof */}
      {job.poster_confirmed_working_at && (
        <PhotoProofGroup
          jobId={app.job_id}
          beforeUrls={job.proof_before_urls || []}
          afterUrls={job.proof_after_urls || []}
          canUploadBefore={true}
          canUploadAfter={true}
          requireAfter={true}
          budget={job.budget || 0}
        />
      )}

      {/* Helper's response */}
      {hasResponded && (
        <section aria-labelledby={`dispute-response-${app.job_id}`} className="p-2 rounded-ds-sm bg-primary/5 border border-primary/20">
          {/* Owner, 2026-08-31: "Remove eye brows." The visible label is gone
              on every card section; the tinted panel and the quotation marks
              already mark these as the helper's own words. The name survives
              for screen readers so the aria-labelledby above still resolves —
              dropping it would leave this section unnamed. */}
          <h4 id={`dispute-response-${app.job_id}`} className="sr-only">Your response</h4>
          <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
        </section>
      )}

      {/* Respond form. `canRespond` is false when THIS helper opened the
          dispute: the box writes `dispute_helper_response`, which the poster's
          card renders under the heading "Helpr's response", so there is nothing
          to respond to and the control read as being asked to answer your own
          complaint. Their words are already in `dispute_reason`, shown above. */}
      {!hasResponded && canRespond && (
        <div className="space-y-2">
          {/* Say who reads it once it is out of the poster's hands, so the
              control does not read as a dead end. */}
          {awaitingAdmin && (
            <p
              className="font-sans text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              An admin is deciding this one. You can still add your side — it goes
              into the record they read before they decide.
            </p>
          )}
          {respondingJobId === app.job_id ? (
            <div className="space-y-2">
              {/* Still a REAL <label htmlFor>, just not a visible one (owner,
                  2026-08-31: "Remove eye brows"). An aria-label alone was
                  rejected here and still is. What a sighted user reads instead
                  is the placeholder, which says the same thing in more words —
                  so removing the eyebrow costs nothing on screen, unlike the
                  case that put a label here in the first place. */}
              <label htmlFor={`dispute-reply-${app.job_id}`} className="sr-only">Your side of it</label>
              <Textarea
                id={`dispute-reply-${app.job_id}`}
                placeholder="Explain your side — what work was done, any issues, etc."
                value={disputeResponse}
                onChange={(e) => setDisputeResponse(e.target.value)}
                rows={3}
                maxLength={500}
                className="text-ds-11"
              />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={!disputeResponse.trim() || submittingResponse} onClick={async () => {
                  setSubmittingResponse(true);
                  // `.select("id")`: a bare `.update().eq(...)` resolves
                  // `{data: null, error: null}` whether it changed one row or
                  // NONE, so an RLS-filtered write (dispute resolved out from
                  // under this card) read as success and showed a response
                  // the poster never received.
                  // The STATUS only moves out of 'open'. Stamping
                  // 'helper_responded' on an escalated dispute would silently
                  // DE-escalate it, and `auto-resolve-disputes` treats that as
                  // a money decision: it skips escalated disputes
                  // (index.ts:56) and auto-releases the FULL escrow to the
                  // helper on any other status past the 72h deadline
                  // (index.ts:113). `helper_abort_job` sets 'escalated'
                  // precisely to stop that (20260825191500), so writing the
                  // response must not undo it — the helper gets heard, the
                  // escrow stays frozen for the admin.
                  const patch: { dispute_helper_response: string; dispute_status?: string } =
                    disputeStatus === "open"
                      ? { dispute_helper_response: disputeResponse.trim(), dispute_status: "helper_responded" }
                      : { dispute_helper_response: disputeResponse.trim() };
                  const { data: saved, error } = await supabase.from("jobs").update(patch).eq("id", app.job_id).select("id");
                  if (error || !saved || saved.length === 0) { hapticError(); toast.error("We couldn't submit your response — please try again."); setSubmittingResponse(false); return; }
                  if (job.customer_id) await createNotification({ user_id: job.customer_id, title: "Helpr responded to dispute", message: awaitingAdmin ? `The Helpr added their side of the dispute on "${job.title}". An admin is reviewing it.` : `The Helpr has responded to the dispute on "${job.title}". Please review and mark resolved or escalate.`, // `?job=` — `disputed` has no chip; an open dispute buckets to
          // "Needs you" and moves the moment it resolves.
          type: "info", link: `/my-posts?job=${job.id}` });
                  hapticSuccess();
                  setSubmittingResponse(false);
                  setRespondingJobId(null);
                  setDisputeResponse("");
                  onRefresh();
                }}>
                  <Send className="w-3.5 h-3.5 mr-1" /> {submittingResponse ? "Sending…" : "Submit"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setRespondingJobId(null); setDisputeResponse(""); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setRespondingJobId(app.job_id)}>
              {/* "Respond to Dispute" implies the poster is still the one
                  listening. Once it is escalated they are not. */}
              <MessageSquare className="w-4 h-4 mr-1" /> {awaitingAdmin ? "Add Your Side" : "Respond to Dispute"}
            </Button>
          )}
        </div>
      )}

      {/* WITHDRAW — the exit that did not exist. Shaped like "Respond to
          Dispute" above rather than as a chip in the row below, because it is
          this panel's primary move for the person who filed, and the three
          chips at the foot are all read-only or off-card. The two are mutually
          exclusive by construction: `canRespond` is false for the opener and
          `canWithdraw` is true only for the opener. */}
      {canWithdraw && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={withdrawing}
          onClick={() => setWithdrawConfirmOpen(true)}
        >
          <Undo2 className="w-4 h-4 mr-1" /> Withdraw Dispute
        </Button>
      )}
      {/* Gated alongside its button — a confirm whose primary action the
          server would refuse must not be reachable at all (the same rule
          `canResolve` gates the poster's release confirm with). */}
      {canWithdraw && (
        <BrandConfirmDialog
          open={withdrawConfirmOpen}
          onOpenChange={setWithdrawConfirmOpen}
          title="Withdraw this dispute?"
          description="The job goes back to where it was before you filed, and the payment comes off hold and returns to its normal schedule. You can file again if the issue isn't actually settled."
          callout={{ icon: AlertTriangle, text: "Only withdraw if you and the poster have sorted it out." }}
          primaryLabel="Withdraw Dispute"
          /* `bark`, not `sienna`: sienna is reserved for the genuinely
             irreversible (the poster's twin releases escrow and can never be
             undone). A withdrawal moves no money and `rpc_open_dispute`'s
             existing-dispute branch re-freezes the job if it is filed again. */
          primaryTone="bark"
          primaryDisabled={withdrawing}
          onPrimary={() => { void withdrawDispute(); }}
          secondaryLabel="Keep It Open"
        />
      )}

      {/* No hardcoded "within 72 hours" policy line — the DeadlineCountdown
          above renders the job's ACTUAL dispute_deadline and its caption
          already says what happens when it lapses; a fixed 72h sentence
          contradicted it whenever the live deadline differed. */}
      {/* View Timeline / Message / Contact Admin — one 3-up row (mirrors the
          same fix on the poster's side, PostedJobActions), instead of a
          full-width View Timeline button followed by a separate 2-up row. */}
      <JobActionRow columns={3}>
        <JobActionChip
          icon={AlertTriangle}
          // "View Timeline & Add Evidence" wanted 169px in a 110px chip at
          // 375px and still overflowed by 45px at 1440. The chip wraps now,
          // but a four-word label in a three-up row is three lines of 11px
          // type — the label carries the same meaning at a third the width,
          // and the full phrasing survives in the spoken name below.
          label="Timeline & Evidence"
          ariaLabel="View dispute timeline and add evidence"
          tone="neutral"
          onClick={() => onViewDispute(job)}
        />
        <JobActionChip
          icon={MessageSquare}
          label="Message"
          ariaLabel="Message poster"
          tone="message"
          onClick={() => navigate(`/messages?jobId=${app.job_id}&userId=${job.customer_id}`)}
        />
        <JobActionChip
          icon={AlertTriangle}
          label="Contact Admin"
          ariaLabel="Contact an admin about this dispute"
          tone="neutral"
          /* Carries the job, same as the poster's chip in PostedJobActions —
             `?topic=` / `?subject=` are the only params Support.tsx reads. The
             title is what both people call the job and is already public; the
             short id on the end lets support find the row. (Was the bare UUID,
             which the person could not recognise and 375 clipped mid-token.) */
          onClick={() => navigate(`/support?topic=report&subject=${encodeURIComponent(disputeSupportSubject({ id: app.job_id, title: job.title }))}`)}
        />
      </JobActionRow>
    </div>
  );
}
