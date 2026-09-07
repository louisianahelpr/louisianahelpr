import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { JobActionRow, JobActionChip } from "@/components/activity/JobActionRow";
import { Button } from "@/components/ui/button";
import { AUTO_COMPLETE_HOURS, PAYOUT_HOLD_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";
import { CheckCircle2, MessageSquare, RefreshCw, Check, CalendarX2 } from "lucide-react";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import { PhotoProofGroup } from "@/components/PhotoProof";
import { hasRequiredProof } from "@/lib/photoProofPolicy";
import { report } from "@/lib/errorLogger";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { deriveCurrentStatusIdx, STATUS_IDX, type TrackingData } from "@/components/JobTracking";
import { HelperTrackerPanel } from "./HelperTrackerPanel";
import { DirectionsButton } from "./DirectionsButton";
import { HelperRevisionCard } from "@/components/activity/HelperRevisionCard";
import type { AppliedApp, Job } from "../activityConstants";

/** The floor a job has to sit above before its payout can be requested. Same
 *  30 minutes JobTracking's Done gate and completeJob's re-check enforce. */
const MIN_WORK_MS = 30 * 60 * 1000;

interface ActiveJobSectionProps {
  app: AppliedApp;
  job: Job & { revision_note?: string | null };
  status: string;
  userId: string;
  initialTracking?: TrackingData | null;
  completingJobId: string | null;
  onComplete: (jobId: string) => void;
  onResolveRevision: (jobId: string) => void;
  navigate: (to: string) => void;
}

/** In Progress / Revision */
export function ActiveJobSection({
  app,
  job,
  status,
  userId,
  initialTracking,
  completingJobId,
  onComplete,
  onResolveRevision,
  navigate,
}: ActiveJobSectionProps) {
  const [resolving, setResolving] = useState(false);

  // ── THE 30-MINUTE WINDOW HAS TO ELAPSE ON SCREEN ──
  //
  // "Available in 25 min" was computed from Date.now() at render time on a
  // component with no timer of any kind — its only other hooks are useState.
  // DeadlineCountdown's 60s interval ticks its OWN state, not ours, so a
  // helper who opened /my-jobs at minute 5 sat there watching a frozen
  // "Available in 25 min" on a disabled button until they navigated away and
  // came back. The unlock moment is a fixed point in time, so compute it once
  // and re-render on it.
  //
  // 60s is the granularity the copy is stated in, so it is the granularity we
  // tick at; and the interval only exists while the gate is actually closed —
  // once it opens `payoutGateClosed` goes false, the effect cleans up and
  // nothing spins for the rest of the job.
  const payoutUnlocksAt = (() => {
    // The floor measures from the poster's working confirmation when it
    // exists, else from the helper's own arrival stamp — a ghosting poster
    // must not be able to hold the clock at zero.
    const workingStart = job.poster_confirmed_working_at ?? job.helper_arrived_at;
    return workingStart ? new Date(workingStart).getTime() + MIN_WORK_MS : null;
  })();
  const [now, setNow] = useState(() => Date.now());
  const payoutGateClosed =
    !job.helper_completed_at &&
    !!job.helper_arrived_at &&
    payoutUnlocksAt != null &&
    now < payoutUnlocksAt;
  useEffect(() => {
    if (!payoutGateClosed) return;
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [payoutGateClosed]);

  // ── The sanctioned exit, and the point at which it stops being offered ──
  //
  // Owner, 2026-08-30: "can't finish should not be an option." Taken literally
  // that strands the state machine — a helper mid-job with no sanctioned exit
  // has no recorded reason, no automatic re-open and escrow held until a human
  // intervenes, which is the ghosting `helper_abort_job` exists to price. So
  // the exit is not deleted, it is BOUNDED: it stays while the job has not
  // actually started, and it is gone once work is underway.
  //
  //   scheduled / on the way / arrived  → the exit is offered
  //   working (and anything after)      → no exit chip at all
  //
  // Past that line the honest move is a conversation, and Message is the
  // control that is still on the row. `helper_abort_job` is untouched and is
  // still the correct RPC for the states above the line — this removes a
  // CONTROL from one state, not the path.
  //
  // `deriveCurrentStatusIdx` is the same derivation the step rail directly
  // above this row is drawn from, so the chip and the rail can never disagree
  // about whether work has started — a card reading "Working" with a
  // "Can't Finish" chip under it is the exact inconsistency this avoids. The
  // evidence handed to it is the evidence HelperTrackerPanel hands JobTracking,
  // item for item. `initialTracking` refreshes on the `job_tracking` realtime
  // subscription in useActivityData, so the tap that starts work also takes
  // the chip away.
  const workUnderway =
    deriveCurrentStatusIdx({
      trackingStatus: initialTracking?.status ?? null,
      jobStatus: job.status,
      helperConfirmedAt: job.helper_confirmed_at,
      helperDayofConfirmedAt: job.helper_dayof_confirmed_at,
      jobDateNeeded: job.date_needed,
      posterConfirmedAt: job.poster_confirmed_at,
      helperOnTheWayAt: job.helper_on_the_way_at,
      helperArrivedAt: job.helper_arrived_at,
      helperArrivalVerifiedAt: job.helper_arrival_verified_at,
      posterConfirmedArrivalAt: job.poster_confirmed_arrival_at,
      helperCompletedAt: job.helper_completed_at,
      posterCompletedAt: job.poster_completed_at,
    }) >= STATUS_IDX.working;

  // Server owns every part of this decision (helper_abort_job, migration
  // 20260825190000): which settlement path the job takes, and what the strike
  // costs. The client only states it truthfully before the tap.
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");
  const [aborting, setAborting] = useState(false);
  const [aborted, setAborted] = useState<"reopened" | "disputed" | null>(null);

  // Same predicate the RPC uses to pick its branch, so the money sentence in
  // the dialog is the one that will actually happen. If these ever drift the
  // SERVER wins — this is copy, not control flow.
  const abortWorkStarted =
    !!job.helper_arrived_at ||
    !!job.helper_completed_at ||
    (job.proof_before_urls?.length ?? 0) > 0 ||
    (job.proof_after_urls?.length ?? 0) > 0;

  const handleAbort = async () => {
    if (aborting) return; // double-fire guard: the dialog stays open on tap
    setAborting(true);
    const { data, error } = await supabase.rpc("helper_abort_job", {
      p_job_id: app.job_id,
      p_reason: abortReason.trim(),
    });
    setAborting(false);
    if (error) {
      hapticError();
      report(error, { tags: { source: "ActiveJobSection.helperAbortJob" } });
      toast.error(
        /not_abortable/.test(error.message)
          ? "This job has already moved on — pull to refresh and take another look."
          : "We couldn’t send that — check your connection and try again.",
        { action: { label: "Retry", onClick: () => void handleAbort() } },
      );
      return; // dialog stays open, reason preserved, primary re-enabled
    }
    hapticError(); // a strike is never a success moment
    const result = data as { action?: string; outcome?: string } | null;
    if (result?.action === "pending_ban_review" || result?.action === "permanent_ban") {
      // Fourth strike — as of 20260829010000 a REVERSIBLE 7-day restriction
      // pending admin review, not an automatic permanent ban. Mirror the
      // decline / cancel-booking paths: hard-load so the restricted session is
      // torn down rather than left live behind the list. The retired
      // "permanent_ban" string is still handled for the pre-deploy window.
      window.location.assign("/account-banned");
      return;
    }
    const outcome = result?.outcome === "disputed" ? "disputed" : "reopened";
    setAborted(outcome);
    setAbortOpen(false);
    toast.warning(
      result?.action === "temp_ban"
        ? "We told the poster — third strike: your account is suspended for 7 days."
        : result?.action === "warning"
          ? "We told the poster — final warning. One more strike is a 7-day suspension."
          : outcome === "disputed"
            ? "We told the poster. Our team will review what you’re owed."
            : "We told the poster, and the job is open again. This counts as a reliability strike.",
    );
  };

  // Does THIS poster release instantly? Read once the banner could show;
  // false on any error — the 24h countdown is the safe default, instant is
  // only ever a nicer message. Column lands with migration 20260824238000;
  // a missing column just resolves to false.
  const { data: posterInstantRelease = false } = useQuery({
    queryKey: ["poster-instant-release", job.customer_id],
    enabled: !!job.helper_completed_at && !job.poster_completed_at && !!job.customer_id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("auto_release_on_complete")
        .eq("user_id", job.customer_id as string)
        .maybeSingle();
      // False stays the safe default (the 24h countdown renders), but the
      // failure must be observable — dropping it made a broken read look
      // exactly like "this poster doesn't auto-release".
      if (error) report(error, { severity: "warning", tags: { source: "ActiveJobSection.posterInstantRelease" } });
      return !!data?.auto_release_on_complete;
    },
  });

  const handleMarkFixed = async () => {
    setResolving(true);
    try {
      await onResolveRevision(app.job_id);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
      {/* Live tracking for in-progress jobs — the SAME merged panel the
          scheduled card uses, so the tracker is one box on both. On an
          in-progress job the day-of confirmation is already behind the helper
          (or moot), so the panel's gate is inert here and JobTracking's own
          next-step control is live; what this buys is that the two cards draw
          one tracker rather than two. */}
      <HelperTrackerPanel app={app} job={job} userId={userId} initialTracking={initialTracking} />

      {/* Completion status — right after tracker */}
      {job.helper_completed_at && !job.poster_completed_at && !job.revision_requested_at && (
        <div className="rounded-ds-md border border-primary/20 bg-primary/5 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-ds-13 font-semibold text-primary">Marked Complete</span>
          </div>
          <div className="px-3 pb-2.5 space-y-1">
            <p className="text-ds-11 text-muted-foreground">Waiting for the poster to:</p>
            <ul className="text-ds-11 text-muted-foreground list-disc pl-4 space-y-0.5">
              <li><span className="text-foreground font-medium">Approve & complete</span> the job</li>
              <li>Or <span className="text-foreground font-medium">request a revision</span></li>
            </ul>
            {/* APPROVAL IS NOT PAYMENT, AND THIS COPY USED TO CONFLATE THEM.
                A 2026-09-06 end-to-end review followed the money and found the
                gap: approving sets payment_status='payout_pending' with
                payout_scheduled_at = now + PAYOUT_HOLD_HOURS, and
                process-scheduled-payouts fires the transfer only once that
                passes. So the helper is paid a DAY after approval, not at it.

                Both branches said otherwise. "It's on its way" described a
                transfer that had not been scheduled yet, and
                `auto_release_on_complete` — the flag behind it — only skips
                the poster's review window; it does not touch the payout hold,
                which create-payment sets unconditionally. The other branch
                promised release "within AUTO_COMPLETE_HOURS", which is when
                the job auto-COMPLETES; the money is another hold after that.

                Nobody was cheated — the funds always arrived — but a helper
                deciding whether to take the next job was reading a number a
                day early, and that is the kind of quiet wrongness that reads
                as a broken payout the first time someone checks their bank.
                Both numbers now come from escrowTiming, which the cron and
                escrowTiming.parity.test.ts both read. */}
            <p className="text-ds-10 text-muted-foreground/70 pt-1">
              {posterInstantRelease
                ? `This poster approves instantly — then your payout is released ${PAYOUT_HOLD_HOURS} hours later.`
                : `If the poster doesn't respond within ${AUTO_COMPLETE_HOURS} hours, the job completes automatically and your payout is released ${PAYOUT_HOLD_HOURS} hours after that.`}
            </p>
          </div>
          {/* No countdown when the poster releases instantly (owner,
              2026-08-24): a 24h timer that ends within minutes is a lie. */}
          {job.helper_completed_at && !posterInstantRelease && (
            <div className="px-3 pb-2.5">
              <DeadlineCountdown
                deadline={new Date(new Date(job.helper_completed_at).getTime() + hoursToMs(AUTO_COMPLETE_HOURS)).toISOString()}
                expiredText={`${AUTO_COMPLETE_HOURS} hours passed — completing automatically, payout ${PAYOUT_HOLD_HOURS}h later`}
                consequenceText={`The job completes automatically when this timer expires. Your payout is released ${PAYOUT_HOLD_HOURS} hours after that.`}
                variant="warning"
              />
            </div>
          )}
        </div>
      )}
      {/* The terminal state said "Job complete" and nothing else — the one
          moment the helper most wants to know about money, and the only card
          state that mentioned none. Approval had just moved the job to
          payout_pending on a PAYOUT_HOLD_HOURS timer, and every earlier line
          the helper had read ("Request Payout", "Release Payment", "payment
          will be released to you") pointed at that instant. Silence there let
          them conclude it had already landed. */}
      {job.helper_completed_at && job.poster_completed_at && (
        <div className="rounded-ds-sm bg-primary/10 border border-primary/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-ds-13 font-medium text-primary">Job complete</span>
          </div>
          {job.payment_status === "released" ? (
            <p className="text-ds-10 text-muted-foreground/70 pt-1">
              Payout sent. It lands in your bank on your usual payout schedule.
            </p>
          ) : (
            <p className="text-ds-10 text-muted-foreground/70 pt-1">
              Approved. Your payout releases {PAYOUT_HOLD_HOURS} hours after approval,
              then lands in your bank on your usual payout schedule.
            </p>
          )}
        </div>
      )}

      {/* The day-of confirmation used to render a SECOND glass card here, a
          full card-height below the tracker it belongs to. It now lives inside
          HelperTrackerPanel above, at the step it completes. */}
      {/* Revision notice — HelperRevisionCard shows the formal
          job_revisions row (or falls back to jobs.revision_note).
          The "I'll fix it" / "Discuss" path lives there. */}
      {status === "revision_requested" && (
        <div className="space-y-2">
          <HelperRevisionCard
            jobId={app.job_id}
            posterId={job.customer_id ?? null}
            legacyRevisionNote={job.revision_note ?? null}
            onAccepted={() => { /* optimistically keep showing the card — parent refetches */ }}
          />
          {job.revision_deadline && !job.revision_completed_at && (
            <DeadlineCountdown
              deadline={job.revision_deadline}
              expiredText="Revision deadline passed — poster can dispute or complete"
              consequenceText="Fix the revision before the deadline. If not completed, the poster can file a dispute."
              variant="warning"
            />
          )}
          {job.revision_completed_at ? (
            <div className="space-y-2">
              <div
                className="text-ds-11 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded font-medium w-full"
                style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}
              ><Check className="w-3 h-3 shrink-0" strokeWidth={3} /> Marked as fixed — waiting for poster</div>
              {job.revision_acceptance_deadline && (
                <DeadlineCountdown
                  deadline={job.revision_acceptance_deadline}
                  expiredText="Poster didn't respond — payment auto-releasing"
                  consequenceText="If the poster doesn't accept or dispute, payment auto-releases to you."
                  variant="warning"
                />
              )}
            </div>
          ) : (
            <Button size="sm" variant="outline" className="w-full" disabled={resolving} onClick={handleMarkFixed}><RefreshCw className={`w-4 h-4 mr-1${resolving ? " animate-spin" : ""}`} /> {resolving ? "Marking…" : "Mark Fixed"}</Button>
          )}
        </div>
      )}

      {/* Photo proof — anchored on the helper's own ARRIVAL, the same stamp
          that unlocks the payout button below. Gating this on the poster's
          working confirmation hid the uploader behind a stamp a ghosting
          poster never sets, while the payout button kept demanding the
          photos the helper had no way to add. */}
      {job.helper_arrived_at && (
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

      {/* Complete + Message */}
      <div className="space-y-2">
        {/* Renders from ARRIVAL, not from the poster's working confirmation
            (owner, 2026-08-24): a poster who never confirms working must not
            be able to block the payout request — they keep the 24h review
            window instead. The 30-min floor measures from their confirmation
            when it exists, else from the helper's own arrival stamp. */}
        {!job.helper_completed_at && job.helper_arrived_at && (() => {
          // ONE shared proof rule (photoProofPolicy) — the same predicate
          // JobTracking's Done step and completeJob's re-check enforce.
          const hasPhotos = hasRequiredProof(job, job.proof_before_urls, job.proof_after_urls);
          // `now`, not `Date.now()` — the state the minute timer above drives,
          // which is what makes this button re-enable itself while the helper
          // is looking at it.
          const tooEarly = payoutUnlocksAt != null && now < payoutUnlocksAt;
          const minutesLeft = payoutUnlocksAt != null ? Math.ceil((payoutUnlocksAt - now) / 60000) : 0;
          const disabled = completingJobId === app.job_id || !hasPhotos || tooEarly;
          const label = completingJobId === app.job_id ? "…" : !hasPhotos ? "Upload before & after photos first" : tooEarly ? `Available in ${minutesLeft} min` : "Mark Complete";
          return (
            <>
              <Button
                size="sm"
                className="w-full rounded-ds-md"
                onClick={() => onComplete(app.job_id)}
                disabled={disabled}
                style={
                  !disabled
                    ? {
                        background: "hsl(var(--bark))",
                        backgroundImage: "none",
                        border: "1px solid hsl(var(--bark))",
                        color: "hsl(var(--parchment))",
                        boxShadow: "var(--elev-bark-raised)",
                      }
                    : undefined
                }
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                {label === "Mark Complete" ? "I'm Done — Request Payout" : label}
              </Button>
              {tooEarly && (
                <p className="font-serif italic text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Available 30 minutes after arrival to ensure quality.
                </p>
              )}
            </>
          );
        })()}
        {/* THREE PEERS, ONE ROW — the same shared JobActionRow the scheduled
            card and the posted card use (owner, 2026-08-30: "directions
            messages and can't make it all need to be buttons in a row side by
            side"). Directions was a full-width outline, Message another, and
            the exit a bare underlined link: three treatments for three peers.

            Directions is still hidden once the helpr has ARRIVED — they are
            already there — and the exit collapses to a sentence once taken, so
            the column count is derived from what actually renders rather than
            assumed; JobActionRow's explicit `columns` exists for exactly this. */}
        {(() => {
          const showDirections = !job.helper_arrived_at && !!job.location?.trim();
          /* The exit is offered only BEFORE work starts, and only until it has
             been taken — see `workUnderway` above. `columns` is derived from
             what actually renders, which is why the row does not strand a lone
             stretched button when the exit drops out: at `working` the helpr
             has also arrived, so Directions is already gone and the row is a
             single full-width Message chip rather than one chip floating in a
             three-column grid. */
          const showExit = !aborted && !workUnderway;
          const columns = (1 + (showDirections ? 1 : 0) + (showExit ? 1 : 0)) as 1 | 2 | 3;
          return (
            <>
              <JobActionRow columns={columns}>
                {showDirections && <DirectionsButton location={job.location} variant="chip" />}
                <JobActionChip
                  icon={MessageSquare}
                  label="Message"
                  ariaLabel="Message the poster about this job"
                  tone="message"
                  onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}
                />
                {/* The sanctioned exit for a job already underway. This REPLACES
                    the stopgap line that used to sit here ("once a job starts it
                    can only be completed or disputed") — true when it was
                    written, and the defect: ghosting was the only remaining move
                    AND the cheapest one, because it recorded no strike while
                    every honest exit did. */}
                {showExit && (
                  <JobActionChip
                    icon={CalendarX2}
                    label="Can't Finish"
                    ariaLabel="Can't finish this job? See what happens if you stop now"
                    tone="danger"
                    onClick={() => setAbortOpen(true)}
                  />
                )}
              </JobActionRow>
              {aborted && (
                <p className="font-serif italic text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {aborted === "disputed"
                    ? "You’ve told the poster you can’t finish. Our team is reviewing what you’re owed — the payment is held safely until then."
                    : "You’ve told the poster you can’t finish. The job is open to other Helprs again."}
                </p>
              )}
            </>
          );
        })()}
        <BrandConfirmDialog
          open={abortOpen}
          onOpenChange={(next) => { if (!aborting) setAbortOpen(next); }}
          title="Can’t Finish This Job?"
          description=""
          callout={{
            icon: CalendarX2,
            text: `Stopping a job you committed to counts as a reliability strike — ${RELIABILITY_LADDER_SENTENCE}. Telling us costs exactly the same as going quiet, and going quiet costs the poster their whole day.`,
          }}
          primaryLabel={aborting ? "Sending…" : "I Can’t Finish"}
          primaryTone="sienna"
          primaryHaptic="warning"
          primaryDisabled={aborting || abortReason.trim().length < 5}
          onPrimary={(e) => { e.preventDefault(); void handleAbort(); }}
          secondaryLabel="Cancel"
        >
          <div className="space-y-2.5">
            {/* The money outcome, stated plainly, before the tap. */}
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood))" }}>
              {abortWorkStarted
                ? "You’ve already started, so we won’t decide who’s owed what on our own. The poster’s payment is held safely and our team reviews it — you may still be paid for the part you did."
                : "You never started, so the poster is charged nothing. The job reopens for other Helprs right away and their payment stays protected."}
            </p>
            <label htmlFor={`abort-reason-${app.job_id}`} className="block text-ds-11 font-medium text-foreground">
              What happened? The poster sees this.
            </label>
            <Textarea
              id={`abort-reason-${app.job_id}`}
              value={abortReason}
              onChange={(e) => setAbortReason(e.target.value)}
              maxLength={1000}
              rows={3}
              disabled={aborting}
              placeholder="My van broke down and I can’t get back out there today."
            />
          </div>
        </BrandConfirmDialog>
      </div>
    </div>
  );
}
