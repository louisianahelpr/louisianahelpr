import { useState } from "react";
import { confirmConsequential } from "@/lib/toastPolicy";
import { Button } from "@/components/ui/button";
import { JobActionChip, JobStepPrimaryButton } from "@/components/activity/JobActionRow";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, History, LifeBuoy, MessageSquare, Send, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { isExpectedLifecycleRefusal, lifecycleErrorMessage } from "@/lib/lifecycleErrors";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { notifyJobParty } from "@/lib/notifications";
import { formatDistanceToNow } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { HelperPhotoAsk } from "./steps/HelperPhotoAsk";
import { HelperTrackerPanel } from "./HelperTrackerPanel";
import type { TrackingData } from "@/components/JobTracking";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { helperDisputeCopy } from "./helperDisputeCopy";
import { disputeSupportSubject } from "@/lib/supportSubject";
import type { AppliedApp, Job } from "../activityConstants";

interface DisputedSectionProps {
  app: AppliedApp;
  job: Job;
  userId: string;
  initialTracking?: TrackingData | null;
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
  userId,
  initialTracking,
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
  const hasAllProof =
    (job.proof_before_urls?.length ?? 0) > 0 && (job.proof_after_urls?.length ?? 0) > 0;
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
      const { error } = await supabase.rpc("rpc_withdraw_dispute", { _job_id: app.job_id });
      if (error) {
        // A settlement in progress is the lock working, not a defect: say so,
        // and keep it out of Sentry. Everything else is reported as before.
        const expected = isExpectedLifecycleRefusal(error);
        if (!expected) {
          report(error, { tags: { source: "DisputedSection.withdrawDispute" }, context: { job_id: app.job_id } });
        }
        hapticError();
        toast.error(
          expected
            ? (lifecycleErrorMessage(error) ?? "We couldn't withdraw that dispute — please try again.")
            : "We couldn't withdraw that dispute — please try again.",
        );
        return;
      }
      if (job.customer_id) {
        // Copy and link (`/my-posts?job=`) are built server-side (Q223).
        await notifyJobParty({ user_id: job.customer_id, job_id: job.id, template: "dispute_withdrawn" });
      }
      hapticSuccess();
      confirmConsequential("Dispute withdrawn — the payment is off hold.");
      setWithdrawConfirmOpen(false);
      onRefresh();
    } finally {
      setWithdrawing(false);
    }
  };

  /* THE TRACKER STAYS (owner, 2026-09-14, VN-23: "disputes should still show
     the tracker"). This reverses the earlier layout, where the dispute banner
     REPLACED the tracker in the shell's `header` slot on the reasoning that a
     disputed job "has left the step rail". The poster's card never did that —
     PostedJobCard's `showsTracker` includes `disputed` — so the two ends of one
     dispute disagreed about whether the job still had a tracker.

     The header is now the SAME HelperTrackerPanel every live step mounts, with
     the dispute banner directly below it: where the job stopped first, then
     why it is frozen. `readOnly` because nothing on the rail may move while
     the dispute holds the job — JobTracking already clamps a disputed job at
     Working and refuses its Done; read-only also refuses the earlier steps
     for a dispute raised before the work began. */
  const header = (
    <>
      <HelperTrackerPanel app={app} job={job} userId={userId} initialTracking={initialTracking} readOnly />
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
    </>
  );

  /* ── THE HALF-MIGRATED STATE, FINISHED ──
     Owner, 2026-09-11: this panel was still drawing the OLD Photo Proof card —
     two columns, two live uploaders, a red requirement note — while every live
     step of the same card had moved to one ask at a time. Two designs for one
     thing shipped together because the lane that changed it was scoped to the
     active states.

     The ability to add evidence mid-dispute is NOT removed, it is asked for the
     same way it is asked for everywhere else: HelperPhotoAsk renders the one
     missing photo (Before, then After — chronological, because this is evidence
     rather than a step). Once both exist there is nothing to ask for, so the
     group becomes what it is on the completed card: a READ-ONLY review of what
     was uploaded. */
  const ask = job.poster_confirmed_working_at ? (
    hasAllProof ? (
      <PhotoProofGroup
        jobId={app.job_id}
        beforeUrls={job.proof_before_urls || []}
        afterUrls={job.proof_after_urls || []}
        canUpload={false}
      />
    ) : null
  ) : null;

  /* THE EVIDENCE CAPTURE, ON THE ROW (owner, 2026-09-19: "before and after
     buttons should also be on the same lines as the other buttons"). It used
     to be a panel in the `ask` slot above the row. Same rule as the two live
     steps, and the same component — a dispute is not a special case.

     It renders nothing once both photos exist (the read-only group above takes
     over) and nothing on a no-photos-required job, so this row is 4-up or
     5-up. The 5-up at 320 is the tightest row in the app: four 44px icon-only
     chips leave the primary ~56px, and "Withdraw" measures ~50px at 11px —
     inside it, but by 4px. Eyeball it before believing it. */
  const photoChip = job.poster_confirmed_working_at && !hasAllProof
    ? <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="dispute" />
    : null;

  const body = (
    <>
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
      {!hasResponded && canRespond && (awaitingAdmin || respondingJobId === app.job_id) && (
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
          {/* The FORM stays here, above the row — it is this state's ask. The
              button that opens it is the row's primary (see `primary` below,
              owner 2026-09-14, VN-21). `data-job-step-form` tells the one-row
              guard these are form controls, not the card's moves. */}
          {respondingJobId === app.job_id && (
            <div className="space-y-2" data-job-step-form="">
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
              {/* GREEN PRIMARY RIGHT-MOST (owner, 2026-09-19), like every other
                  pair on these cards — PendingApplicationSection's Cancel/Save
                  and OfferedActions both read ghost-then-primary. This one was
                  the exact inverse, glossy Submit FIRST with a ghost Cancel to
                  its right, and it survived the VN-21/V2/V3 sweeps only
                  because `data-job-step-form` (above) makes the one-row guard
                  skip these controls as content. Submit also bypassed
                  JobStepPrimaryButton entirely — no released height, no
                  composed accessible name — while Cancel carried no geometry
                  at all beside a `flex-1` sibling. Both fixed here; the
                  handlers, gates and busy state are untouched. */}
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => { setRespondingJobId(null); setDisputeResponse(""); }}>Cancel</Button>
                {/* The primary sizes itself from the row it normally lives in;
                    here it needs a flex parent of its own to share the width
                    with Cancel. */}
                <div className="flex-1 min-w-0">
                  <JobStepPrimaryButton
                  icon={Send}
                  label={submittingResponse ? "Sending…" : "Submit"}
                  ariaLabel="Submit your side of this dispute"
                  disabled={!disputeResponse.trim() || submittingResponse}
                  onClick={async () => {
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
                  // Server-built copy (Q223); it reads dispute_status for the
                  // "an admin is reviewing it" variant.
                  if (job.customer_id) await notifyJobParty({ user_id: job.customer_id, job_id: job.id, template: "dispute_response" });
                  hapticSuccess();
                  setSubmittingResponse(false);
                  setRespondingJobId(null);
                  setDisputeResponse("");
                  onRefresh();
                  }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </>
  );

  /* THE ROW'S PRIMARY — Withdraw for the person who filed, Respond for the
     person who did not. The two are mutually exclusive by construction:
     `canRespond` is false for the opener and `canWithdraw` is true only for the
     opener — so the state never has two primaries, which is the shell's rule.

     Both lead the card's ONE action row, in the dark green, with Timeline /
     Message / Contact Admin beside them (owner, 2026-09-14, VN-21). Respond
     used to be a full-width outline inside the body above the row; it opens
     the same inline form, which still renders above the row, and it steps out
     of the row while that form is open (the form's Submit is the move then). */
  const respondOpen = respondingJobId === app.job_id;
  const primary = canWithdraw ? (
    <JobStepPrimaryButton
      icon={Undo2}
      label="Withdraw Dispute"
      disabled={withdrawing}
      onClick={() => setWithdrawConfirmOpen(true)}
    />
  ) : !hasResponded && canRespond && !respondOpen ? (
    /* "Respond to Dispute" implies the poster is still the one listening.
       Once it is escalated they are not. */
    <JobStepPrimaryButton
      icon={MessageSquare}
      label={awaitingAdmin ? "Add Your Side" : "Respond to Dispute"}
      onClick={() => setRespondingJobId(app.job_id)}
    />
  ) : null;

  /* Gated alongside its button — a confirm whose primary action the server
     would refuse must not be reachable at all (the same rule `canResolve`
     gates the poster's release confirm with). */
  const dialogs = canWithdraw ? (
        <BrandConfirmDialog
          open={withdrawConfirmOpen}
          onOpenChange={setWithdrawConfirmOpen}
          title="Withdraw this dispute?"
          description="The job goes back to where it was before you filed, and the payment comes off hold and returns to its normal schedule. You can file again if the issue isn't actually settled."
          callout={{ icon: AlertTriangle, text: "Only withdraw if you and the person who posted this job have sorted it out." }}
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
  ) : null;

  /* No hardcoded "within 72 hours" policy line — the DeadlineCountdown in the
     header renders the job's ACTUAL dispute_deadline and its caption already
     says what happens when it lapses.

     View Timeline / Message / Contact Admin — three peers, and the SHELL counts
     them, so this row is a 3-up for the same reason every other state's row is
     the width it is. */
  /* THE PHOTO CHIP MOVES TO THE END (owner, 2026-09-19: "before and after
     photos should be to the left of the primary buttons"). It led this array
     until today. */
  /* ── THE LEAD SLOT IS THE ESCAPE, ON THIS SIDE TOO (owner, 2026-09-19,
     second phone report: "the escape chip is not consistently pinned left …
     the pin rule is not holding on the helper side") ────────────────────────
     The poster's disputed row leads with `Escalate` — its danger-tone way out
     of the dispute. This row led with `Message`, so the two sides of the same
     dispute put different KINDS of control in the slot the reader's thumb
     lands on first, which is the inconsistency that was reported.

     There is no Report a Problem chip on a disputed card — the dispute IS the
     report — so the Helpr's way out is `Contact Admin`: the one control here
     that reaches a human who can end it. It leads; Message follows; the two
     read-only destinations (Timeline & Evidence, and Contact Admin's old
     place) come after, which is the house order
     `partitionJobStepRowChips` documents (escape, then Message, then the
     ancillary read-only ones).

     WHAT THIS COSTS, said plainly: at 320 the row holds ONE labelled chip
     beside `More` and the primary, so `Message` is now inside `More` there
     rather than in the row. It is one tap away and it is LABELLED, which is
     more than it was when the row kept it and stripped its label. */
  const actions = [
        <JobActionChip
          key="admin"
          icon={LifeBuoy}
          label="Contact Admin"
          ariaLabel="Contact an admin about this dispute"
          tone="neutral"
          /* Carries the job, same as the poster's chip in PostedJobActions —
             `?topic=` / `?subject=` are the only params Support.tsx reads. The
             title is what both people call the job and is already public; the
             short id on the end lets support find the row. (Was the bare UUID,
             which the person could not recognise and 375 clipped mid-token.) */
          onClick={() => navigate(`/support?topic=report&subject=${encodeURIComponent(disputeSupportSubject({ id: app.job_id, title: job.title }))}`)}
        />,
        <JobActionChip
          key="message"
          icon={MessageSquare}
          label="Message"
          ariaLabel="Message them"
          tone="message"
          onClick={() => navigate(`/messages?jobId=${app.job_id}&userId=${job.customer_id}`)}
        />,
        <JobActionChip
          key="timeline"
          // Its own icon, not the AlertTriangle Contact Admin also wore. The
          // reason has changed but the rule has not: these chips are never
          // icon-only any more (2026-09-19), yet two identical triangles under
          // two different words is still two controls that look the same.
          icon={History}
          // "View Timeline & Add Evidence" wanted 169px in a 110px chip at
          // 375px and still overflowed by 45px at 1440. The chip wraps now,
          // but a four-word label in a three-up row is three lines of 11px
          // type — the label carries the same meaning at a third the width,
          // and the full phrasing survives in the spoken name below.
          label="Timeline & Evidence"
          ariaLabel="View dispute timeline and add evidence"
          tone="neutral"
          onClick={() => onViewDispute(job)}
        />,
        photoChip,
  ];

  return (
    <JobStepCard
      side="helper"
      step="disputed"
      tone="alert"
      header={header}
      ask={ask}
      notice={body}
      primary={primary}
      actions={actions}
      dialogs={dialogs}
    />
  );
}
