import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JOB_ACTION_FULL_CLASS, jobActionChipStyle } from "@/components/activity/JobActionRow";
import { JobConfirmation, helperDayOfConfirmation } from "@/components/JobConfirmation";
import { JobTracking, type TrackingData } from "@/components/JobTracking";
import { parseLocalDate } from "@/lib/dateUtils";
import type { AppliedApp, Job } from "../activityConstants";

/**
 * ONE BOX, NOT TWO — the helper's live tracker with the day-of confirmation
 * merged into it.
 *
 * Owner, 2026-08-30: "Bottom box needs to be merged in the live tracker. They
 * should confirm before they can mark on the way."
 *
 * The card used to stack two glass panels that were the same thing said twice:
 *
 *   1. the tracker — the step rail (Offered / Accepted / Confirmed / On the Way
 *      / Arrived) with a full-width green "On the Way" button under it, and
 *   2. a detached card below it — "Still on for this one?", the date a third
 *      time, two status chips ("You: Pending" / "Poster: Confirmed"), and a
 *      SECOND full-width green button, "I'm Still On".
 *
 * "Confirmed" is a STEP IN THE RAIL, and the day-of tap is how that step gets
 * completed — so it belongs at that step, not in a second card underneath
 * restating it in different words. Two full-width green primaries in one card
 * was the visible symptom; the reachable-in-the-wrong-order buttons were the
 * actual bug.
 *
 * The You/Poster chips are DELETED rather than relocated (owner: "remove you
 * posted confirmed etc."). The rail already carries that fact — "Confirmed" as
 * the current step IS "you haven't confirmed yet", and the button under it is
 * what clears it.
 *
 * ── The gate ──────────────────────────────────────────────────────────────
 * `helper_mark_on_the_way` (migration 20260829061546) raises
 * `helper_not_confirmed` when `helper_confirmed_at IS NULL`, so the server has
 * a floor here and the UI used to offer a button the server would reject —
 * landing on a generic "Couldn't mark you on the way" toast that told the
 * helper nothing about what to do.
 *
 * The floor is not the rule, though. `helper_confirmed_at` is stamped at ACCEPT
 * time, possibly days early, so it is always non-null on a scheduled job and
 * gates nothing the helper can see. The owner's rule is the DAY-OF answer —
 * exactly the thing the second box was asking for — so the gate is
 * {@link helperDayOfConfirmation}: the helper's own day-before stamp, or an
 * accept that itself happened inside the 24h window.
 *
 * It is still THE HELPER'S OWN confirmation and nothing else. The poster's
 * `poster_confirmed_at` does NOT gate this, deliberately and for the same
 * reason JobTracking stopped gating on `bothConfirmed`: a poster who never
 * confirms must not be able to trap a helper on a job the server would start
 * happily. Client is stricter than the server floor, never stricter than the
 * owner's rule, and never dependent on the other party.
 */
export function HelperTrackerPanel({
  app,
  job,
  userId,
  initialTracking,
  onCantMakeIt,
}: {
  app: AppliedApp;
  job: Job;
  userId: string;
  initialTracking?: TrackingData | null;
  /** Hands off to the caller's real cancel flow from inside the commit popup.
   *  Omitted where the caller has none (a job already underway). */
  onCantMakeIt?: () => void;
}) {
  const dayOfConfirmed = helperDayOfConfirmation({
    helperConfirmedAt: job.helper_confirmed_at,
    helperDayofConfirmedAt: job.helper_dayof_confirmed_at,
    dateNeeded: job.date_needed,
  });

  const hoursUntilJob =
    (parseLocalDate(job.date_needed).getTime() - Date.now()) / 3_600_000;

  /**
   * Is the Confirmed step still the helper's to complete?
   *
   * Scoped tightly so this can never take controls away from a job that has
   * moved on:
   *  - only a job still sitting at `accepted`/`open` (an `open` job is a
   *    part-staffed group booking — see deriveAppliedJobCardState),
   *  - only before any on-the-way / arrival stamp exists,
   *  - only while JobConfirmation would still offer the tap. `hoursUntilJob`
   *    is measured from MIDNIGHT of the job date, so -24 is "the job day is
   *    over": past it the confirmation is moot, the tracker takes over again,
   *    and a stale job can never dead-end with no controls at all. This bound
   *    and JobConfirmation's helper window are the same number ON PURPOSE — the
   *    gate may only hold while the control that releases it exists.
   */
  const gateActive =
    (job.status === "accepted" || job.status === "open") &&
    !job.helper_on_the_way_at &&
    !job.helper_arrived_at &&
    !dayOfConfirmed &&
    hoursUntilJob > -24;

  /** The 24h window JobConfirmation itself opens on. Outside it there is no tap
   *  to offer, so the gate shows the clock instead of a dead button. */
  const confirmWindowOpen = hoursUntilJob <= 24;
  const reasonId = `on-the-way-locked-${app.job_id}`;

  const confirmation = (
    <JobConfirmation
      variant="inline"
      jobId={app.job_id}
      isOwner={false}
      isHelper={true}
      posterConfirmedAt={job.poster_confirmed_at}
      helperConfirmedAt={job.helper_confirmed_at}
      helperDayofConfirmedAt={job.helper_dayof_confirmed_at}
      dateNeeded={job.date_needed}
      jobStatus={job.status}
      helperOnTheWayAt={job.helper_on_the_way_at}
      onCantMakeIt={onCantMakeIt}
    />
  );

  return (
    /* `tracker-merged` (index.css) strips the chrome off the JobTracking panel
       nested directly inside, so the rail and the step's own action read as ONE
       box instead of two stacked ones. The wrapper wears the glass. */
    <div className="tracker-merged rounded-2xl liquid-glass p-3 space-y-2">
      {/* `isHelper={!gateActive}`: while the Confirmed step is outstanding this
          panel owns the helper's controls, so the tracker draws the rail only
          and cannot offer "I'm On My Way" out of order. The two side effects
          behind that flag are inert here — the position watcher only runs on an
          `on_the_way` tracking row, and the "work has started" notify only on a
          helper tap — both of which are strictly after this state. */}
      <JobTracking
        jobId={app.job_id}
        helperId={userId}
        isHelper={!gateActive}
        isOwner={false}
        jobDateNeeded={job.date_needed}
        jobStartTime={job.start_time}
        jobStatus={job.status}
        helperConfirmedAt={job.helper_confirmed_at}
        helperDayofConfirmedAt={job.helper_dayof_confirmed_at}
        posterConfirmedAt={job.poster_confirmed_at}
        initialTracking={initialTracking}
        jobLatitude={job.latitude}
        jobLongitude={job.longitude}
        helperOnTheWayAt={job.helper_on_the_way_at}
        helperArrivedAt={job.helper_arrived_at}
        helperArrivalVerifiedAt={job.helper_arrival_verified_at}
        posterConfirmedArrivalAt={job.poster_confirmed_arrival_at}
        helperCompletedAt={job.helper_completed_at}
        posterCompletedAt={job.poster_completed_at}
      />

      {gateActive ? (
        <div className="pt-2 border-t border-border space-y-2">
          {/* The ONE primary while the step is open. */}
          {confirmation}
          {confirmWindowOpen && (
            <>
              {/* A REASON, not a silent dead button — the same shape the
                  tracker's own `disabledReason` line uses one state later, so
                  the locked control and the live one read as one control. */}
              <p id={reasonId} className="text-ds-11 text-muted-foreground text-center">
                Confirm you're still on to unlock this
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled
                aria-describedby={reasonId}
                style={jobActionChipStyle("neutral")}
                className={JOB_ACTION_FULL_CLASS}
              >
                {/* Word-for-word the tracker's own action label (STATUSES), so
                    the button the helper is waiting for is visibly the one that
                    appears the moment they confirm. */}
                <Truck className="w-4 h-4" />
                I'm On My Way
              </Button>
            </>
          )}
        </div>
      ) : (
        /* Confirmed, or past the point of asking: the tracker's own next-step
           control is live above. `confirmation` renders the "Confirmation opens
           in …" clock when the job is still more than a day out, and nothing at
           all once the answer is in.

           Belt and braces on the stamps: JobTracking is offering a primary in
           this branch, so anything that could ALSO render one has to be
           impossible. JobConfirmation already self-hides on `helperOnTheWayAt`;
           `helperArrivedAt` is checked here too so no ordering of the two
           stamps can put two glossy CTAs on one card. */
        !job.helper_on_the_way_at && !job.helper_arrived_at && confirmation
      )}
    </div>
  );
}
