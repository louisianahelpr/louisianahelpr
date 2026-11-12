import { lazy, Suspense } from "react";
import { takeHelperStepRequest } from "@/components/job-card/helperStepRequest";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { APPROVAL_WINDOW_HOURS } from "../../supabase/functions/_shared/escrowTiming";
import { jobStartDateTime } from "@/lib/dateUtils";
import { confirmOpensMs, jobDateMs, todayMs, JOB_TIMEZONE } from "@/lib/jobDate";
import { formatShortDate } from "@/lib/format";
import { arrivalEstablished, arrivalGateMessage, arrivalRefusalMessage } from "@/lib/arrivalGate";
import { BEFORE_PHOTO_GATE_REASON } from "@/lib/lifecycleErrors";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { JobProgress } from "@/components/tracker/JobProgress";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { JobStepRowSlot } from "@/components/job-card/jobStepRow";
/* `JobActionChip` was imported here for the "Try my location again" chip
   only; that control is gone (owner, 2026-09-19) and this component draws no
   chips of its own again — just its one primary. */
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { STATUSES } from "@/components/job-card/trackerSteps";
import { STATUS_IDX } from "@/lib/jobProgressIndex";
import type { JobTrackingModel } from "./JobTracking";
import { TrackingStatusLine } from "./TrackingStatusLine";
import "@/lib/i18n/enTracker";
import type { MsgKey } from "@/lib/i18n/en";
import { t } from "@/lib/i18n/language";

/** The next step's button words in the member's language (F260q); STATUSES keeps the English. */
const stepAction = (key: string): string => t(`trk.act.${key}` as MsgKey);

// Lazy-load the Leaflet tracking map so the ~45KB Leaflet bundle is only
// pulled in when a tracking card between On the way and Done is visible.
const TrackingMap = lazy(() =>
  import("@/components/TrackingMap").then((m) => ({ default: m.TrackingMap }))
);

/**
 * The open job tracker's view (Q806, 2026-11-05: moved verbatim out of JobTracking.tsx, DOM unchanged). Every value
 * it reads comes from JobTracking's model; it owns no state and no handlers (updateStatus stays in JobTracking).
 */
export function JobTrackingView(m: JobTrackingModel) {
  const {
    _isOwner,
    arrivalEvidence,
    arrivalOnMap,
    arrivalRefusal,
    confirmDoneOpen,
    continueDayNote,
    continueDayPhotoNote,
    currentArrivalEvidence,
    currentArrivalState,
    currentStatusIdx,
    displayIdx,
    displaySteps,
    doneFloorActive,
    embedded,
    helperConfirmedAt,
    helperDayofConfirmedAt,
    helperHasConfirmed,
    helperId,
    helperName,
    inStepRow,
    isHelper,
    jobDateNeeded,
    jobId,
    jobLatitude,
    jobLongitude,
    jobStamps,
    jobStartTime,
    jobStatus,
    mapShown,
    posterConfirmedAt,
    posterConfirmedWorkingAt,
    posterName,
    progressCard,
    proofAfterUrls,
    proofBeforeUrls,
    requirePhotoProof,
    rescheduled,
    setConfirmDoneOpen,
    settledArrivalLabel,
    tracking,
    trackingSettled,
    updateStatus,
    updating,
  } = m;
  return (
    // p-3 / space-y-2, and NO visible heading (owner: "drop the Job tracking
    // heading", 2026-08-24) — the step row is self-evidently a tracker, and
    // the serif heading + name row was ~50px of every card. The heading stays
    // for screen readers (a landmark region with steps but no name announces
    // as loose fragments); the helper's NAME moved down to the freshness
    // stamp, which is the line that describes their last ping anyway.
    <div className={embedded ? "space-y-2" : "rounded-2xl liquid-glass p-3 space-y-2"}>
      <h3 className="sr-only">Job tracking</h3>
      {/* NO SOS PILL HERE (owner: "remove globally") — it lives in the action
          row with every other control, on both sides of the job. */}
      {/* Progress timeline */}
      {/* THE ONE TRACKER (owner, 2026-10-21: "we need 1 tracker"). The 8-icon stepper (Posted · Offered ·
          Accepted · Confirmed · On the way · Arrived · Working · Done) is gone: the same four segments and
          next line as chat and the job page (jobProgress, src/components/tracker/jobProgressState.ts). The sub-steps live in
          the line ("Yusef is on the way"), and this card's controls below are unchanged. */}
      <JobProgress
        progress={jobProgress(
          {
            id: jobId, status: jobStatus ?? null, helper_id: helperId, date_needed: jobDateNeeded, start_time: jobStartTime ?? null,
            helper_confirmed_at: helperConfirmedAt, helper_dayof_confirmed_at: helperDayofConfirmedAt, poster_confirmed_at: posterConfirmedAt,
            helper_on_the_way_at: jobStamps.onTheWayAt ?? (tracking?.status === "on_the_way" ? tracking.updated_at : null),
            helper_arrived_at: jobStamps.arrivedAt, helper_arrival_verified_at: jobStamps.arrivalVerifiedAt,
            poster_confirmed_arrival_at: jobStamps.posterConfirmedArrivalAt, poster_confirmed_working_at: posterConfirmedWorkingAt,
            helper_completed_at: jobStamps.helperCompletedAt, poster_completed_at: jobStamps.posterCompletedAt,
            // The open card reads the same Helpr line and button as its collapsed face (photo rule, tracking row).
            require_photo_proof: requirePhotoProof, proof_before_urls: proofBeforeUrls, proof_after_urls: proofAfterUrls,
          },
          { viewer: _isOwner ? "poster" : "helpr", otherFirst: ((_isOwner ? helperName : posterName) ?? "").trim().split(/\s+/)[0] || null, rescheduled, workUnderway: currentStatusIdx >= STATUS_IDX.working, tracking, card: progressCard },
        )}
      />


      <TrackingStatusLine
        tracking={tracking}
        currentArrivalState={currentArrivalState}
        jobLatitude={jobLatitude}
        jobLongitude={jobLongitude}
        arrivalOnMap={arrivalOnMap}
        jobStamps={jobStamps}
        settledArrivalLabel={settledArrivalLabel}
        displaySteps={displaySteps}
        displayIdx={displayIdx}
      />

      {/* THE OTHER PARTY IS NO LONGER DRAWN HERE. It sat between the rail and
          the map for three days (owner, 2026-09-16) and the owner has moved it
          again, to directly above the action row (2026-09-19). See the note
          where the `personTile` prop used to be declared. */}

      {/* Tracking map — KEPT UNTIL DONE (owner, 2026-09-14: "Keep map until
          done"; was en-route only). Shown from On the way through Arrived and
          Working while both positions are known (`shouldShowTrackingMap`),
          for the Helpr and the poster alike, and hidden once the job is
          marked done. Past On the way the helper pin is the last ping on the
          tracking row — the map draws it, it does not start or extend any
          location watch. Lazy-loaded so the Leaflet chunk isn't paid for by
          cards that never enter these steps. Falls back to the status line
          when coordinates are unavailable. A settled arrival rides on its job
          pin (VN-20); the status line above drops that clause while it does. */}
      {mapShown && tracking && jobLatitude != null && jobLongitude != null && (
          <Suspense fallback={null}>
            <TrackingMap
              helperLat={tracking.latitude!}
              helperLng={tracking.longitude!}
              destLat={jobLatitude}
              destLng={jobLongitude}
              destinationLabel={arrivalOnMap ? settledArrivalLabel : null}
              helperLive={tracking.status === "on_the_way"}
            />
          </Suspense>
        )}


      {/* Helper controls — skip the job_confirmed step since that's handled by JobConfirmation */}
      {isHelper && (() => {
        // The job's DAY and the job's START are both resolved in the JOB's
        // timezone, never the viewer's. A 2026-09-06 end-to-end review viewing
        // from Pacific found this whole block two hours out on a 6:30 PM
        // Central job: the countdown, the "Actions unlock at" string, and the
        // gate that actually enables the button. See jobStartDateTime.
        const jobDayMs = jobDateMs(jobDateNeeded);
        const jobDay: Date | null = jobDayMs === null ? null : new Date(jobDayMs);
        const todayStartMs = todayMs();
        const startAt = jobStartDateTime(jobDateNeeded, jobStartTime);

        // Find next actionable status (skip job_confirmed — handled by JobConfirmation component)
        let nextIdx = currentStatusIdx + 1;
        if (
          nextIdx < STATUSES.length &&
          STATUSES[nextIdx].key === "job_confirmed" &&
          // Once the HELPER has confirmed, skip to on_the_way — that is all
          // helper_mark_on_the_way asks for (see `helperHasConfirmed`).
          // Otherwise stay here: the confirmation the line below points at is
          // theirs to give, so the instruction is actionable.
          helperHasConfirmed
        ) {
          nextIdx++;
        }

        const nextStatus = STATUSES[nextIdx];
        if (!nextStatus) return null;

        /* THE SERVER'S ON-THE-WAY FLOOR, ENFORCED BY NAME — NOT BY POSITION.
         *
         * `helper_mark_on_the_way` has exactly one content predicate:
         * `v_job.helper_confirmed_at IS NULL` → `helper_not_confirmed`
         * (read live off prod, 2026-09-19; pinned by
         * src/test/jobsGuardRpcParity.test.ts). So "I'm on my way" must never
         * be offered without that stamp.
         *
         * This check used to live INSIDE the `job_confirmed` skip above, which
         * made it positional: it only ran when the rail happened to sit one
         * step short of Confirmed. Prod job bb2c3732 walked straight past it —
         * `deriveCurrentStatusIdx` floored an `in_progress` job at Confirmed on
         * the STATUS alone, so `nextIdx` was already `on_the_way` and the gate
         * was never consulted. The derivation is fixed above; this is the half
         * that makes the gate impossible to skip again, whatever a future
         * derivation does: it keys on the STEP THE BUTTON WOULD TAKE, which is
         * the same thing the server keys on.
         *
         * Scoped to exactly what the server refuses, and no wider (`arrived`,
         * `working` and `done` have their own gates and do NOT read this
         * stamp): the standing rule on this card is that the client is the same
         * rule as the server, never stricter — a poster or a data gap must not
         * be able to trap a helper on a step the server would have allowed.
         */
        if (!helperHasConfirmed && (nextStatus.key === "job_confirmed" || nextStatus.key === "on_the_way")) {
          /* "Confirm the job below" is only true once there IS something
             below. JobConfirmation opens 24 hours out; before that it used
             to render nothing, so this line pointed at an empty space.
             JobConfirmation now shows its own "opens in …" card in that
             window, and this line matches it rather than contradicting it. */
          // The SAME instant the control below turns on: midnight the day before
          // (confirmOpensMs, Q1647). It measured 24h before the START, so a 10 AM
          // job's button was live from midnight while this line was silent.
          const confirmOpen =
            !jobDateNeeded || jobDayMs === null || Date.now() >= confirmOpensMs(jobDateNeeded);
          /* Silent before the window opens: JobConfirmation renders its own
             "Confirmation opens in …" strip directly below in that state and
             says the same thing with a clock attached. Two sentences saying
             "you'll confirm later", stacked, is the duplication this card
             keeps being audited for. */
          if (!confirmOpen) return null;
          return (
            <div className="pt-2 border-t border-border">
              <p className="text-ds-11 text-muted-foreground text-center">
                Confirm the job below to unlock the next step
              </p>
            </div>
          );
        }

        // While a revision is open, the revision flow OWNS completion (the
        // card's "Mark fixed" → poster accepts). The tracker caps its index
        // at Working in this state, which made its next-step button "Done" —
        // so the card offered Done, "I'll Fix It" and "Mark fixed" at once,
        // three CTAs for one decision. Hide the tracker's Done here.
        //
        // `disputed` is in the same list for the same mechanical reason and a
        // sharper one. The clamp above now caps a disputed job at Working too,
        // which makes its next step "Done" — and Done here is not a label, it
        // is `completeJob`: it REQUESTS THE PAYOUT. Offering that on a job
        // whose card says "nothing is charged or released until then" would
        // hand the helper a money button while an admin holds the money. The
        // completion for a disputed job comes out of the dispute's resolution,
        // never out of this rail.
        if (
          nextStatus.key === "done" &&
          (jobStatus === "revision_requested" || jobStatus === "disputed")
        ) {
          return null;
        }

        // Locked until TWO HOURS BEFORE the start time, not just until
        // midnight of the job day (owner, 2026-08-24 transition audit): the
        // old gate let a helper tap "On the way" at 7 AM for an 8 PM job,
        // starting the tracker half a day early and making the poster's
        // "they're on the way" signal meaningless. A job with no start_time
        // falls back to the old day gate — with nothing to measure against,
        // day-of is the honest window.
        const UNLOCK_BEFORE_MS = 2 * 3_600_000;
        // `startAt` falls back to midnight in the job's zone when there is no
        // start_time, so the two-hour rule would unlock a flexible job at 10 PM
        // the night before. Only gate on it when a start time actually exists;
        // otherwise the day gate is the honest window.
        const isLocked = jobStartTime && startAt
          ? Date.now() < startAt.getTime() - UNLOCK_BEFORE_MS
          : jobDayMs !== null
            ? todayStartMs < jobDayMs
            : false;
        const lockMessage = isLocked
          ? jobStartTime && startAt
            ? (() => {
                // Date-stamp the UNLOCK moment, not the job's day — for an
                // early-morning start the 2h-before unlock lands on the
                // PREVIOUS calendar day (a 12:00 AM Aug 29 job unlocks
                // 10:00 PM Aug 28; the old string said "on Aug 29").
                const unlockAt = new Date(startAt.getTime() - UNLOCK_BEFORE_MS);
                // Rendered in the JOB's zone. Printing this instant with the
                // viewer's default zone would name an hour the helper will not
                // see on the clock at the job, which is the same defect one
                // layer up in the sentence rather than the gate.
                const zoned = { timeZone: JOB_TIMEZONE } as const;
                const unlockDayStr = unlockAt.toLocaleDateString("en-CA", zoned);
                const unlockDayMs = jobDateMs(unlockDayStr);
                const dateSuffix =
                  unlockDayMs !== null && todayStartMs < unlockDayMs
                    ? ` on ${formatShortDate(new Date(unlockDayMs))}`
                    : "";
                return `This button turns on at ${unlockAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zoned })}${dateSuffix}`;
              })()
            : `This button turns on ${formatShortDate(jobDay!)}`
          : null;

        const isDoneStep = nextStatus.key === "done";

        // ARRIVAL HAS TO BE ESTABLISHED BEFORE THE RAIL LEAVES "ARRIVED".
        //
        // The owner's report: "It let me keep going to working even though I'm
        // nowhere near the job. The poster never even confirmed I was there."
        // They were right — there was no gate of any kind on Arrived → Working:
        // * client — this CTA was disabled only on `updating || isLocked`;
        // * server — `working` writes nothing but `job_tracking.status`, and
        //   job_tracking's only policy is `auth.uid() = helper_id`
        //   (20260311041556). No trigger, no transition matrix, no proximity.
        //   `enforce_job_status_transition` (20260828020000) governs
        //   `jobs.status` only, and accepted → in_progress is allowed outright.
        // So the ONLY arrival gate in the system sat on completion
        // (`enforce_helper_completion_gates`), and the two steps in between
        // were free. A helper 1792 miles away walked the rail to Done.
        //
        // ONE RULE, NOT A SECOND ONE: `arrivalEstablished` — the same predicate
        // the payout CTA, `completeJob`, create-payment and the DB triggers use.
        //
        // AND IT IS THE POSTER'S TAP, IN EVERY CASE (owner, 2026-09-19 —
        // supersedes VN-33's "verified AND confirmed"). A GPS-verified arrival
        // does NOT open this door; a Location-off arrival does not close it.
        // `helper_arrival_verified_at` is read nowhere in this gate on purpose.
        // The job_tracking trigger (`enforce_job_tracking_arrival_gate`) refuses
        // the Working step on the server under the same one-stamp rule, so this
        // is the explanation, not the only lock. The poster's tap lands back
        // here over the `jobs` realtime subscription above, so the button
        // re-enables itself while the helper is looking at it.
        //
        // THIS LINE IS ALSO THE ANTI-CHEAT NOTICE. Owner: "they shoud be aware
        // of this so they dont try to cheat the system" — every branch of
        // `arrivalGateMessage` names "Confirm they've arrived" and whose tap it is,
        // and the Helpr reads it the moment they reach the Arrived step, before
        // they have any reason to try walking the rail on their own. (The
        // separate "Awaiting confirmation" caption under the Arrived step is NOT
        // coming back: owner item 12, 2026-09-16, removed it deliberately and
        // the amber step colour carries that signal now — `arrivalStateLabel`.)
        const needsArrival =
          (nextStatus.key === "working" || isDoneStep) && !arrivalEstablished(arrivalEvidence);
        // Same rule, same message source, but say which door is locked: the
        // helper blocked at Working is being told they can't start work, not
        // that they can't get paid.
        const arrivalBlockReason = !needsArrival
          ? null
          : arrivalGateMessage(arrivalEvidence, isDoneStep ? "wrap-up" : "tracker");
        /* CHECKED IN, BUT THE SERVER NEVER PUT THEM AT THE JOB.
         *
         * The state the GPS encouragement and the "Try my location again"
         * button both belong to, defined ONCE so the sentence and the control
         * it names can never appear without each other.
         *
         * It reads the EVIDENCE STATE, not an error: since 20260919155016 an
         * unverified arrival is an ORDINARY, expected row (Location off, no
         * fix, a wrong map pin) rather than a failure. The previous gate's
         * `&& !nearMissAt` exclusion is dropped — a near miss is precisely the
         * case where a second, better fix changes something — and `"confirmed"`
         * is excluded, which is the "don't nag" half of the owner's ruling: once
         * the poster has vouched, the Helpr is unblocked and the arrival is
         * settled by the one attestation that actually decides it, so there is
         * nothing left to encourage them towards.
         */
        const gpsNudgeHere =
          isHelper && (currentArrivalEvidence === "claimed" || currentArrivalEvidence === "near_miss");
        // LEGACY (pre-20260919155016 RPC only): the tap was refused outright and
        // nothing was written, so the line says why and the button becomes the
        // retry. Cleared the moment an arrival is recorded.
        const arrivalRefusedHere = nextStatus.key === "arrived" && arrivalRefusal != null;
        const arrivalRefusalReason = arrivalRefusal && nextStatus.key === "arrived" ? arrivalRefusalMessage(arrivalRefusal) : null;

        // The button is disabled for two different reasons and only ever
        // explained one of them. `isLocked` had a sentence under it; `updating`
        // had nothing — so the CTA went dead and silent for the length of a
        // geolocation fix plus two or three round-trips (measured at ~12s on a
        // bad connection) with no clue why. Same line, same voice, both
        // reasons — and now the arrival gate too, which must never be a silent
        // dead button: every branch of `arrivalBlockReason` names the poster's
        // "Confirm they've arrived" tap, which is the way out.
        // The proof-photo gate, at RENDER time rather than only on click.
        // A state sweep found the two money controls disagreeing in 17 frames:
        // this CTA rendered an ENABLED "Request My Payout" (now "Mark it done") while
        // ActiveJobSection's button sat directly below it, DISABLED, reading
        // "Upload before & after photos first". Both enforce the same rule —
        // the comment on the click-time gate below says the two "must not
        // disagree again" — but this one enforced it by failing on tap and
        // showing a toast. So the control that LOOKED pressable was the one
        // that didn't work, which is the worse half of the pair to get wrong.
        const needsProof =
          isDoneStep &&
          proofBeforeUrls !== undefined &&
          !hasRequiredProof({ require_photo_proof: requirePhotoProof ?? true }, proofBeforeUrls, proofAfterUrls);

        /* THE BEFORE PHOTO GATES "START WORKING" (owner, 2026-09-19: "if a
         * before photo is required they can't press the working button until
         * its done and same for a completed job for an after photo").
         *
         * THE SERVER IS THE ORACLE, AND IT SAYS SO SINCE 20260919195158:
         * `enforce_job_tracking_arrival_gate()` raises
         * `tracker_requires_before_photo` on `status = 'working'` under exactly
         * this predicate. This block came in the same commit as that migration
         * and must never lead it — a client stricter than the database is the
         * class that produced the bad-GPS deadlock removed earlier the same day.
         *
         * ONLY the BEFORE photo, and only to START. The after photo is what
         * `needsProof` above gates, on the Done step, where the work exists to
         * photograph.
         *
         * `requiredProof().before` rather than a second reading of the flag —
         * the policy module is the one definition, and the migration's SQL is
         * a stated mirror of it. `proofBeforeUrls !== undefined` for the same
         * reason `needsProof` has it: an unloaded gate query must not disable
         * the button on a job that needs no photo at all.
         */
        // Greyed for the first 30 minutes (useDoneFloor); PayoutUnlockNote says when.
        const doneTooEarly = isDoneStep && doneFloorActive;
        const doneBeforeContinueDay = isDoneStep && !!continueDayNote;
        // Owner 11-08: on the new day, Mark it done waits for an after photo from that day (the server's
        // the server marks a done without one for the poster to check, 20261108160000); the photo chip beside it asks for one.
        const doneNeedsNewDayPhoto = isDoneStep && !!continueDayPhotoNote;

        const needsBeforePhoto =
          nextStatus.key === "working" &&
          proofBeforeUrls !== undefined &&
          requiredProof({ require_photo_proof: requirePhotoProof ?? true }).before &&
          (proofBeforeUrls?.length ?? 0) === 0;

        const disabledReason = updating
          ? "Saving your update — one moment…"
          : isLocked
            ? lockMessage
            : arrivalBlockReason
              ?? arrivalRefusalReason
              // AFTER the arrival reason, matching the server's branch order:
              // the poster's tap is the earlier event and the bigger blocker,
              // and a Helpr who is not yet confirmed on site has nothing to
              // photograph "as it was when you got there" anyway.
              ?? (needsBeforePhoto ? BEFORE_PHOTO_GATE_REASON : null)
              ?? (needsProof ? requiredProof({ require_photo_proof: requirePhotoProof ?? true }).reason : null)
              ?? (doneBeforeContinueDay ? continueDayNote : null)
              ?? (doneNeedsNewDayPhoto ? continueDayPhotoNote : null);
        // Amber, like the arrival gate: both are the helper being told what
        // blocks the next step, not a neutral status. The before-photo gate is
        // amber for the same reason and not the muted grey of a wait — it is
        // something the Helpr must DO, and the chip that does it is in the same
        // row, one control to the left.
        const amberReason =
          (needsArrival || arrivalRefusedHere || needsBeforePhoto) && !updating && !isLocked;

        /* ── THE GPS NUDGE: EXPLAIN THE BENEFIT, DON'T BLOCK OR NAG ──────────
         *
         * OWNER, 2026-09-19: "so encourgage to turn on gps" — and, asked how
         * hard to push: explain the benefit, don't block or nag.
         *
         * TWO FRAMINGS WERE EXPLICITLY REJECTED and must not come back:
         *   - "unverified arrivals count against you" — to a Helpr standing in
         *     a metal warehouse with one bar, that is an accusation, not advice;
         *   - a prompt on every attempt. This is a QUIET LINE tied to the state
         *     of the row (checked in, no GPS confirmation yet), not a dialog, not
         *     a toast, and not something that reappears on each tap.
         *
         * It is MUTED, never the amber the blocked CTA wears: amber on this
         * card means "something is stopping you", and nothing here is. The one
         * thing stopping them is the poster's tap, and `reasonEl` above says so.
         *
         * ONE TAP is the "Try my location again" button rendered directly below
         * it (`retryEl`), which re-runs the permission pre-prompt and the fix.
         * Same gate as that button, deliberately: a line about turning Location
         * on, with no control on screen, is worse than no line at all.
         *
         * ONE SENTENCE, AND ONLY THE BENEFIT (owner, 2026-09-19, final browser
         * gate: "amber says what is BLOCKING; muted says why GPS helps. Nothing
         * else"). It used to run three sentences and end by naming the button
         * directly beneath it — while the amber line above ALSO said "turn
         * Location on" and ALSO named "Try my location again". Ten lines of
         * prose between the photo box and the buttons, saying two things twice.
         * The instruction is gone (the button is right there, wearing the same
         * words) and the "gets you confirmed faster" clause is gone with it:
         * that is a nudge about the poster's behaviour, not a benefit we can
         * promise. What is left is the one thing Location actually buys them.
         */
        const gpsBenefitEl = gpsNudgeHere ? (
          <p className="text-ds-11 text-center text-muted-foreground">
            Turning Location on gives you GPS proof you were here, if this job is ever disputed.
          </p>
        ) : null;

        const reasonEl = disabledReason || gpsBenefitEl ? (
          <>
            {disabledReason ? (
              <p
                className={`text-ds-11 text-center${amberReason ? " font-semibold" : " text-muted-foreground"}`}
                style={amberReason ? { color: "hsl(var(--amber-ink))" } : undefined}
              >
                {disabledReason}
              </p>
            ) : null}
            {gpsBenefitEl}
          </>
        ) : null;

        /* THE ROW'S PRIMARY, drawn by the row's own primitive.
         *
         * It used to be a raw `<Button size="sm" className="w-full h-auto">`
         * with the icon inline and a bare 14px label, portalled into a row of
         * stacked 11px chips — "Message" and "I'm on my way" side by side as
         * two different kinds of object, which is the screenshot the owner sent
         * twice. `JobStepPrimaryButton` is that one object; nothing about the
         * gates, the busy state or the confirm dialog moves. */
        const runNext = () => { if (isDoneStep) setConfirmDoneOpen(true); else void updateStatus(nextStatus.key); };
        const ctaDisabled = updating || isLocked || needsArrival || needsBeforePhoto || needsProof || doneTooEarly || doneBeforeContinueDay || doneNeedsNewDayPhoto;
        // Boards 62/64: the face (or an after-photo upload, afterPhotosLeadToDone) asked for THIS step; a greyed draw keeps it.
        // AUD31-79: only once the tracking row has settled; a first draw from the job row alone dropped the request.
        if (trackingSettled && !ctaDisabled && takeHelperStepRequest(jobId, nextStatus.key)) queueMicrotask(runNext);
        const ctaEl = (
          <JobStepPrimaryButton
            icon={nextStatus.icon}
            // The ACTION, not the step's name — see STATUSES. After a
            // refused arrival the same tap is a retry, so it says so.
            label={arrivalRefusedHere ? t("trk.retryLocation") : nextStatus.action ? stepAction(nextStatus.key) : nextStatus.label}
            // Done asks first — see the dialog below. Every other step is a
            // reversible statement about where the helper is; this one moves
            // money and cannot be taken back from here.
            onClick={runNext}
            // SAME OBJECT, SAME DISABLED STATE (jobRowControlSameness). The
            // before-photo gate adds a reason, not a new kind of control: a
            // control that LOOKED pressable and then failed on tap with a toast
            // is the shape the comment above `needsProof` records as the worse
            // half to get wrong, and it is not coming back for this gate.
            disabled={ctaDisabled}
          />
        );


        const doneDialog = (
          <>
            {/* THE ONE TAP THAT MOVES MONEY GETS A CONFIRMATION.
                The poster's mirror of this decision opens CompletionChoiceSheet
                and walks them through it; the helper's requested the payout on
                a single tap of a button that just said "Done". Shared shell
                (BrandConfirmDialog → DialogHero → the glass modal every
                other popup in the app wears), so this is one more confirm and
                not a new kind of thing. */}
            {isDoneStep && (
              <BrandConfirmDialog
                open={confirmDoneOpen}
                onOpenChange={(next) => { if (!updating) setConfirmDoneOpen(next); }}
                title="Mark this job complete?"
                description="This tells the person who posted this job the work is finished, so they can approve it."
                primaryLabel="Mark it done"
                primaryTone="bark"
                primaryDisabled={updating}
                onPrimary={(e) => {
                  e.preventDefault();
                  setConfirmDoneOpen(false);
                  void updateStatus("done");
                }}
                secondaryLabel="Cancel"
              >
                <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood))" }}>
                  The person who posted this job approves the work or asks for a change. If they haven’t answered in {APPROVAL_WINDOW_HOURS} hours, Helpr support steps in. Your payment stays held safely until the job is approved. You can’t take this back from here.
                </p>
              </BrandConfirmDialog>
            )}
          </>
        );

        // ONE ROW (owner, 2026-09-14, VN-21). Inside a job step card this CTA
        // IS the card's primary: it portals into the card's single action row
        // (the step's own `primary` then stands down), its reason sits on the
        // line directly above that row, and the dialog stays here. State, gates
        // and handlers are untouched — only the DOM position moves.
        // PHOTO FIRST (owner, 2026-10-08): an owed photo IS the primary (HelperPhotoAsk).
        const photoIsPrimary = needsBeforePhoto || needsProof;
        if (inStepRow) {
          return (
            <>
              {photoIsPrimary ? null : <JobStepRowSlot slot="note">{reasonEl}</JobStepRowSlot>}
              {/* ONE control in this slot (the retry chip went 2026-09-19; the
                  refresh gesture does it, src/lib/arrivalRefresh.ts). `primaryNeeds`
                  still takes an ARRAY: the day-of confirmation can add one here. */}
              {photoIsPrimary ? null : <JobStepRowSlot slot="primary">{ctaEl}</JobStepRowSlot>}
              {doneDialog}
            </>
          );
        }

        return (
          <div className="pt-2 border-t border-border space-y-2">
            {reasonEl}
            {ctaEl}
            {doneDialog}
          </div>
        );
      })()}

    </div>
  );
}
