import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import type { MouseEvent as ReactMouseEvent, CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { COPY_AUTO_RELEASE_HOURS } from "../../supabase/functions/_shared/escrowTiming";
import { haversineMiles } from "@/lib/geo";
import { MapPin, Clock, CheckCircle2, Truck, Wrench, PartyPopper, CalendarCheck, FileText, AlertTriangle, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { jobStartDateTime } from "@/lib/dateUtils";
import { jobDateMs, todayMs, JOB_TIMEZONE } from "@/lib/jobDate";
import { formatShortDate } from "@/lib/format";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { arrivalEstablished, arrivalEvidenceState, arrivalGateMessage, arrivalMapLabel, arrivalRefusalFromError, arrivalRefusalMessage, arrivalState, arrivalStateLabel, arrivalVerdictFromRpc, arrivalVerdictMessage, type ArrivalRefusal, type ArrivalState, type ArrivalVerdict } from "@/lib/arrivalGate";
import { report } from "@/lib/errorLogger";
import { BEFORE_PHOTO_GATE_REASON, lifecycleErrorMessage, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { isNativePlatform } from "@/lib/nativeInit";
import { railStepPaint } from "@/components/activity/jobRailTone";
import { startEnRouteWatch, type EnRouteMode } from "@/lib/enRouteLocation";
import { JobStepRowSlot, useInJobStepRow } from "@/components/activity/jobStepRow";
/* `JobActionChip` was imported here for the "Try My Location Again" chip
   only; that control is gone (owner, 2026-09-19) and this component draws no
   chips of its own again — just its one primary. */
import { JobStepPrimaryButton } from "@/components/activity/JobActionRow";

// Lazy-load the Leaflet tracking map so the ~45KB Leaflet bundle is only
// pulled in when a tracking card between On the Way and Done is visible.
const TrackingMap = lazy(() =>
  import("@/components/TrackingMap").then((m) => ({ default: m.TrackingMap }))
);

/**
 * `label` names the STEP; `action` is what the button that reaches it SAYS.
 *
 * The next-step CTA used to render `label`, so it read "Accepted", "On the
 * Way", "Arrived", "Working", "Done" — the same five nouns the completed steps
 * directly above it already display. Nothing told the reader the button did
 * anything, and "Done" is the money-critical one: it requests the payout.
 *
 * The labels are kept SHORT on purpose. `button.tsx` sets `whitespace-nowrap`,
 * so a label that outgrows its box spills instead of wrapping. On a 320px
 * phone this button has roughly 170px of text room (card px-4, tracker p-3,
 * size="sm" px-4, an 18px icon and its gap), which is ~20 characters of the
 * 14px bold sans it renders in. The Done action reads "Mark Job Complete"
 * (owner, 2026-09-14: name the event, not the money) — the same words as the
 * card's PayoutPrimary button, so the two controls for one action agree.
 *
 * Both step arrays are annotated with this ONE type so `displaySteps`
 * (`[...PRE_STATUSES, ...STATUSES]`) stays a single array type rather than a
 * union of two shapes the `.map` below would have to reconcile.
 */
type TrackerStep = {
  key: string;
  label: string;
  /** Action phrasing for the next-step CTA; `null` where the step is never a
   *  button target. */
  action: string | null;
  icon: LucideIcon;
  color: string;
};

/** The step LABELS, in order, for a surface that draws the rail without
 *  mounting this component — the collapsed card's compact rail
 *  (JobStepRailCompact). Exported as labels rather than the whole array so the
 *  icons and the action phrasing stay private to the full rail. */
export function railStepLabels(includePostingSteps: boolean): string[] {
  return (includePostingSteps ? [...PRE_STATUSES, ...STATUSES] : STATUSES).map((s) => s.label);
}

/** Where the compact rail's cursor sits, given the same inputs the full rail
 *  derives from. One definition of the `includePostingSteps` offset, so the
 *  two rails cannot disagree about which step a job is on. */
export function railDisplayIdx({
  currentStatusIdx,
  includePostingSteps,
  helperId,
}: {
  currentStatusIdx: number;
  includePostingSteps: boolean;
  helperId: string | null | undefined;
}): number {
  if (!includePostingSteps) return currentStatusIdx;
  return helperId ? PRE_STATUSES.length + currentStatusIdx : 0;
}

const STATUSES: TrackerStep[] = [
  // Step 0 is never the TARGET of the next-step button (nextIdx is always
  // currentStatusIdx + 1 ≥ 1), so it has no action phrasing.
  { key: "assigned", label: "Offered", action: null, icon: Clock, color: "text-muted-foreground" },
  { key: "confirmed", label: "Accepted", action: "I've Accepted", icon: CheckCircle2, color: "text-primary" },
  // CalendarCheck, not ShieldCheck: at the 16px the step row draws these at,
  // a shield-with-a-tick and the circle-with-a-tick above it were two dark
  // rings with a check in them and read as the same step twice. This one means
  // "both sides confirmed, the date is locked", which a calendar says plainly
  // and cannot be confused with "Accepted".
  { key: "job_confirmed", label: "Confirmed", action: "Confirm This Job", icon: CalendarCheck, color: "text-primary" },
  { key: "on_the_way", label: "On the Way", action: "I'm On My Way", icon: Truck, color: "text-primary" },
  { key: "arrived", label: "Arrived", action: "I've Arrived", icon: MapPin, color: "text-primary" },
  { key: "working", label: "Working", action: "Start Working", icon: Wrench, color: "text-primary" },
  { key: "done", label: "Done", action: "Mark Job Complete", icon: PartyPopper, color: "text-primary" },
];

/**
 * What each completed transition tells the helper, and (because these events
 * are the poster's only signal that anything happened) what it tells them the
 * POSTER now knows. Every transition used to fire haptics and nothing else —
 * on web, where there are no haptics, a successful tap produced no feedback of
 * any kind. `arrived` has no entry: that path speaks for itself, through the
 * RPC's own verdict (`arrivalVerdictMessage`) — the one message that knows
 * whether the location confirmed anything, and the one that has to name the
 * poster's tap as what comes next. A generic line here would talk over it.
 */
const TRANSITION_TOAST: Record<string, string> = {
  confirmed: "You're marked as accepted.",
  on_the_way: "The person who posted this job knows you're on the way.",
  working: "The person who posted this job knows work has started.",
  // Interpolated, never restated as a literal — see escrowTiming.ts and the
  // copy-parity guard in src/lib/escrowTiming.copyParity.test.ts.
  done: `Payout requested. The person who posted this job has ${COPY_AUTO_RELEASE_HOURS} hours to approve before your payment releases automatically.`,
};

/**
 * The two steps that happen BEFORE anyone is offered the job. A poster's own
 * card starts life at "Posted" with nobody assigned, so without these the
 * tracker had nothing to say until a helper had already been picked — which is
 * why an open job showed no tracker at all. They are PREPENDED (never
 * substituted) so a job that advances keeps one continuous timeline, and they
 * reuse the exact step shape/styling of `STATUSES` rather than introducing a
 * second tracker.
 */
/**
 * ONE pre-assignment step, not two (owner: "I think posted and applicants can
 * be merged").
 *
 * They were never two things that happen in sequence — a job is posted, and
 * applications arrive against that same posted job — so the tracker spent two
 * of its nine columns on one state, and the count they conveyed is already on
 * the card. The step's icon and caption carry the difference now: a file with
 * no caption while nobody has applied, and the people icon with "N applied"
 * underneath once they have.
 */
const PRE_STATUSES: TrackerStep[] = [
  // Pre-assignment, so never a helper button target — hence `action: null`.
  { key: "posted", label: "Posted", action: null, icon: FileText, color: "text-primary" },
];

/** Index of each step in `STATUSES`, by key. Keeps the derivation below
    readable and stops a re-ordering of the array from silently changing
    what "on the way" means. */
export const STATUS_IDX = {
  assigned: 0,
  confirmed: 1,
  job_confirmed: 2,
  on_the_way: 3,
  arrived: 4,
  working: 5,
  done: 6,
} as const;

/** Everything the tracker can learn about how far along a job is. All
    optional: a caller that knows nothing still gets a sane step 0. */
export type JobProgressEvidence = {
  /** `status` from the latest `job_tracking` row, when one exists. */
  trackingStatus?: string | null;
  /** `jobs.status`. */
  jobStatus?: string | null;
  helperConfirmedAt?: string | null;
  /** Day-before re-confirmation stamp (migration 20260824213000); see the
   *  gate below for how it composes with the accept-time stamp. */
  helperDayofConfirmedAt?: string | null;
  /** Job date (YYYY-MM-DD) — lets the mutual gate honour an accept that
   *  itself happened inside the 24h window. Optional; absent = lenient. */
  jobDateNeeded?: string;
  /** `jobs.start_time` ("HH:MM:SS"). Lets the day-of grace window measure from
   *  the job's real START in the job's zone — the same instant JobConfirmation
   *  opens against — rather than from midnight in the reader's zone. Optional;
   *  absent = midnight, which is the lenient direction. */
  jobStartTime?: string | null;
  posterConfirmedAt?: string | null;
  helperOnTheWayAt?: string | null;
  helperArrivedAt?: string | null;
  /** The two-party arrival evidence (`src/lib/arrivalGate.ts`). Optional, but
   *  without them a bare CLAIM is the only thing the working-inference below
   *  can see — which is how the rail ran ahead of the arrival it was drawn
   *  from. See the inference for why they are load-bearing. */
  helperArrivalVerifiedAt?: string | null;
  posterConfirmedArrivalAt?: string | null;
  /** VN-33(b) near miss — counts for the working inference only beside the poster's confirmation. */
  helperArrivalNearMissAt?: string | null;
  helperCompletedAt?: string | null;
  posterCompletedAt?: string | null;
};

/**
 * Which step of `STATUSES` a job is actually on.
 *
 * This used to read the `job_tracking` row FIRST and, if there wasn't one,
 * fall all the way back to 0 — so a job whose helper had finished and whose
 * poster was staring at "Approve & release payment" rendered as "Offered"
 * with the bar at 1/7. The jobs row already carried the truth (the
 * `helper_on_the_way_at` / `helper_arrived_at` / `helper_completed_at`
 * stamps); it just wasn't being read.
 *
 * So: score the job row for the FURTHEST milestone it can evidence, score the
 * tracking row, and take the max. A missing or stale tracking row can then
 * never drag the tracker backwards, while a live tracking row (the helper
 * tapping through the steps) still leads the way when it's ahead.
 */
export function deriveCurrentStatusIdx({
  trackingStatus,
  jobStatus,
  helperConfirmedAt,
  helperDayofConfirmedAt,
  jobDateNeeded,
  jobStartTime,
  posterConfirmedAt,
  helperOnTheWayAt,
  helperArrivedAt,
  helperArrivalVerifiedAt,
  posterConfirmedArrivalAt,
  helperArrivalNearMissAt,
  helperCompletedAt,
  posterCompletedAt,
}: JobProgressEvidence): number {
  // An unrecognised tracking status yields -1 from findIndex — treat that as
  // "no evidence" rather than letting it blank out the whole tracker.
  const trackingIdx = trackingStatus
    ? STATUSES.findIndex((s) => s.key === trackingStatus)
    : -1;

  let jobIdx = -1;
  const atLeast = (idx: number) => { if (idx > jobIdx) jobIdx = idx; };

  if (jobStatus === "accepted") atLeast(STATUS_IDX.assigned);
  // STATUS IS NOT A CONFIRMATION (owner, 2026-09-19).
  //
  // This used to read `in_progress`/`revision_requested` as evidence of at
  // least "Confirmed" (STATUS_IDX.job_confirmed), on the reasoning that a job
  // cannot BE in progress without having been confirmed. That reasoning was
  // wrong on the only rows it was written for. FOUND LIVE on prod job
  // bb2c3732: `in_progress` with `helper_confirmed_at`, `poster_confirmed_at`
  // AND `helper_dayof_confirmed_at` all NULL. The rail painted Confirmed
  // complete, the next-step CTA therefore became "I'm On My Way" — and
  // `helper_mark_on_the_way` refused the tap with `helper_not_confirmed`,
  // because its one predicate is `v_job.helper_confirmed_at IS NULL`
  // (verified live on prod, 2026-09-19, and pinned by
  // src/test/jobsGuardRpcParity.test.ts).
  //
  // That is the bad-GPS deadlock's class, one step earlier on the same rail: a
  // control offered for an action the server will refuse. The floor did not
  // just mislabel a step, it SKIPPED THE GATE — the helper's-confirmation
  // check below lives on the `job_confirmed` branch of the next-step CTA, and
  // a rail already sitting at `job_confirmed` never reaches that branch.
  //
  // So the Confirmed step is derived from the STAMPS and nothing else (the
  // mutual day-of rule a dozen lines down). What `in_progress` still evidences
  // is that somebody was assigned and the job is underway — the Offered step,
  // which is also the rail's floor. An in-progress job with no confirmation
  // stamp at all now reads "Offered", and that is not the old lie in a new
  // place: it is the honest rendering of a row that evidences no confirmation.
  // (Every such row on prod today is `is_seed = true` — see the report in the
  // handoff; no organic job has ever reached this state.)
  if (jobStatus === "in_progress" || jobStatus === "revision_requested") {
    atLeast(STATUS_IDX.assigned);
  }
  if (helperConfirmedAt || posterConfirmedAt) atLeast(STATUS_IDX.confirmed);
  // The MUTUAL step wants the helper's DAY-BEFORE stamp, not the accept-time
  // one — accepting a job five days out says nothing about the day itself
  // (2026-08-24 lifecycle review). An accept that itself happened inside the
  // 24h window counts (same grace as JobConfirmation), as does any row where
  // no job date is known to measure against.
  const helperAnsweredDayOf =
    !!helperDayofConfirmedAt ||
    (!!helperConfirmedAt &&
      (() => {
        // Measured against the job's real START in the JOB's zone. This used
        // to subtract an absolute timestamp from `parseLocalDate(...)`, which
        // is midnight in the VIEWER's zone — two operands in different frames,
        // so the grace window slid by the reader's UTC offset and by however
        // far the start time sits from midnight. "Same grace as
        // JobConfirmation" is asserted by the comment above; it is only true
        // if both measure from the same instant.
        const start = jobStartDateTime(jobDateNeeded, jobStartTime);
        return !start || start.getTime() - new Date(helperConfirmedAt).getTime() <= 24 * 3_600_000;
      })());
  if (helperAnsweredDayOf && posterConfirmedAt) {
    atLeast(STATUS_IDX.job_confirmed);
  }
  if (helperOnTheWayAt) atLeast(STATUS_IDX.on_the_way);
  if (helperArrivedAt) {
    atLeast(STATUS_IDX.arrived);
    // Arrived + still `in_progress` almost certainly means on site and
    // working — there is no "started working" stamp on the jobs row. But
    // that is an INFERENCE, and applying it unconditionally would make the
    // Arrived step unreachable: the helper tapping Arrived also flips the job
    // to `in_progress`, so every arrival would skip straight to Working. So
    // it only fills a gap: when a tracking row exists it is the helper's own
    // statement of where they are, and it wins.
    //
    // AND THE INFERENCE NEEDS AN ESTABLISHED ARRIVAL, not a bare claim. A
    // claim alone flips the job to `in_progress` (mark_helper_arrival does the
    // accepted → in_progress transition in the same statement that decides
    // whether the arrival was verified), so `helperArrivedAt && in_progress`
    // was satisfied by the claim ITSELF — the inference was reading its own
    // side effect back as corroboration and painting Working off a helper who
    // was 1792 miles away. With an established arrival — since the owner's
    // 2026-09-19 reversal that is the POSTER'S CONFIRMATION, on its own and in
    // every case (`arrivalEstablished`, supabase/functions/_shared/arrivalRule.ts)
    // — it is a sound inference and stays; without, the rail stops at Arrived,
    // which is exactly what is known. VN-33's "verified AND confirmed" is gone:
    // GPS alone still paints Arrived, the poster's tap alone now paints Working
    // (JobTracking.test.tsx holds both halves).
    if (
      trackingIdx < 0 &&
      jobStatus === "in_progress" &&
      arrivalEstablished({
        helper_arrived_at: helperArrivedAt,
        helper_arrival_verified_at: helperArrivalVerifiedAt,
        poster_confirmed_arrival_at: posterConfirmedArrivalAt,
        helper_arrival_near_miss_at: helperArrivalNearMissAt,
      })
    ) {
      atLeast(STATUS_IDX.working);
    }
  }
  if (helperCompletedAt || posterCompletedAt || jobStatus === "completed") {
    atLeast(STATUS_IDX.done);
  }

  // Floor at 0: the tracker always shows at least "Offered".
  const idx = Math.max(0, trackingIdx, jobIdx);

  // A REVISION OR A DISPUTE UNDOES "Done".
  //
  // REVISION: `helper_completed_at` stays stamped when the poster sends the
  // work back, so the tracker sat on a fully-green Done — beside a card that
  // said "Revision requested" and an action row offering Approve or Dispute.
  // Owner: "all of these things can't be true at once." The work is back with
  // the helpr, which is what Working means, and the stamp is not cleared
  // because it is a record of what happened; the tracker just stops treating
  // it as the final word while the job is in revision.
  //
  // DISPUTE: the same stamp, the same lie, one state later. Owner: "Can't be
  // marked done if it's in revision is dispute." Their screenshot was a
  // disputed job whose rail read Confirmed → On the Way → Arrived → Working
  // (red) → DONE (green), sitting directly on top of a panel reading
  // "Escalated to Admin … nothing is charged or released until then". Done on
  // this rail is not "the helpr pressed a button"; it is the completion that
  // releases the money, and under an open dispute a human has not yet decided
  // whether that completion stands. So the rail must not spend a green on it.
  //
  // Both clamp to Working — the step the job is genuinely stuck at. The work
  // was performed and is contested, which is exactly "Working": begun, not
  // accepted. Working is also where the alarm colour is pinned for a dispute
  // (`disputedStep` in the step row below), so the clamp and the colour rule
  // land on the SAME step — one red dot that is also the current step, no
  // second amber "current" elsewhere, and Done left inactive-grey rather than
  // green. It is deliberately a CEILING, not a floor: a dispute raised from
  // `accepted` (the state machine allows it — 20260825190000) still shows the
  // earlier step it really reached.
  //
  // This is a RENDER-TIME REFUSAL, not a rewrite. If `job_tracking.status`
  // carries a stale `done` from before the dispute, that row is left exactly
  // as it is — it is a true record of a tap that happened — and the clamp
  // simply stops it being the final word. Nothing here writes.
  if (jobStatus === "revision_requested" || jobStatus === "disputed") {
    return Math.min(idx, STATUS_IDX.working);
  }
  return idx;
}

/**
 * "GPS confirmed · 1792 mi from job" — the caption the owner screenshotted, one
 * line under a toast that said we could NOT confirm the arrival.
 *
 * The old string was gated on `tracking.latitude` — i.e. on having a position
 * fix AT ALL — and every one of its three branches opened with the word
 * "confirmed". A fix taken 1792 miles from the job site therefore rendered as
 * proof of arrival. That is not a wording slip: "confirmed" is the word this
 * app uses for evidence that unlocks a payout, and the caption was spending it
 * on a raw coordinate read.
 *
 * So the caption is now derived from the SAME `arrivalState()` the toast, the
 * completion gate and the DB trigger read (`src/lib/arrivalGate.ts`) — they
 * cannot disagree again, because there is only one input:
 *
 *   confirmed — the poster vouched. A second party attesting.
 *   verified  — the server itself computed the helper within 500ft.
 *   claimed   — the helper says so and nothing corroborates it. This is the
 *               state in the screenshot, and it now READS as the open question
 *               it is, in amber, with the recourse on the step rail beside it.
 *   none      — no arrival claimed yet. A distance is still useful here (it is
 *               "how far away are they"), but it proves nothing, so the line
 *               says "Location shared", never "confirmed".
 *
 * The distance is kept in every branch — it is the most useful fact on the line
 * — but it is stated as the LAST PING, which is what it is, and it never
 * carries the word "confirmed" on its own.
 *
 * WHEN THE MAP ALREADY SAYS IT (owner, 2026-09-14, VN-20: "Location confirmed
 * … should be on the map"). A settled arrival — verified or confirmed — is now
 * drawn as a label on the map's job pin. While that map is on screen, this
 * line saying "Arrival GPS-verified" / "Arrival confirmed by the person who posted it" a few pixels
 * above it is the same fact twice, so `arrivalShownOnMap` drops ONLY that
 * clause and keeps the location part ("Location shared · 3.2 mi from job").
 * With no map drawn (no coordinates, or past the en-route step) the clause
 * stays here — this line is then the only place the fact appears.
 */
export type TrackingProofCaption = {
  text: string;
  /** `warn` paints amber: the line is reporting a problem, not vouching. */
  tone: "ok" | "warn" | "muted";
};

/** Display twin of the server's 500ft verification radius (0.1 mi ≈ 528ft). */
const AT_JOB_MI = 0.1;

export function trackingProofCaption(
  state: ArrivalState,
  /** Miles between the last ping and the job, or `null` when either end has no
   *  coordinates to measure against. */
  distanceMi: number | null,
  /** Did the last tracking row carry a position at all? */
  hasPosition: boolean,
  /** Is the map rendering this arrival as a label on its job pin? See above. */
  arrivalShownOnMap = false,
): TrackingProofCaption {
  // NO "at the job" CLAUSE (owner, 2026-09-16: "remove the at the job text").
  // A ping inside the verification radius now says NOTHING about where — the
  // clause is dropped exactly as the no-distance branches already drop it, so
  // "Arrival GPS-verified · last ping at the job" reads "Arrival GPS-verified"
  // and no dangling "·" is left behind (every consumer below builds the
  // separator from `where`, never around it). The DISTANCE branch stays: the
  // owner named only the "at the job" phrasing, and "1792 mi from job" is the
  // headline fact this caption exists for.
  const where =
    !hasPosition || distanceMi == null || distanceMi < AT_JOB_MI
      ? null
      : `${distanceMi < 10 ? distanceMi.toFixed(1) : Math.round(distanceMi)} mi from job`;

  // No position at all. The absence is stated rather than left blank — a
  // self-reported arrival that rendered identically to a GPS-confirmed one
  // would be the app quietly overstating what it knows.
  if (!hasPosition) {
    switch (state) {
      case "confirmed":
        return { text: "Arrival confirmed by the person who posted it · no location shared", tone: "ok" };
      case "verified":
        return { text: "Arrival GPS-verified · no location shared", tone: "ok" };
      case "claimed":
        return { text: "Arrival not confirmed · no location shared", tone: "warn" };
      default:
        return { text: "Location not shared", tone: "muted" };
    }
  }

  const suffix = where ? ` · last ping ${where}` : "";
  // The map's job pin is carrying the verification clause; keep the location.
  if (arrivalShownOnMap && (state === "confirmed" || state === "verified")) {
    return { text: where ? `Location shared · ${where}` : "Location shared", tone: "ok" };
  }
  switch (state) {
    // The poster's vouch outranks GPS, so a long distance is not a
    // contradiction here — the person standing next to the helper said yes.
    // It is still shown, because hiding it would be the same sin in reverse.
    case "confirmed":
      return { text: `Arrival confirmed by the person who posted it${suffix}`, tone: "ok" };
    // Verified is a statement about the MOMENT OF ARRIVAL, not about where the
    // helper is now — stepping away from a site mid-job is normal and is the
    // exact false-positive the arrival gate was built to stop punishing.
    case "verified":
      return { text: `Arrival GPS-verified${suffix}`, tone: "ok" };
    // THE SCREENSHOT. Never "confirmed"; amber; and the distance is stated
    // plainly rather than dressed as proof — 1792 miles is the headline.
    case "claimed":
      return { text: `Arrival not confirmed${where ? ` · ${where}` : ""}`, tone: "warn" };
    default:
      return { text: where ? `Location shared · ${where}` : "Location shared", tone: "muted" };
  }
}

/**
 * The tracking-row steps the map is drawn on.
 *
 * KEEP THE MAP UNTIL DONE (owner, 2026-09-14, VN-20 pop-up: "Keep map until
 * done"). This reverses the map being en-route only ("this should show map
 * tracker when they're on the way"): it now stays from On the Way through
 * Arrived and Working, so the arrival label on its job pin is actually seen,
 * and hides once the job is marked done.
 */
const MAP_TRACKING_STATUSES = new Set(["on_the_way", "arrived", "working"]);

/**
 * THE CONTESTED SET (owner, 2026-09-16: "the tracker shoudl not go away for a
 * dispute ir revisio").
 *
 * A job in `revision_requested` or `disputed` has already been submitted, so
 * its tracking row carries `done` — which is why keeping the map for those two
 * statuses needs BOTH halves: `markedDone` has to stop hiding it, and `done`
 * has to be an allowed tracking status. With only the first half the map
 * stayed hidden and the fix would have measured as a no-op.
 *
 * Deliberately NOT a change to the plain path: a normally-completed job still
 * loses its map on the same terms as before.
 */
const CONTESTED_MAP_TRACKING_STATUSES = new Set([...MAP_TRACKING_STATUSES, "done"]);

/**
 * Whether the map mounts. Shared by the render and by the arrival-label
 * placement (VN-20) so "the map shows the arrival" and "the map is on screen"
 * can never be two different answers.
 *
 * DRAWING THE MAP STARTS NO TRACKING. After On the Way the helper pin is the
 * last position already on the `job_tracking` row; the position watch
 * (`startEnRouteWatch`, the effect gated on `tracking.status === "on_the_way"`)
 * still stops at arrival exactly as before.
 *
 * `markedDone` hides it once completion is submitted or settled — the helper's
 * Done, the poster's approval, a completed job.
 *
 * EXCEPT WHEN THE WORK IS CONTESTED (`contested`, owner 2026-09-16: "the
 * tracker shoudl not go away for a dispute ir revisio"). This reverses the
 * earlier reading that a job sent back for revision or disputed after
 * submission should lose its map with every other done job. It should not: a
 * revision or a dispute is the one moment where where the Helpr actually WENT
 * is the evidence under discussion, and the rail is deliberately clamped to
 * Working for exactly the same reason. The map goes with it.
 */
export function shouldShowTrackingMap(
  tracking: Pick<TrackingData, "status" | "latitude" | "longitude"> | null | undefined,
  jobLatitude: number | null | undefined,
  jobLongitude: number | null | undefined,
  markedDone = false,
  /** `jobStatus` is `revision_requested` or `disputed` — see above. Scoped to
   *  those two statuses so a plainly-completed job is untouched. */
  contested = false,
): boolean {
  return (
    (contested || !markedDone) &&
    !!tracking &&
    (contested ? CONTESTED_MAP_TRACKING_STATUSES : MAP_TRACKING_STATUSES).has(tracking.status) &&
    tracking.latitude != null &&
    tracking.longitude != null &&
    jobLatitude != null &&
    jobLongitude != null
  );
}

/**
 * How to phrase the assigned helper's name for the step the job is on.
 * "Offered to Camille" is only true at step 0 — once she has accepted, is
 * driving over, or is holding a wrench, saying "Offered to" is wrong.
 * Returned as before/after fragments so the name itself can stay a link.
 */
export type TrackingData = {
  id: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  eta_minutes: number | null;
  updated_at: string;
};

export function JobTracking({
  jobId,
  helperId,
  // `helperName` is NOT destructured any more — nothing in here reads it since
  // the name left the freshness stamp (owner, 2026-09-16). Still accepted on
  // the type so the poster card's call site is unchanged.
  isHelper,
  isOwner: _isOwner,
  jobDateNeeded,
  jobStartTime,
  jobStatus,
  helperConfirmedAt: initialHelperConfirmedAt,
  helperDayofConfirmedAt = null,
  posterConfirmedAt: initialPosterConfirmedAt,
  helperOnTheWayAt: initialHelperOnTheWayAt,
  helperArrivedAt: initialHelperArrivedAt,
  helperArrivalVerifiedAt: initialHelperArrivalVerifiedAt,
  posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt,
  helperArrivalNearMissAt: initialHelperArrivalNearMissAt,
  helperCompletedAt: initialHelperCompletedAt,
  // Optional. Supplied by the surface that already holds the job row, so the
  // Done CTA can honour the proof gate at RENDER time instead of only on tap.
  // Undefined means "caller doesn't know", and the gate stays inactive — the
  // click-time check below is unchanged and remains the enforcement.
  proofBeforeUrls,
  proofAfterUrls,
  requirePhotoProof,
  posterCompletedAt: initialPosterCompletedAt,
  initialTracking,
  jobLatitude,
  jobLongitude,
  includePostingSteps = false,
  embedded = false,
}: {
  jobId: string;
  helperId: string | null;
  /**
   * Display name of the assigned helper. NO LONGER RENDERED by this component
   * (owner, 2026-09-16: "remove the name to the left of updated"): it used to
   * open the freshness stamp — "Camille · Updated 4:12 PM" — and before that
   * captioned the progress bar. The name is printed once now, by the
   * PersonTile the card hands in (now above the action row, not here — owner,
   * 2026-09-19). Still accepted, and still passed by the poster card, so no
   * call site had to change with the caption.
   */
  helperName?: string | null;
  isHelper: boolean;
  isOwner: boolean;
  jobDateNeeded?: string;
  jobStartTime?: string | null;
  jobStatus?: string;
  helperConfirmedAt?: string | null;
  /** Day-before re-confirmation stamp — see JobProgressEvidence. */
  helperDayofConfirmedAt?: string | null;
  posterConfirmedAt?: string | null;
  /**
   * Lifecycle stamps straight off the jobs row. All optional and all
   * defaulting to "unknown" so existing call sites keep compiling and keep
   * their exact current behaviour — but without them the tracker can only
   * guess, and guesses wrong: a job whose helper has already finished shows
   * as "Offered" because no `job_tracking` row exists to say otherwise.
   * Pass them (`job.helper_on_the_way_at` etc.) wherever the jobs row is in
   * hand — see `deriveCurrentStatusIdx`.
   */
  helperOnTheWayAt?: string | null;
  helperArrivedAt?: string | null;
  /**
   * The two-party arrival evidence (see `src/lib/arrivalGate.ts`).
   * `helperArrivalVerifiedAt` is stamped only when the SERVER computed the
   * helper within 500ft; `posterConfirmedArrivalAt` is the poster's vouch.
   * The tracker's Arrived step used to light identically for all three cases,
   * which is how a poster ended up looking at "Working" while still being
   * asked to confirm an arrival — two ladders drawn as one.
   */
  helperArrivalVerifiedAt?: string | null;
  posterConfirmedArrivalAt?: string | null;
  /** VN-33(b): a within-a-mile near miss (the map pin may be wrong). */
  helperArrivalNearMissAt?: string | null;
  helperCompletedAt?: string | null;
  /** Optional; when omitted the Done CTA's render-time proof gate stays off. */
  proofBeforeUrls?: string[] | null;
  proofAfterUrls?: string[] | null;
  /** The poster's per-job photo answer. Omitted = required, which is the
   *  column's own NOT NULL DEFAULT and the pre-migration behaviour. */
  requirePhotoProof?: boolean | null;
  posterCompletedAt?: string | null;
  /**
   * Optional pre-fetched latest tracking row. When provided (including
   * `null`, meaning "no tracking row exists yet"), the per-card initial
   * `loadTracking()` round-trip is skipped — the parent has already
   * batched-fetched tracking for every card on the page. Realtime
   * subscriptions stay active so live updates after mount still flow.
   * Pass `undefined` (the default) for legacy callers — the component
   * falls back to its own per-mount fetch.
   */
  initialTracking?: TrackingData | null;
  /**
   * Job destination coordinates (from the jobs row). When provided alongside
   * the helper's last tracking ping, a mini-map is shown from "on_the_way"
   * until the job is marked done (owner, 2026-09-14). Both must be non-null
   * for the map to render — the status line is the fallback.
   */
  jobLatitude?: number | null;
  jobLongitude?: number | null;
  /* `personTile` WAS HERE and is GONE (owner, 2026-09-19, third position for
     this tile in five days): "the helpr or posted by should be right above the
     buttons". It is no longer anywhere near the tracker, so a slot here would
     be a prop nobody passes. Both cards now publish the tile through
     `JobCardPersonContext` (src/components/activity/jobCardPerson.tsx) and the
     step shell renders it directly above the action row. This component is
     back to owning only the position. */
  /**
   * Poster-side only: prepend the pre-assignment steps ("Posted",
   * "Applicants") so an OPEN job — one with no helper yet — still shows where
   * it stands. With this on the tracker renders without a `helperId`.
   */
  includePostingSteps?: boolean;
  /** Drop this panel's own `rounded-2xl liquid-glass p-3` chrome, for a caller
   *  that already wraps it in a card (HelperTrackerPanel). Without it the
   *  tracker is a bordered card nested directly inside another one.
   *  `src/test/noNestedTrackerCard.test.ts` enforces this at every call site. */
  embedded?: boolean;
}) {
  // Seed from the parent-batched tracking row when present so we don't
  // fire one fetch per rendered card (N+1 across active jobs on Activity).
  const [tracking, setTracking] = useState<TrackingData | null>(initialTracking ?? null);
  const [updating, setUpdating] = useState(false);
  /** Which tier of en-route tracking the RUNTIME actually established — never
   *  what we hoped for. `null` means no watch is running. Drives both the
   *  helper's honesty banner and the poster's freshness stamp. */
  const [, setEnRouteMode] = useState<EnRouteMode | null>(null);
  // The tracker's final step requests the payout, so it asks first — see the
  // BrandConfirmDialog at the bottom of the helper controls.
  const [confirmDoneOpen, setConfirmDoneOpen] = useState(false);
  /**
   * LEGACY ONLY since 2026-09-19. Why an "I've Arrived" tap was REFUSED, back
   * when `mark_helper_arrival` refused far or fix-less arrivals and wrote
   * nothing (VN-33, 20260915044137). Migration 20260919155016 removed every
   * refusal — the RPC now records the check-in on every call — so this can only
   * be set by a response from the previous definition (a queued request, or a
   * client that raced the auto-deploy). It is deliberately NOT repurposed for
   * "your location didn't verify": that is an ordinary, expected outcome now
   * and it is read off the stamps, not off an error.
   */
  const [arrivalRefusal, setArrivalRefusal] = useState<ArrivalRefusal | { kind: "denied" } | null>(null);
  const [helperConfirmedAt, setHelperConfirmedAt] = useState(initialHelperConfirmedAt);
  const [posterConfirmedAt, setPosterConfirmedAt] = useState(initialPosterConfirmedAt);
  // Lifecycle stamps off the jobs row, mirrored into state so the realtime
  // `jobs` UPDATE below can advance the tracker without a parent refetch.
  const [jobStamps, setJobStamps] = useState({
    onTheWayAt: initialHelperOnTheWayAt ?? null,
    arrivedAt: initialHelperArrivedAt ?? null,
    arrivalVerifiedAt: initialHelperArrivalVerifiedAt ?? null,
    posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt ?? null,
    nearMissAt: initialHelperArrivalNearMissAt ?? null,
    helperCompletedAt: initialHelperCompletedAt ?? null,
    posterCompletedAt: initialPosterCompletedAt ?? null,
  });
  const { request: requestPermission } = usePermissionRationale();
  /** Mounted inside a job step card, the next-step CTA is THAT card's primary
   *  and renders in its one action row (owner, 2026-09-14, VN-21). */
  const inStepRow = useInJobStepRow();

  // Sync props
  useEffect(() => { setHelperConfirmedAt(initialHelperConfirmedAt); }, [initialHelperConfirmedAt]);
  useEffect(() => { setPosterConfirmedAt(initialPosterConfirmedAt); }, [initialPosterConfirmedAt]);
  useEffect(() => {
    setJobStamps({
      onTheWayAt: initialHelperOnTheWayAt ?? null,
      arrivedAt: initialHelperArrivedAt ?? null,
      arrivalVerifiedAt: initialHelperArrivalVerifiedAt ?? null,
      posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt ?? null,
      nearMissAt: initialHelperArrivalNearMissAt ?? null,
      helperCompletedAt: initialHelperCompletedAt ?? null,
      posterCompletedAt: initialPosterCompletedAt ?? null,
    });
  }, [initialHelperOnTheWayAt, initialHelperArrivedAt, initialHelperArrivalVerifiedAt, initialPosterConfirmedArrivalAt, initialHelperArrivalNearMissAt, initialHelperCompletedAt, initialPosterCompletedAt]);
  // Keep the batched-tracking prop in sync after activity refreshes — when
  // the parent refetches its batched job_tracking rows, the new value flows
  // back into the card (e.g. cache invalidation after a write).
  useEffect(() => {
    if (initialTracking !== undefined) setTracking(initialTracking);
  }, [initialTracking]);

  const loadTracking = useCallback(async () => {
    if (!helperId) return;
    const { data, error } = await supabase
      .from("job_tracking")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[JobTracking] failed to load tracking:", error);
      report(error, { severity: "warning", tags: { source: "JobTracking.load" } });
      toast.error("Couldn't load job tracking — try again?");
      return;
    }
    if (data && data.length > 0) {
      setTracking(data[0] as unknown as TrackingData);
    }
  }, [jobId, helperId]);

  useEffect(() => {
    if (!helperId) return;
    // Only fall back to a per-card fetch when the parent did NOT supply
    // pre-fetched tracking. Activity surfaces always supply it (even as
    // `null` to mean "no row yet"), so the initial query is eliminated;
    // the realtime channel below still patches live updates after mount.
    if (initialTracking === undefined) loadTracking();

    const sub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_tracking", filter: `job_id=eq.${jobId}` },
        (payload) => {
          if (payload.new && typeof payload.new === "object" && "id" in payload.new) {
            setTracking(payload.new as unknown as TrackingData);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        (payload) => {
          if (payload.new && typeof payload.new === "object") {
            const updated = payload.new as any;
            if (updated.helper_confirmed_at !== undefined) setHelperConfirmedAt(updated.helper_confirmed_at);
            if (updated.poster_confirmed_at !== undefined) setPosterConfirmedAt(updated.poster_confirmed_at);
            setJobStamps((prev) => ({
              onTheWayAt: updated.helper_on_the_way_at !== undefined ? updated.helper_on_the_way_at : prev.onTheWayAt,
              arrivedAt: updated.helper_arrived_at !== undefined ? updated.helper_arrived_at : prev.arrivedAt,
              arrivalVerifiedAt: updated.helper_arrival_verified_at !== undefined ? updated.helper_arrival_verified_at : prev.arrivalVerifiedAt,
              posterConfirmedArrivalAt: updated.poster_confirmed_arrival_at !== undefined ? updated.poster_confirmed_arrival_at : prev.posterConfirmedArrivalAt,
              nearMissAt: updated.helper_arrival_near_miss_at !== undefined ? updated.helper_arrival_near_miss_at : prev.nearMissAt,
              helperCompletedAt: updated.helper_completed_at !== undefined ? updated.helper_completed_at : prev.helperCompletedAt,
              posterCompletedAt: updated.poster_completed_at !== undefined ? updated.poster_completed_at : prev.posterCompletedAt,
            }));
          }
        }
      ),
      // The tracker is a progress bar driven ENTIRELY by other people's writes.
      // A dead channel freezes it mid-job on a step that has already been
      // passed, which reads as "the helper has stopped" rather than "we lost
      // the socket" — so re-read the row the moment we are back.
      { name: `tracking-${jobId}`, onRecovered: () => void loadTracking() },
    );

    return () => { sub.close(); };
    // `initialTracking` is read once when the effect runs to decide whether
    // to skip the fallback fetch. Subsequent prop changes flow through the
    // sync-effect above, not here — so it intentionally stays out of deps.
  }, [jobId, helperId, loadTracking]);

  // LIVE position updates while the helper is EN ROUTE.
  //
  // The tracker was not live. getLocation() is a one-shot read fired only when
  // the helper taps a status button, so the poster's map showed a pin and an
  // "Updated 10:09" stamp that never moved. Verified on 2026-08-31 by moving
  // the helper 1.5 km and waiting 45s: job_tracking.updated_at stayed frozen
  // while the poster's card still read "GPS confirmed · at the job".
  //
  // Scope is deliberately narrow:
  //  * HELPER only — the poster must never broadcast their position.
  //  * `on_the_way` only. Once arrived the position stops mattering, and
  //    tracking someone for the whole duration of a job is surveillance, not a
  //    feature.
  //  * Silent: a failed refresh leaves the last known point rather than
  //    throwing a toast at someone who is driving.
  //
  // ── WHY THIS IS NO LONGER A setInterval ────────────────────────────────
  // It used to be `setInterval(pushPosition, 45_000)` — a JavaScript timer in
  // the WKWebView. iOS suspends the WebView, and every timer in it, the moment
  // the app is backgrounded. So the "live" tracker ran only while the helper
  // was looking at the app and stopped the second they locked the phone or
  // switched to Maps, which is exactly what a person driving to a job does:
  // live when it did not matter, dead when it did. Nothing errored, nothing
  // logged, and the poster's map kept presenting a stale point as current.
  //
  // `startEnRouteWatch` replaces it with a real position watch and reports
  // which of three modes the runtime actually got (background / foreground /
  // denied). That mode drives the UI below — we never claim background
  // delivery we have not established. See src/lib/enRouteLocation.ts.
  // The last position the en-route watch delivered. The arrival read falls
  // back to it when a fresh one-shot fix times out (see getLocationOutcome).
  const lastEnRouteFixRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  useEffect(() => {
    setEnRouteMode(null);
    if (!isHelper) return;
    if (tracking?.status !== "on_the_way") return;
    const trackingId = tracking?.id;
    if (!trackingId || trackingId === "temp") return;

    let cancelled = false;

    const watch = startEnRouteWatch({
      onMode: (mode) => {
        if (!cancelled) setEnRouteMode(mode);
      },
      onPosition: (p) => {
        if (cancelled) return;
        lastEnRouteFixRef.current = { lat: p.lat, lng: p.lng, at: Date.now() };
        // No unwrapMutation here on purpose: this is a best-effort position
        // refresh, and a zero-row result just means the job moved on. The
        // status writes below remain guarded, which is where correctness
        // matters. Fire-and-forget deliberately — the callback may run while
        // the app is suspended-but-executing and must not block the watch.
        //
        // The `.then()` is what makes it fire at all: a PostgrestBuilder is a
        // lazy thenable that issues its fetch inside then(), so `void
        // supabase.from(…).update(…).eq(…)` sent NOTHING and every en-route
        // position after the first was dropped on the floor — the poster's map
        // held the point from whenever the row was last written by another
        // path. Same class as useMessagesData.ts:440 and
        // useMessagesRealtime.ts:71. Still non-blocking: nobody awaits this.
        void supabase
          .from("job_tracking")
          .update({
            latitude: p.lat,
            longitude: p.lng,
            updated_at: new Date(p.at).toISOString(),
          })
          .eq("id", trackingId)
          .then(({ error }) => {
            if (error) report(error, { severity: "warning", tags: { source: "JobTracking.enRoutePosition" } });
          });
      },
    });

    return () => {
      cancelled = true;
      watch.stop();
    };
  }, [isHelper, tracking?.status, tracking?.id]);

  const getLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    if (!isNativePlatform && !navigator.geolocation) return null;
    let location: { lat: number; lng: number } | null = null;
    // Pre-prompt before the first OS dialog this session, so the helper
    // sees a friendly "we use your location to confirm arrival" message
    // before iOS shows its system alert.
    await requestPermission("location", async () => {
      // On native (iOS/Android) read through the Capacitor Geolocation
      // plugin only — falling through to the WKWebView navigator.geolocation
      // shim fires a SECOND "localhost would like to use your location"
      // prompt on top of the OS-native one.
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ timeout: 10000 });
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          /* denied / unavailable — leave location null */
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve();
          },
          () => resolve(),
          { timeout: 10000 },
        );
      });
    });
    return location;
  };

  /**
   * Same read as `getLocation`, but it KEEPS THE REASON it failed.
   *
   * `getLocation` deliberately swallows every failure into `null` because its
   * caller (the `arrived` transition) proceeds either way — the claim is
   * stamped whether or not a fix arrives. The retry below is the opposite: a
   * failed fix is the ONLY thing it has to report, and "we couldn't get your
   * location" is useless to a helper whose real problem is that they tapped
   * Don't Allow. Permission-denied gets its own sentence naming Settings.
   */
  const getLocationOutcome = async (): Promise<
    { lat: number; lng: number } | { error: "denied" | "unavailable" }
  > => {
    if (!isNativePlatform && !navigator.geolocation) return { error: "unavailable" };
    let location: { lat: number; lng: number } | null = null;
    let denied = false;
    await requestPermission("location", async () => {
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ timeout: 15000, maximumAge: 30000 });
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch (e) {
          // Capacitor surfaces a denial as a message, not a code, on iOS.
          const msg = String((e as { message?: string } | null)?.message ?? e ?? "");
          if (/denied|permission|authorized|authoriz/i.test(msg)) denied = true;
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve();
          },
          (err) => {
            // 1 === PERMISSION_DENIED
            if (err?.code === 1) denied = true;
            resolve();
          },
          { timeout: 15000, maximumAge: 30000 },
        );
      });
    });
    if (location) return location;
    // A one-shot fix can time out while the en-route watch is still receiving
    // positions (seen on prod 2026-09-14: a helper 2,099 mi away got "we
    // couldn't get your location" and the RPC was never called, while the
    // status line above read "2099 mi from job"). Use the watch's own last
    // point if it is under a minute old — the SERVER still measures the
    // distance and refuses anything outside 500ft, so this can only turn a
    // vague "no location" into the real answer.
    const recent = lastEnRouteFixRef.current;
    if (!denied && recent && Date.now() - recent.at < 60_000) return { lat: recent.lat, lng: recent.lng };
    return { error: denied ? "denied" : "unavailable" };
  };

  /**
   * WRITE A VERDICT ONTO THE MIRRORED STAMPS.
   *
   * ONE place, because both callers of `mark_helper_arrival` (the Arrived
   * transition and the Location retry) have to apply the same three facts in
   * the same order, and they used to disagree: the transition stamped
   * `arrivalVerifiedAt` unconditionally — on a bare claim as well as a verified
   * one — which painted the tracker's proof line "Arrival GPS-verified" for a
   * helper whose phone had produced no fix at all.
   *
   * Never DOWNGRADES: every field is `prev ?? …`, matching the RPC, which
   * cannot un-verify an arrival either (20260919155016).
   */
  const applyArrivalVerdict = (v: ArrivalVerdict) => {
    const nowIso = new Date().toISOString();
    setJobStamps((prev) => ({
      ...prev,
      // ALWAYS: the check-in is recorded on every call now. This is the stamp
      // that makes the poster's "Confirm They Arrived" control appear, so
      // failing to mirror it here is what leaves the Helpr staring at a CTA
      // telling them to ask for a tap the other side cannot yet offer.
      arrivedAt: prev.arrivedAt ?? nowIso,
      // ONLY when the server actually measured them at the job.
      arrivalVerifiedAt: v.verified ? (prev.arrivalVerifiedAt ?? nowIso) : prev.arrivalVerifiedAt,
      nearMissAt: v.basis === "near_miss" ? (prev.nearMissAt ?? nowIso) : prev.nearMissAt,
      posterConfirmedArrivalAt: v.posterConfirmed
        ? (prev.posterConfirmedArrivalAt ?? nowIso)
        : prev.posterConfirmedArrivalAt,
    }));
  };

  /* `retryArrivalVerification` LIVED HERE and is gone (owner, 2026-09-19).
     The "Try My Location Again" chip it backed is removed from the action row;
     the same operation now runs from the pull-to-refresh gesture on My Jobs,
     in `src/lib/arrivalRefresh.ts`, gated on an arrival that is recorded and
     unverified. That module carries the reasoning, the conservatism rules, and
     the note on why the replacement had to exist before the chip could go.

     `getLocationOutcome` and `applyArrivalVerdict` above are UNCHANGED and
     still have their other caller — the "I've Arrived" transition — so nothing
     was deleted with this beyond the retry itself. */



  // SYNCHRONOUS IN-FLIGHT GUARD. `updating` is React state, so two taps on
  // the Mark Complete confirm dispatched in one frame both read false and wrote
  // helper_completed_at — moving the stamp the 24h auto-release clock is keyed
  // on, and (landing after a concurrent release or cancel) stamping a job that
  // was no longer live. A ref sees the first tap. Same class and fix as
  // useActivityActions' completeInFlight (JobTracking.doneInFlight.test.tsx).
  const updateInFlight = useRef(false);
  const updateStatus = async (newStatus: string) => {
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    try {
      await runStatusUpdate(newStatus);
    } finally {
      updateInFlight.current = false;
    }
  };

  const runStatusUpdate = async (newStatus: string) => {
    if (!helperId) return;
    setUpdating(true);

    // ── EVERY GATE RUNS BEFORE EVERY WRITE ──
    //
    // These three checks used to sit AFTER the job_tracking row had already
    // been updated to the new status, so a REJECTED "Done" left
    // `job_tracking.status = 'done'` persisted on the server while
    // `helper_completed_at` was never written and no payout was requested.
    // `deriveCurrentStatusIdx` takes the max of the tracking row and the jobs
    // row, so the rail painted fully green through Done — and each rejection
    // path then called loadTracking(), re-reading the row it had just poisoned.
    // The poster saw the identical false state over the job_tracking realtime
    // channel. Nothing may be persisted until every gate has passed, and these
    // paths deliberately do NOT loadTracking(): nothing was written, so there
    // is nothing to re-read.
    //
    // SAME GATES AS PayoutPrimary's "Mark Job Complete" (owner, 2026-08-24 E2E): this
    // button used to write helper_completed_at with no checks at all, so the
    // before/after-photo requirement and the 30-minute work floor on the payout
    // CTA were decorative — the tracker was a free bypass that still started
    // the auto-release clock. Fetch the row fresh (this component isn't handed
    // proof URLs) and enforce both, with the reason stated. The poster's
    // working-confirmation is deliberately NOT required (owner): a ghosting
    // poster must not be able to block the payout request — they keep the
    // review window instead.
    //
    // Running ahead of getLocation() is deliberate as well: a helper who
    // cannot complete yet should not be made to answer a location prompt first.
    if (newStatus === "done") {
      const { data: gate, error: gateErr } = await supabase
        .from("jobs")
        .select("proof_before_urls, proof_after_urls, require_photo_proof, poster_confirmed_working_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, helper_arrival_near_miss_at")
        .eq("id", jobId)
        .single();
      if (gateErr) {
        report(gateErr, { tags: { source: "JobTracking.doneGateFetch" } });
        hapticError();
        toast.error("Couldn't check the job's completion requirements — try again?");
        setUpdating(false);
        return;
      }
      // ARRIVAL FIRST — the same rule completeJob and the DB trigger use.
      // This replaces nothing on this path (the tracker's Done step never
      // checked location at all), but it is the gate the payout CTA now
      // enforces, and the two must not disagree again.
      if (!arrivalEstablished(gate)) {
        hapticError();
        toast.error(arrivalGateMessage(gate), { duration: 8000 });
        setUpdating(false);
        return;
      }
      // ONE shared proof rule (photoProofPolicy) — same predicate the payout
      // CTA and completeJob's re-check enforce, same stated reason.
      // `gate`, not `undefined` — the poster's per-job answer
      // (`require_photo_proof`, 2026-09-11) lives on this row and the DB
      // trigger reads it. Passing undefined here demanded photos on a job the
      // poster had excused and the server would have accepted: a dead Done
      // button with a toast explaining a rule that no longer applied.
      const proofJob = { require_photo_proof: gate?.require_photo_proof ?? true };
      const hasPhotos = hasRequiredProof(proofJob, gate?.proof_before_urls, gate?.proof_after_urls);
      if (!hasPhotos) {
        hapticError();
        toast.error(requiredProof(proofJob).reason);
        setUpdating(false);
        return;
      }
      const workStart = gate?.poster_confirmed_working_at ?? gate?.helper_arrived_at;
      const MIN_WORK_MS = 30 * 60 * 1000;
      if (workStart && Date.now() - new Date(workStart).getTime() < MIN_WORK_MS) {
        const minsLeft = Math.ceil((MIN_WORK_MS - (Date.now() - new Date(workStart).getTime())) / 60000);
        hapticError();
        toast.error(`Almost — Done unlocks in ${minsLeft} min. Jobs can't be completed in under 30 minutes.`);
        setUpdating(false);
        return;
      }
    }

    const now0 = new Date().toISOString();
    // `arrived` keeps the REASON a fix failed, because it changes what the
    // Helpr is told afterwards ("Location is turned off…" vs "we couldn't get
    // a fix"). It no longer changes WHETHER they check in. Every other step
    // proceeds either way, so it only needs the coordinates.
    const locOutcome = newStatus === "arrived" ? await getLocationOutcome() : null;
    const loc = locOutcome ? ("error" in locOutcome ? null : locOutcome) : await getLocation();

    // "MARK ARRIVED" ALWAYS RECORDS THE CHECK-IN. LOCATION IS EVIDENCE, NOT A
    // DOOR.
    //
    // OWNER, 2026-09-19 (verbatim): "if gps is not on, they can mark themselves
    // as arrived but can not move on until the poster marks them arrived … but
    // even if gps does confirm they are there the poster still needs ro cfnrm
    // wither way".
    //
    // WHAT THIS REPLACED. Under VN-33 (20260915044137) the RPC REFUSED a far or
    // fix-less arrival and wrote nothing, and this branch returned before the
    // tracking row was written — so a Helpr with Location off never got a
    // `helper_arrived_at`, the poster's "Confirm They Arrived" control (gated on
    // exactly that column) never rendered, and the Helpr's blocked CTA told them
    // to go ask the poster for a tap the poster was never offered. A deadlock
    // with a polite explanation on both ends.
    //
    // NOW: no early return on a failed fix. The RPC is called either way —
    // without coordinates when there are none — it stamps `helper_arrived_at`
    // on every call, and it stamps `helper_arrival_verified_at` only when it
    // genuinely measured the Helpr at the job. The verdict says which happened
    // and `arrivalVerdictMessage` turns that into the one sentence the Helpr
    // reads; every branch of it ends on the poster's tap, because that is the
    // only gate left and they have to know it is coming ("they shoud be aware
    // of this so they dont try to cheat the system").
    if (newStatus === "arrived") {
      const { data: verdict, error: arrivalErr } = await supabase.rpc("mark_helper_arrival", {
        p_job_id: jobId,
        p_lat: loc?.lat ?? undefined,
        p_lng: loc?.lng ?? undefined,
      });
      if (arrivalErr) {
        const refusal = arrivalRefusalFromError(arrivalErr);
        hapticError();
        if (refusal) {
          // LEGACY ONLY — the live RPC raises none of these any more. A queued
          // request answered by the previous definition still can, and it
          // genuinely wrote nothing, so the rail must not advance.
          setArrivalRefusal(refusal);
          toast.warning(arrivalRefusalMessage(refusal), { duration: 9000 });
          setUpdating(false);
          return;
        }
        report(arrivalErr, { tags: { source: "JobTracking.markArrival" } });
        toast.error(
          arrivalErr.code === "PGRST202"
            // Short window between merge and the auto-deploy landing.
            ? "Arrival check-in is updating — try again in a minute."
            : (rpcErrorMessage("mark_helper_arrival", arrivalErr) ?? "Couldn't mark you arrived — try again?"),
        );
        setUpdating(false);
        loadTracking();
        return;
      }
      // A NULL ERROR IS NOT A WRITE. The RPC returns a jsonb verdict on every
      // success; `arrivalVerdictFromRpc` returns null when the body is absent
      // or unrecognisable, and that means something silently did nothing. It is
      // NOT treated as a success — the rail stays put and the row is re-read.
      const v = arrivalVerdictFromRpc(verdict);
      if (!v) {
        report(new Error("mark_helper_arrival returned no verdict"), {
          tags: { source: "JobTracking.markArrival" },
        });
        hapticError();
        toast.error("Couldn't mark you arrived — try again?");
        setUpdating(false);
        loadTracking();
        return;
      }
      setArrivalRefusal(null);
      applyArrivalVerdict(v);
      // The check-in SUCCEEDED in every one of these branches, so none of them
      // gets the error haptic or an error toast. An unverified location is an
      // ordinary outcome (Location off, a wrong map pin, a bad fix), not a
      // fault of the Helpr's — treating it as one is the "accusation" the owner
      // ruled out. `toast.info` for those, success only when something was
      // actually settled.
      const settled = v.verified || v.posterConfirmed;
      if (settled) hapticSuccess();
      (settled ? toast.success : toast.info)(arrivalVerdictMessage(v), { duration: 9000 });
    }

    const now = now0;

    // THE MONEY STAMP LANDS BEFORE THE TRACKING ROW SAYS "DONE".
    //
    // This used to run AFTER the job_tracking write, which is the second half
    // of the same defect the gates above fix: a stamp rejected by RLS or by a
    // job that had already moved on still left a persisted `status = 'done'`
    // behind it. `helper_completed_at` is what enters the job into the payout
    // pipeline, so it is the event the tracker is allowed to draw — and it has
    // to be the one that happens first.
    //
    // .select("id"): "silently fails" includes matching zero rows, which
    // returns error === null. Without the row count this stamp could no-op
    // (RLS, a job that already moved on) and the helper would be told the
    // payout clock had started.
    //
    // .in("status", LIVE): the stamp only lands on a job that is still live.
    // Queued behind a poster's cancel (or a release) it used to stamp the
    // cancelled/completed row; now it matches zero rows and says so. The
    // database enforces the same rule (trg_completion_on_live_job,
    // 20260914215112) — this is the client half, so the Helpr gets the honest
    // "already completed or cancelled" message instead of a trigger error.
    //
    // poster_completed_at comes back so a Done that lands AFTER the poster
    // already confirmed finishes the release (below) instead of leaving a job
    // both parties confirmed sitting in_progress.
    if (newStatus === "done") {
      let posterAlreadyConfirmed: boolean | undefined;

      // COMPLETION IS A SERVER DECISION. rpc_helper_mark_done re-runs the
      // assigned-Helpr / live-job / arrival / proof / 30-minute gates and stamps
      // helper_completed_at = now() itself, so a direct PATCH can no longer pick
      // the stamp's VALUE (a backdate makes it instantly auto-releasable) or land
      // it on a job that already moved on (H-001/H-002,
      // enforce_job_completion_server_owned). It returns poster_completed_at so a
      // Done that arrives AFTER the poster already confirmed still finishes the
      // release below.
      //
      // PGRST202 → the short merge→deploy window before the RPC lands (same
      // pattern as helper_mark_on_the_way / mark_helper_arrival). In that window
      // the completion trigger is not live either, so the legacy direct stamp
      // still works and stays the fallback body.
      const { data: doneRes, error: doneRpcErr } = await supabase.rpc("rpc_helper_mark_done", {
        _job_id: jobId,
      });
      if (!doneRpcErr) {
        posterAlreadyConfirmed = !!(doneRes as { poster_completed_at?: string | null } | null | undefined)?.poster_completed_at;
      } else if (doneRpcErr.code === "PGRST202") {
        try {
          const [stamped] = unwrapMutation(
            await supabase
              .from("jobs")
              .update({ helper_completed_at: now })
              .eq("id", jobId)
              .in("status", ["accepted", "in_progress", "revision_requested"])
              .select("id, poster_completed_at"),
            {
              action: "mark the job complete",
              rejectedMessage: "We couldn't mark this job complete — it may have already been completed or cancelled. Pull to refresh.",
              context: { jobId },
            },
          );
          posterAlreadyConfirmed = !!stamped?.poster_completed_at;
        } catch (doneErr) {
          if (!isWriteRejected(doneErr)) {
            report(doneErr, { tags: { source: "JobTracking.helperCompleted" } });
          }
          hapticError();
          toast.error(lifecycleErrorMessage(doneErr) ?? mutationErrorMessage(doneErr, "Couldn't mark the job complete — try again?"));
          setUpdating(false);
          loadTracking();
          return;
        }
      } else {
        // The RPC refused (a completion gate, a live-job race, authz) or errored.
        // Its custom codes get their sentence through rpcErrorMessage; a benign
        // race is not reported (matches the old zero-row path).
        if (!isWriteRejected(doneRpcErr)) {
          report(doneRpcErr, { tags: { source: "JobTracking.helperCompleted" } });
        }
        hapticError();
        toast.error(
          lifecycleErrorMessage(doneRpcErr)
            ?? rpcErrorMessage("rpc_helper_mark_done", doneRpcErr)
            ?? "Couldn't mark the job complete — try again?",
        );
        setUpdating(false);
        loadTracking();
        return;
      }

      // BOTH SIDES HAVE NOW CONFIRMED — FINISH IT. The poster's release
      // committed first with this Helpr not yet done, so it only stamped
      // poster_completed_at; this plain stamp completes nothing on its own, and
      // the job sat in_progress with both confirmations until the 24h sweep
      // (14/20 PGlite rounds, 20260914215112). create-payment's release treats
      // exactly this shape as "fall through and complete" and runs the Stripe
      // capture check the database cannot. The stamp above stands either way,
      // so a failure here is reported and told, not rolled back.
      if (posterAlreadyConfirmed) {
        const { data: rel, error: relErr } = await supabase.functions.invoke("create-payment", {
          body: { action: "release", jobId },
        });
        if (relErr || (rel as { error?: string } | null)?.error) {
          report(relErr ?? new Error(String((rel as { error?: string }).error)), {
            tags: { source: "JobTracking.finishRelease" },
            context: { jobId },
          });
          toast.warning("Marked done. The person who posted this job already approved, but we couldn't start your payout just now — it releases automatically unless something needs a look. Pull to refresh.", { duration: 8000 });
        }
      }
    }

    // THE OPTIMISTIC ROW IS REVERTIBLE, because it also leads reality until
    // the write lands. `loadTracking()` on the failure paths below only calls
    // setTracking when the server returns a row — so on the very case that
    // matters (the INSERT branch, where no row exists yet) a rejected write
    // left this `id: "temp"` row in place with the new status on it, and
    // `deriveCurrentStatusIdx` reads `tracking.status` first. Same defect
    // shape as the persisted one the gates above fix, one layer up: nothing
    // may claim a step the server did not accept.
    const trackingBeforeWrite = tracking;
    setTracking(prev => prev ? { ...prev, status: newStatus, latitude: loc?.lat || prev.latitude, longitude: loc?.lng || prev.longitude, updated_at: now } : {
      id: "temp",
      status: newStatus,
      latitude: loc?.lat || null,
      longitude: loc?.lng || null,
      eta_minutes: null,
      updated_at: now,
    });

    // ON THE WAY IS ONE TRANSACTION, NOT THREE WRITES.
    //
    // This transition used to be three sequential client writes (tracking
    // upsert, jobs.status = in_progress, jobs.helper_on_the_way_at) — a run
    // interrupted after write #2 left status = in_progress with NO tracking
    // row and NO departure stamp (proven live 2026-08-28, job db21c20d). The
    // RPC does all three atomically, validates the caller is the confirmed
    // helper server-side, and — because status + timestamp land in ONE jobs
    // update — the notify trigger fires once instead of twice.
    //
    // PGRST202 fallback: merge→deploy window for a brand-new RPC (same
    // pattern as mark_helper_arrival above); the legacy sequence stays as
    // the fallback body below.
    let onTheWayAtomic = false;
    if (newStatus === "on_the_way") {
      const { error: otwErr } = await supabase.rpc("helper_mark_on_the_way", {
        p_job_id: jobId,
        p_lat: loc?.lat ?? undefined,
        p_lng: loc?.lng ?? undefined,
      });
      if (!otwErr) {
        onTheWayAtomic = true;
        setJobStamps((prev) => ({ ...prev, onTheWayAt: prev.onTheWayAt ?? now }));
      } else if (otwErr.code !== "PGRST202") {
        report(otwErr, { tags: { source: "JobTracking.markOnTheWay" } });
        hapticError();
        toast.error(rpcErrorMessage("helper_mark_on_the_way", otwErr) ?? "Couldn't mark you on the way — try again?");
        setUpdating(false);
        setTracking(trackingBeforeWrite);
        loadTracking();
        return;
      }
      // PGRST202 → fall through to the legacy three-write sequence.
    }

    // .select("id") on both branches: the tracking row is the source of truth
    // for the helper's own view, and an update that matches zero rows returns
    // error === null — the card would have kept the optimistic status forever.
    try {
      if (!onTheWayAtomic)
      unwrapMutation(
        tracking && tracking.id !== "temp"
          ? await supabase
              .from("job_tracking")
              .update({
                status: newStatus,
                latitude: loc?.lat || null,
                longitude: loc?.lng || null,
                updated_at: now,
              })
              .eq("id", tracking.id)
              .select("id")
          : await supabase.from("job_tracking").insert({
              job_id: jobId,
              helper_id: helperId,
              status: newStatus,
              latitude: loc?.lat || null,
              longitude: loc?.lng || null,
            }).select("id"),
        {
          action: "update your status",
          rejectedMessage: "We couldn't update your status — this job may have been cancelled. Pull to refresh.",
          context: { jobId, newStatus },
        },
      );
    } catch (writeErr) {
      if (!isWriteRejected(writeErr)) {
        report(writeErr, { tags: { source: "JobTracking.updateStatus" } });
      }
      hapticError();
      toast.error(lifecycleErrorMessage(writeErr) ?? mutationErrorMessage(writeErr, "Couldn't update your status — try again?"));
      setUpdating(false);
      setTracking(trackingBeforeWrite);
      loadTracking();
      return;
    }

    // Auto-transition job status
    let statusTransitioned = false;
    // `done` is handled above — its gates run before any write and its
    // `helper_completed_at` stamp lands before the tracking row records it.
    if (["on_the_way", "arrived", "working"].includes(newStatus) && !onTheWayAtomic) {
      const { data: job, error: statusErr } = await supabase.from("jobs").select("status").eq("id", jobId).single();
      if (statusErr) report(statusErr, { tags: { source: "JobTracking.autoTransition" } });
      // These writes used to drop their errors, while the `helper_completed_at`
      // stamp on the `done` path was carefully checked. That asymmetry was the
      // bug: these are the exact columns the POSTER's timeline reads, so on an
      // RLS or network failure the helper got a success buzz (and now a success
      // toast) while the poster's screen never moved — a phantom success on the
      // one signal the poster is waiting for.
      //
      // The tracking row itself is already written and is the source of truth
      // for the helper's own view, so a failure here does not invalidate the
      // action — it just means the poster won't see it. Hence: report, and tell
      // the truth in the toast, rather than aborting the whole transition.
      //
      // .select("id") on both: a zero-row update is the same phantom
      // success as an error here, and is the more likely of the two (RLS on
      // jobs the helper doesn't own, or a job cancelled out from under them).
      const stampErrors: string[] = [];
      const stampJob = async (
        patch: TablesUpdate<"jobs">,
        label: string,
        source: string,
      ) => {
        try {
          unwrapMutation(
            await supabase.from("jobs").update(patch).eq("id", jobId).select("id"),
            { action: `update the ${label} shown to the person who posted this job`, context: { jobId } },
          );
        } catch (err) {
          if (!isWriteRejected(err)) report(err, { tags: { source } });
          stampErrors.push(label);
        }
      };
      if (job && job.status === "accepted") {
        await stampJob({ status: "in_progress" }, "status", "JobTracking.statusInProgress");
        statusTransitioned = true;
      }
      // `helper_arrived_at` is NOT stamped here any more — mark_helper_arrival
      // above wrote it (and the status transition) inside the same transaction
      // that decided whether the arrival was verified. Stamping it a second
      // time from the client would be the only writer able to set it without a
      // proximity verdict attached.
      if (newStatus === "on_the_way") {
        await stampJob({ helper_on_the_way_at: now }, "departure time", "JobTracking.onTheWayAt");
      }
      if (stampErrors.length > 0) {
        hapticError();
        toast.error("Saved for you, but we couldn't update what the person who posted this job sees — check your connection.");
        setUpdating(false);
        loadTracking();
        return;
      }
    }

    // Notify the poster — ONLY when no server-side writer already did.
    //
    // Every transit event used to notify TWICE (proven live 2026-08-28, job
    // db21c20d): the notify_poster_on_status_change DB trigger
    // (20260824070000, kept — it fires even if this client dies mid-flow)
    // AND this block. Per-event server coverage:
    //   - on_the_way : trigger on jobs.helper_on_the_way_at (stamped by the
    //                  helper_mark_on_the_way RPC or the legacy stampJob) →
    //                  client notification REMOVED.
    //   - arrived    : trigger on jobs.helper_arrived_at (stamped by
    //                  mark_helper_arrival) → REMOVED.
    //   - done       : trigger on jobs.helper_completed_at → REMOVED.
    //   - working    : trigger fires only on the accepted→in_progress status
    //                  transition ("Work has started"). When the job is
    //                  ALREADY in_progress (the normal case — on_the_way set
    //                  it) no jobs column changes at the "working" tap, so no
    //                  server writer exists and the client one is KEPT.
    // Link: /my-posts?filter=scheduled — the old filter=in_progress is not a
    // bucket Activity knows (needs_you/scheduled/waiting/done) and landed on
    // the default list; a poster's in_progress job buckets as "scheduled".
    //
    // The RESULT of that send is checked. It used to be discarded, so a failed
    // read of the job row — or a failed edge-function invoke — meant the
    // poster's only "work has started" signal silently never sent while the
    // helper was told everything was fine. `createNotification` already
    // report()s its own failure, so this only has to tell the person.
    let posterNotified = true;
    if (isHelper && newStatus === "working" && !statusTransitioned) {
      const { data: job, error: notifyErr } = await supabase.from("jobs").select("title, customer_id").eq("id", jobId).single();
      if (notifyErr) report(notifyErr, { tags: { source: "JobTracking.notifyPoster" } });
      if (job?.customer_id) {
        const { createNotification } = await import("@/lib/notifications");
        const { error: pushErr } = await createNotification({
          user_id: job.customer_id,
          title: "Work has started",
          message: `Your Helpr started working on "${job.title}".`,
          type: "info",
          // `?job=`, not `?filter=scheduled`. `scheduled` IS a live chip, but it
          // is not stable: the same job is in "Needs you" the moment its day has
          // passed (jobIsOverdue, activityFilters.ts), and this notification can
          // sit unread across that boundary. Activity resolves the live bucket.
          link: `/my-posts?job=${jobId}`,
        });
        if (pushErr) posterNotified = false;
      } else {
        // No customer_id in hand (the read failed, or the row is gone) — there
        // is nobody to notify, which is the same outcome as a failed send.
        posterNotified = false;
      }
    }

    hapticSuccess();
    // SAY SOMETHING. Every transition used to fire haptics and nothing else,
    // so on the web — and on any phone with haptics off — a successful tap gave
    // no feedback at all. The tracker row moves, but it is one small step in a
    // scrolling line and easy to miss on the very tap that matters most.
    if (!posterNotified) {
      toast.warning("Work started — we saved it, but couldn't tell the person who posted this job. Send them a message so they know.");
    } else {
      // `arrived` has no entry in the map on purpose — see TRANSITION_TOAST.
      const message = TRANSITION_TOAST[newStatus];
      if (message) toast.success(message);
    }
    setUpdating(false);
    loadTracking();
  };

  // Determine current status index from every signal available — see
  // `deriveCurrentStatusIdx` for why the jobs row has to be read too.
  // WHAT THE SERVER ACTUALLY REQUIRES BEFORE A HELPER CAN SET OFF.
  //
  // This used to be `bothConfirmed` — the helper's confirmation AND the
  // poster's. `helper_mark_on_the_way`
  // (supabase/migrations/20260829061546_helper_mark_on_the_way_atomic.sql)
  // checks exactly two things: the caller is the assigned helper, and
  // `v_job.helper_confirmed_at IS NOT NULL`. It never looks at
  // `poster_confirmed_at`. So a helper whose poster simply never confirmed sat
  // on "Confirm the job below to unlock the next step" — pointed at a card
  // holding no control of theirs — on a job the server would have started
  // happily. That is the same ghosting-poster trap the payout CTA was fixed for
  // (owner, 2026-08-24: a poster who never confirms must not be able to block
  // the helper); the client is now the same rule as the server, no stricter.
  //
  // The tracker's `job_confirmed` STEP still lights on the mutual stamp — see
  // `deriveCurrentStatusIdx`. This gate is only about which button the helper
  // is allowed to reach.
  const helperHasConfirmed = !!helperConfirmedAt;

  const currentStatusIdx = deriveCurrentStatusIdx({
    trackingStatus: tracking?.status,
    jobStatus,
    helperConfirmedAt,
    helperDayofConfirmedAt,
    jobDateNeeded,
    jobStartTime,
    posterConfirmedAt,
    helperOnTheWayAt: jobStamps.onTheWayAt,
    helperArrivedAt: jobStamps.arrivedAt,
    helperArrivalVerifiedAt: jobStamps.arrivalVerifiedAt,
    posterConfirmedArrivalAt: jobStamps.posterConfirmedArrivalAt,
    helperArrivalNearMissAt: jobStamps.nearMissAt,
    helperCompletedAt: jobStamps.helperCompletedAt,
    posterCompletedAt: jobStamps.posterCompletedAt,
  });

  // What the STEP ROW draws. Without the posting steps this is exactly the old
  // behaviour (`STATUSES` / `currentStatusIdx`); with them the row is offset by
  // the two prepended steps, and a job with nobody assigned yet sits on
  // "Posted" or — once at least one application is in — "Applicants".
  //
  // `firstName` IS GONE (owner, 2026-09-16: "remove the name to the left of
  // updated"). It existed only to open the freshness stamp with the Helpr's
  // first name on the poster's card; nothing else read it. `helperName` is
  // therefore no longer read by this component — the prop is kept on the type
  // so its one caller keeps compiling, and the name is printed once, by the
  // PersonTile the card renders directly above its action row.

  const arrivalEvidence = {
    helper_arrived_at: jobStamps.arrivedAt,
    helper_arrival_verified_at: jobStamps.arrivalVerifiedAt,
    poster_confirmed_arrival_at: jobStamps.posterConfirmedArrivalAt,
    helper_arrival_near_miss_at: jobStamps.nearMissAt,
  };
  const currentArrivalState = arrivalState(arrivalEvidence);
  /**
   * THE FIVE-STATE READ, for the copy that has to tell a claim with NO location
   * at all ("turn Location on") from one that landed near the pin ("the pin may
   * be off"). `arrivalState` above collapses both into `"claimed"`, which is
   * why it is not used for any of the new copy (src/lib/arrivalGate.ts).
   */
  const currentArrivalEvidence = arrivalEvidenceState(arrivalEvidence);
  // Rail caption under the Arrived step. `null` in every state since
  // 2026-09-16 — see `arrivalStateLabel`; the amber step colour is the signal.
  const arrivalCaption = arrivalStateLabel(currentArrivalState);
  // The settled arrival fact goes on the map's job pin when the map is drawn,
  // and falls back to the status line when it is not (VN-20).
  const markedDone =
    currentStatusIdx >= STATUS_IDX.done ||
    !!jobStamps.helperCompletedAt ||
    !!jobStamps.posterCompletedAt ||
    jobStatus === "completed" ||
    jobStatus === "cancelled";
  // The map survives a contested completion (owner, 2026-09-16) — see
  // `shouldShowTrackingMap`. Same two statuses the rail clamps to Working.
  const contested = jobStatus === "revision_requested" || jobStatus === "disputed";
  const mapShown = shouldShowTrackingMap(tracking, jobLatitude, jobLongitude, markedDone, contested);
  const settledArrivalLabel = arrivalMapLabel(currentArrivalState);
  const arrivalOnMap = mapShown && settledArrivalLabel != null;

  // Timestamp behind each COMPLETED step, for the tap/hover tooltip below.
  // Reuses fields the tracker already has in scope — no new backend field.
  // Steps with no reliable single timestamp (Offered/Posted, Working — the
  // "working" span has a start but no dedicated stamp on this row) render
  // without a tooltip rather than guessing.
  const stepTimestamps: Partial<Record<string, string | null | undefined>> = {
    confirmed: helperConfirmedAt,
    job_confirmed: posterConfirmedAt,
    on_the_way: jobStamps.onTheWayAt,
    arrived: jobStamps.arrivedAt ?? jobStamps.arrivalVerifiedAt ?? jobStamps.posterConfirmedArrivalAt,
    done: jobStamps.helperCompletedAt ?? jobStamps.posterCompletedAt,
  };
  const [openStepTooltip, setOpenStepTooltip] = useState<string | null>(null);

  const displaySteps = includePostingSteps ? [...PRE_STATUSES, ...STATUSES] : STATUSES;
  // ONE definition of the offset, shared with the collapsed card's compact
  // rail — see `railDisplayIdx` at the top of this file. Inlined here until
  // 2026-09-19, when a second rail started needing the same answer.
  const displayIdx = railDisplayIdx({ currentStatusIdx, includePostingSteps, helperId });

  // The step row is ONE horizontally-scrolling line (owner: "the live tracker
  // should be 1 scrollable line"). Because it scrolls, the current step can sit
  // off-screen — so it is scrolled back into view whenever the job advances.
  //
  // `scrollIntoView` is deliberately NOT used: with `block`/`inline` it walks up
  // to the nearest scrollable ancestor and, if this row were ever non-scrollable,
  // would yank the whole activity feed instead. Setting `scrollLeft` on the row
  // itself cannot escape the element, so the feed can never move.
  const stepRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = stepRowRef.current;
    if (!row) return;

    // ONE MEASUREMENT IS NOT ENOUGH. This ran exactly once per `displayIdx`
    // change, which on FIRST PAINT is a layout that has not happened yet: the
    // card mounts inside a virtualised activity feed, `clientWidth` is 0 or
    // stale, `target` comes out negative, it clamps to 0, and the row is left
    // wherever the browser put it — which is how the owner's screenshot has a
    // step sliced mid-word ("ifirmed") instead of the current step centred.
    // Re-centring on the next frame AND on any resize of the row is what makes
    // "the current step is visible" true rather than intended.
    const centre = () => {
      const step = row.children[displayIdx] as HTMLElement | undefined;
      if (!step || row.clientWidth === 0) return;
      const max = row.scrollWidth - row.clientWidth;
      // Nothing to scroll — the steps fit. Leave the row alone rather than
      // fighting `justify-content: safe center`.
      if (max <= 0) return;
      // MEASURE AGAINST THE ROW, NOT THE OFFSET PARENT. `step.offsetLeft` is
      // relative to the nearest POSITIONED ancestor, and this scroller is not
      // positioned — so the number it returns carries however far the card sits
      // from `.app-shell-frame` (position: fixed) or any other positioned
      // wrapper up the Activity tree. That distance is pure error in a scroll
      // offset: add a few hundred pixels of it and `target` exceeds `max` for
      // EVERY step, the clamp pins the row to its right-hand end whatever the
      // job is doing, and the auto-scroll silently stops tracking the current
      // step. Measured here (320px card) the parent offset was already 12px.
      // Rect deltas are relative to the row itself and cannot pick that up.
      const target =
        step.getBoundingClientRect().left -
        row.getBoundingClientRect().left +
        row.scrollLeft -
        (row.clientWidth - step.offsetWidth) / 2;
      const left = Math.max(0, Math.min(target, max));
      if (Math.abs(row.scrollLeft - left) < 1) return;
      row.scrollTo({
        left,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    };

    centre();
    const raf = requestAnimationFrame(centre);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(centre) : null;
    ro?.observe(row);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [displayIdx, displaySteps.length]);

  // Edge fade. A step that straddles the card edge used to read as chopped
  // text ("On the W…"), giving no clue the row scrolls. A mask feathers
  // whichever edge still has content behind it — and ONLY that edge, so a row
  // that fits (or is scrolled to an end) isn't dimmed for no reason.
  const [edges, setEdges] = useState({ start: false, end: false });
  // WHICH STEPS THE VIEWPORT IS CUTTING THROUGH, as a comma-joined index list
  // (a string, not a Set, so the identity comparison below can cheaply skip the
  // re-render on the ~60 scroll events a single flick produces).
  //
  // The mask alone never solved this. The owner's screenshot reads "ifirmed"
  // where "Confirmed" should be: a 36px fade over a step whose visible sliver
  // is wider than the fade leaves most of the word at full contrast, and
  // widening the fade only dims the WHOLE-step neighbour instead. A chopped
  // word is not a legible affordance for "this scrolls" — it reads as a
  // rendering fault, which is how it was reported. So the fade keeps doing what
  // it is good at (feathering the DOT) and the label of a step the edge cuts is
  // simply not painted.
  //
  // `opacity: 0`, deliberately, not `visibility: hidden` or conditional
  // rendering: the row is a labelled `role="group"` whose only text is these
  // labels, and both of those would drop the step out of the accessibility
  // tree — a screen reader would hear six steps out of seven, changing as the
  // row scrolls. Opacity is invisible to the eye and invisible to the a11y
  // tree's pruning.
  const [clippedSteps, setClippedSteps] = useState("");
  useEffect(() => {
    const row = stepRowRef.current;
    if (!row) return;
    const sync = () => {
      const max = row.scrollWidth - row.clientWidth;
      setEdges((prev) => {
        const start = row.scrollLeft > 1;
        const end = row.scrollLeft < max - 1;
        return prev.start === start && prev.end === end ? prev : { start, end };
      });
      const rowLeft = row.getBoundingClientRect().left;
      const cut: number[] = [];
      for (let i = 0; i < row.children.length; i++) {
        const r = (row.children[i] as HTMLElement).getBoundingClientRect();
        // Half a pixel of tolerance: sub-pixel layout must not flag a step that
        // is, to the eye, entirely on screen.
        if (r.left < rowLeft - 0.5 || r.right > rowLeft + row.clientWidth + 0.5) cut.push(i);
      }
      const key = cut.join(",");
      setClippedSteps((prev) => (prev === key ? prev : key));
    };
    sync();
    row.addEventListener("scroll", sync, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(row);
    return () => {
      row.removeEventListener("scroll", sync);
      ro?.disconnect();
    };
  }, [displaySteps.length]);

  // A half-cut 68px step leaves ~34px of label showing, so a 20px fade ended
  // BEFORE the cut text and the label still read as hard-clipped — measured on
  // an iPhone 17 Pro, the row showed a crisp "ed" (Accepted) at the left edge
  // and "W" (Working) at the right. 36px covers the sliver a half-cut step
  // actually leaves, which is what the fade was for.
  const FADE = "36px";
  const stepRowMask = `linear-gradient(to right, transparent 0, black ${edges.start ? FADE : "0px"}, black calc(100% - ${edges.end ? FADE : "0px"}), transparent 100%)`;

  if (!helperId && !includePostingSteps) return null;

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
      {(() => {
        // ONE scrolling line, seven steps (owner: "the live tracker should be
        // 1 scrollable line"). It was previously a 4 + 3 wrapping grid, which
        // was itself a fix for an earlier scroller that sliced whatever step
        // straddled the card edge — the reported "On the W".
        //
        // That slicing is why every step has a FIXED width and `shrink-0`
        // rather than being sized by its label: the row can only ever be cut
        // between steps, never through one, so no label is clipped mid-word at
        // any width. `snap-x`/`snap-center` land the scroll on whole steps for
        // the same reason.
        return (
          // The mask lives on this NON-SCROLLING wrapper, not on the scroller
          // itself. Measured on device: the row reported sw=652 cw=260, and
          // WebKit sizes a mask on a scroll container to its SCROLLABLE
          // CONTENT, not its visible box — so `calc(100% - 36px)` put the fade
          // at x≈616 of 652, permanently scrolled out of sight. The fade was
          // being painted correctly and could never be seen, which is why
          // widening it from 20px to 36px changed nothing. On a wrapper that
          // does not scroll, 100% is the visible 260px and the fade lands on
          // the edges the user is actually looking at.
          <div
            className="-mx-1 px-1"
            style={{ maskImage: stepRowMask, WebkitMaskImage: stepRowMask }}
          >
          <div
            ref={stepRowRef}
            // A scrolling region must be keyboard-reachable or axe's
            // `scrollable-region-focusable` fails — arrow keys need somewhere
            // to land now that content can sit off-screen. The group role +
            // label keep it announcing as "Job progress, group" rather than
            // seven loose fragments.
            tabIndex={0}
            role="group"
            aria-label="Job progress"
            className="flex gap-1 overflow-x-auto scrollbar-hide snap-x py-0.5 items-start"
            // `safe center` — the row centres in its card when the steps FIT,
            // and falls back to start-aligned the moment they don't (owner:
            // "center better globally"). Plain `center` would keep centring
            // while overflowing, which pushes the first steps off the LEFT edge
            // where no scroll gesture reaches them — the bug the `safe` keyword
            // exists for. Eight steps at 68px fit a desktop card and overflow a
            // phone one, so this row is on both sides of that line depending on
            // the screen, and neither alignment alone is right for both.
            style={{ justifyContent: "safe center" }}
          >
            {displaySteps.map((s, idx) => {
              const isActive = idx <= displayIdx;
              // The row's viewport is cutting through this step — see `clippedSteps`.
              const isClipped = clippedSteps !== "" && clippedSteps.split(",").includes(String(idx));
              const isCurrent = idx === displayIdx;
              const isPassed = idx < displayIdx;
              // Whole tracker reached the end — every active step reads as
              // done, current dot included (owner: "if it reaches Done, all
              // green").
              const allDone = displayIdx === displaySteps.length - 1;
              // THE ALARM SITS ON THE STEP THE DISPUTE STOPPED THE JOB AT.
              //
              // This was `jobStatus === "disputed" && s.key === "working"` — a
              // hard pin on Working, written to survive a rail that had run
              // PAST Working onto a green Done. `deriveCurrentStatusIdx` now
              // clamps a disputed job to Working, so that overshoot cannot
              // happen and the pin has nothing left to survive; what it could
              // still do was paint a solid red dot on a Working step the job
              // never reached (a dispute may be raised from `accepted` —
              // 20260825190000's transition table), which is the same class of
              // lie as the green Done, just in the other direction.
              //
              // Anchored to `displayIdx` instead, it lands on Working for
              // every disputed job that got as far as the work — the reported
              // case, unchanged — and on the actual step otherwise. And
              // because it can only ever be the CURRENT step, there is exactly
              // one alarm dot and it never fights the amber current-step tone
              // for a second "you are here".
              const disputedStep = jobStatus === "disputed" && idx === displayIdx;
              // THE CURRENT STEP CARRIES THE TROUBLE. A job in revision or in
              // dispute used to paint the same bark green as one running
              // perfectly, so the tracker — the biggest thing on the card —
              // was the one element that never said anything had gone wrong.
              // Amber for a resolution pending (not yet escalated), red for a
              // dispute (owner). Only the CURRENT dot changes here — the
              // steps behind it really did happen and recolouring the whole
              // line would read as "none of this counts" — except Working
              // under an open dispute, and Done once the whole job is green.
              // ONE GREEN, ONE AMBER, ONE RED — the owner's rule, and it
              // replaces two separate defects that were both live:
              //
              //   "Shouldn't be 2 different green. Yellow if they're on that
              //    step until they're done that step."
              //   "Both can't be red."
              //
              // The old scheme painted completed steps --success-ink and the
              // CURRENT step --bark. Two greens a shade apart read as the same
              // colour at a glance, so the current step — the one thing the
              // rail exists to tell you — did not stand out at all.
              //
              // And red had two sources that could both fire on one card: the
              // dispute pin (above) painted Working red wherever the cursor
              // was, while this branch painted the CURRENT step red under a
              // dispute. A disputed job carrying a completion stamp parked on
              // `done`, so Working AND Done both went alarm red — exactly the
              // screenshot the owner sent.
              //
              // Now: amber is "you are on this step, it is not finished", red
              // is ONLY "this is the step that went wrong" (`disputedStep`),
              // and green is only ever a step that genuinely completed. The
              // two can no longer disagree about where the job is: red is
              // defined AS the current step of a disputed job, so red simply
              // replaces the amber on that one dot — one "you are here"
              // marker, in the more urgent colour.
              //
              // THE GREEN IS THE BUTTON'S GREEN (owner, 2026-09-19: "the
              // posted offered accepted etc buttons should all be the same
              // primary green as the buttons not a different shade").
              //
              // It was `--success-ink` — `142 50% 30%`, an EMERALD — beside a
              // primary button built from `--bark` `70 20% 33%`, an OLIVE.
              // Two different hues, 72° apart, sitting 8px from each other on
              // the same card; "a different shade" is generous.
              //
              // WHICH green, given the button is a radial GRADIENT
              // (`.btn-grad-primary`: --bark-light 0% → --bark 46% →
              // --bark-deep 100%)? `--bark`, the gradient's own dominant mid
              // stop — not the class. Putting `.btn-grad-primary` on a 28px
              // dot would paint it with a `125% 125% at 32% 22%` radial whose
              // visible area is almost entirely the LIGHT stop, so the dot
              // would read lighter than the button it is supposed to match.
              // Matching the token the gradient is built from is what makes
              // the two the same green to the eye. Guard:
              // src/test/railGreenMatchesPrimary.test.ts.
              // EXTRACTED, 2026-09-19. The rule used to be written out here
              // and TRANSCRIBED into alarmColourInvariant.test.ts, which said
              // so and carried a second test to notice when the copy went
              // stale. The collapsed card now paints the same dots at 16px
              // (JobStepRailCompact), and a second rail meant a third copy —
              // so both rails and the guard read `railStepPaint`
              // (src/components/activity/jobRailTone.ts). "Same colour
              // vocabulary as the expanded rail" is now true by construction.
              const paint = railStepPaint({
                idx,
                displayIdx,
                stepCount: displaySteps.length,
                jobStatus,
              });
              const Icon = s.icon;
              const ts = stepTimestamps[s.key];
              // Tooltip only on a genuinely COMPLETED step (passed, or the
              // final Done step once the whole job is green) that has a
              // timestamp to show — never on the still-in-progress current
              // step, which has no "when" yet.
              const showTooltip = !!ts && (isPassed || (isCurrent && allDone));
              const Wrapper = showTooltip ? "button" : "div";
              return (
                <div
                  key={s.key}
                  // `grow` on a `w-[68px] shrink-0` basis: the steps SHARE any
                  // spare width instead of huddling in the middle of a wide
                  // card (owner: "spread out more to fill space"), and the
                  // moment the row is narrower than 8 × 68px they stop growing,
                  // hold their width and scroll — `shrink-0` is what keeps a
                  // label from being squeezed into a hyphenated column.
                  className="w-[60px] shrink-0 grow snap-center flex flex-col items-center gap-1 relative"
                >
                  <Wrapper
                    {...(showTooltip
                      ? {
                          type: "button" as const,
                          onClick: (e: ReactMouseEvent) => {
                            e.stopPropagation();
                            setOpenStepTooltip((k) => (k === s.key ? null : s.key));
                          },
                          onMouseEnter: () => setOpenStepTooltip(s.key),
                          onMouseLeave: () => setOpenStepTooltip((k) => (k === s.key ? null : k)),
                          "aria-label": `${s.label} — ${new Date(ts as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
                        }
                      : {})}
                    // `relative` is for the 44px hit overlay below; it does not
                    // affect the tooltip, which is absolutely positioned
                    // against the COLUMN (the outer div), not against this dot.
                    className={`relative w-7 h-7 rounded-full flex items-center justify-center transition-all !min-h-0 !min-w-0 ${isCurrent && !disputedStep ? "step-current-pulse" : ""}`}
                    /* ONE SOURCE for every dot's colour — `railStepPaint`
                       above. The five-branch ternary this replaces held the
                       alarm, the amber cursor, the completed green (which is
                       `--bark`, the primary button's green, owner 2026-09-19),
                       the bark tint and the not-reached grey; all five moved
                       into jobRailTone.ts verbatim and nothing about which
                       step wears which changed. The ring and the pulse
                       variables stay here because they are this rail's
                       DRAWING, not its colour rule — the compact rail draws
                       its own, smaller. */
                    style={
                      isCurrent && paint.ring
                        ? ({
                            background: paint.fill,
                            color: paint.ink,
                            boxShadow: `0 0 0 2px ${paint.ring}, 0 0 0 4px hsl(var(--parchment))`,
                            "--step-pulse-ring": paint.ring,
                            "--step-pulse-ring-end": paint.ringEnd,
                          } as CSSProperties)
                        : { background: paint.fill, color: paint.ink }
                    }
                  >
                    {/* A 44px TAP TARGET WITHOUT A 44px BOX — the same trick
                        `.link-standard` and `.tap-44` use in index.css, done
                        inline because the overlay has to be square rather than
                        full-width.

                        The dot is 28×28 and defeats the global 44px floor with
                        `!min-h-0 !min-w-0`, which is correct for the DRAWING:
                        seven 44px circles do not fit a 320px card, and growing
                        the box would push the row past the height the owner
                        just reclaimed by deleting the progress bar. So the box
                        stays 28px and the hit region — the thing WCAG 2.5.5
                        actually measures — is an invisible 44×44 child.

                        It extends DOWNWARD from the dot's top edge, never
                        upward: `overflow-x: auto` on the step row computes
                        `overflow-y` to `auto`, and content above the block-start
                        edge is clipped rather than reachable, so a centred
                        overlay would have lost its top 6px. Downward it lands
                        over this step's own label — 44px is shorter than the
                        column, so it never reaches a neighbour's dot, and the
                        label is not interactive. Only on the tooltip steps: a
                        plain <div> step has nothing to hit. */}
                    {showTooltip && (
                      <span
                        aria-hidden
                        className="absolute left-1/2 top-0 -translate-x-1/2 w-11 h-11"
                      />
                    )}
                    <Icon className="w-3.5 h-3.5" />
                  </Wrapper>
                  {/* Tap/hover tooltip on a completed step, showing when it
                      happened. `showTooltip` gates this to steps that both
                      have a timestamp and are actually done — see the
                      Wrapper/showTooltip logic above. */}
                  {showTooltip && openStepTooltip === s.key && (
                    <div
                      role="tooltip"
                      className="absolute top-8 z-20 px-2 py-1 rounded-ds-md text-ds-9 font-sans font-semibold whitespace-nowrap pointer-events-none"
                      style={{
                        background: "hsl(var(--ink-deep))",
                        color: "hsl(var(--parchment))",
                        boxShadow: "0 4px 14px -4px hsl(var(--ink-deep) / 0.4)",
                      }}
                    >
                      {new Date(ts as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  )}
                  <span
                    // ds-9 below 360px so "Confirmed" — the longest unbreakable
                    // label — still fits its column on a 320px phone.
                    //
                    // `w-full` is load-bearing. Without it the span sized to its
                    // TEXT, not to the 68px column, so a wider label ("On the
                    // Way") spilled out of its own step and got sliced by the
                    // row's edge — the crisp "ed" and "W" the owner reported.
                    // The comment above this row claims a step "can only ever
                    // be cut between steps, never through one"; that was only
                    // true of the step BOX, never of the label inside it.
                    // Constrained to the column, a long label wraps within its
                    // own step and the edge mask feathers whole steps as
                    // intended.
                    //
                    // `min-h-[2.5em]` RESERVES BOTH LINES ON EVERY STEP.
                    // "On the Way" is the one label that does not fit a 60px
                    // column on one line, so it — and only it — wrapped to two.
                    // Measured at 500px: that column stood 61px tall against 47
                    // for the other seven, and because the row is `items-start`
                    // the extra 14px hung below its neighbours, so a row of
                    // eight identical steps visibly sagged under one of them.
                    // Reserving two lines' height makes every column the same
                    // height whichever label happens to wrap, at the same cost
                    // the tallest one was already imposing on the row.
                    //
                    // 2.9em, NOT 2.5em: the line box here is 1.45× the font
                    // size, not the 1.25 `leading-tight` implies — `text-ds-9`
                    // and `text-ds-10` each ship `lineHeight: "1.45"` in
                    // tailwind.config.ts and win, and `html.senior-mode` keeps
                    // 1.45 too. 2.5em undershot the real two-line box by 4px
                    // and left the row still visibly uneven; 2 × 1.45 lands it
                    // exactly, and being em-relative it holds at ds-9, ds-10
                    // and senior-mode alike.
                    className="w-full min-h-[2.9em] text-ds-9 min-[360px]:text-ds-10 font-sans font-semibold text-center leading-tight"
                    style={{
                      color: isCurrent
                        ? "hsl(var(--bark))"
                        : isActive
                          ? "hsl(var(--ink-deep))"
                          : "hsl(var(--olivewood) / 0.80)",
                      // Half a word is not a label — see `clippedSteps`.
                      opacity: isClipped ? 0 : undefined,
                    }}
                  >
                    {s.label}
                  </span>
                  {/* ETA rides UNDER ITS OWN STEP (owner: "put eta under on
                      the way"). It used to be a centred paragraph below the
                      map, a full card-width away from the word it qualifies —
                      so "On the Way" and "~12 min" were two unrelated-looking
                      facts and the reader had to join them. Here the number is
                      the step's own caption.

                      Only this step, only while the helpr is actually en
                      route, so no other column ever gains a third line and the
                      row keeps the tight rhythm the heading-name move bought
                      it. `items-start` on the row means the taller column
                      hangs below the others rather than pushing them down. */}
                  {/* ARRIVED CARRIES NO CAPTION AT ALL NOW (owner,
                      2026-09-16: "remove awaiting confirmedation from under
                      confirmation. tehy can click arrived or toggle to see why
                      its yellow"). The settled facts left first (VN-20:
                      "Location confirmed does not need to show on the tracker,
                      it should be on the map" — they ride on the map's job pin,
                      or on the status line when no map is drawn); the open
                      "Awaiting confirmation" question has now followed them.
                      What is left saying it is the step's AMBER COLOUR, which
                      is unchanged and deliberate, plus the step's own tap.

                      The slot below is kept, not deleted: `arrivalStateLabel`
                      is the one place that decides whether a caption is owed,
                      so it returns `null` today and a future label would land
                      here and nowhere else. */}
                  {/* Only while Arrived is still the CURRENT step. Once the
                      job progresses past it (Working, Done, …) the caption
                      went stale — a job sitting on "Working" still showed
                      "Poster confirmed" frozen under Arrived, which no
                      longer told the reader anything they didn't already
                      know from the step being lit. */}
                  {s.key === "arrived" && idx === displayIdx && arrivalCaption && (
                    <span
                      className="w-full text-ds-9 font-sans font-semibold text-center leading-tight"
                      style={{
                        color:
                          currentArrivalState === "claimed"
                            ? "hsl(var(--amber-ink))"
                            : "hsl(var(--bark))",
                        opacity: isClipped ? 0 : undefined,
                      }}
                    >
                      {arrivalCaption}
                    </span>
                  )}
                  {/* THE ETA IS NO LONGER A THIRD LINE HERE (owner,
                      2026-09-11: "move 12 min into the line below"). It now
                      rides in the status line beneath the whole tracker,
                      alongside "Location shared · 0.4 mi from the job" — see
                      the ETA clause down there.

                      This reverses the earlier "put eta under on the way"
                      placement, and the reason that placement existed still
                      holds — the number belongs NEXT TO the words it
                      qualifies, not a card-width away. The status line
                      satisfies that just as well: it is the other live fact
                      about where the helper is, so "on the way, ~12 min,
                      0.4 mi out" now reads as one sentence instead of the
                      distance and the ETA sitting in two places. What it
                      also buys is a tracker row where no column is ever
                      taller than the others, which is what made "On the Way"
                      wrap to two lines and hang below its neighbours. */}
                </div>
              );
            })}
          </div>
          </div>
        );
      })()}

      {/* Progress bar/fill-line REMOVED (owner, 2026-08-30) — the step icons
          already convey progress on their own; a second bar duplicating the
          same "how far along" signal directly beneath them was redundant. */}

      {/* Last update — directly below the step row (used to sit below the
          removed progress bar; the freshness stamp still closes the tracker
          it vouches for). */}
      {tracking && (
        <p className="text-ds-10 text-muted-foreground text-center">
          {/* NO NAME IN FRONT OF "Updated" (owner, 2026-09-16: "remove the
              name to the left of updated"). The stamp used to open with the
              Helpr's first name on the poster's card — "Hallie · Updated 4:12
              PM" — from when the tracker's heading row was dropped and the
              name had to land somewhere. It does not have to land here: the
              expanded card now carries the Helpr as a PersonTile of their own
              (VN-22), so this line was the second print of one name. */}
          Updated {new Date(tracking.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {/* THE PROOF CLAUSE. Derived from `arrivalState()` — the same single
              input as the unverified-arrival toast, the completion gate and
              the DB trigger — so the line can never again say "GPS confirmed"
              directly beneath a toast saying we could not confirm it. See
              `trackingProofCaption` above for the four states and why the
              distance stays but the word "confirmed" does not.

              Still only rendered when there is something to say: a position to
              report, or an arrival claim from `arrived` onward whose absence of
              a position is itself the fact. */}
          {(() => {
            const hasPosition = tracking.latitude != null;
            // VN-20: while the map's job pin carries the settled arrival, this
            // line keeps the location and drops the verification clause.
            const trackingIdxHere =
              STATUS_IDX[tracking.status as keyof typeof STATUS_IDX] ?? -1;
            if (!hasPosition && trackingIdxHere < STATUS_IDX.arrived && currentArrivalState === "none") {
              return null;
            }
            const mi =
              hasPosition &&
              jobLatitude != null &&
              jobLongitude != null &&
              tracking.longitude != null
                ? haversineMiles(tracking.latitude!, tracking.longitude, jobLatitude, jobLongitude)
                : null;
            const proof = trackingProofCaption(currentArrivalState, mi, hasPosition, arrivalOnMap);
            const Glyph = proof.tone === "warn" ? AlertTriangle : MapPin;
            return (
              <span
                className={`ml-2 inline-flex items-center gap-0.5${proof.tone === "warn" ? " font-semibold" : ""}`}
                style={proof.tone === "warn" ? { color: "hsl(var(--amber-ink))" } : undefined}
              >
                <Glyph className="w-2.5 h-2.5 shrink-0" />
                {proof.text}
              </span>
            );
          })()}
          {/* ETA, moved here off the "On the Way" step (owner, 2026-09-11:
              "move 12 min into the line below"). Same guard as before — only
              while the helper is genuinely en route and the server has an
              estimate — so this line never carries a stale number once they
              have arrived. `tabular-nums` keeps the digits from reflowing the
              line as the estimate ticks down. */}
          {tracking?.status === "on_the_way" && tracking.eta_minutes != null && (
            <span
              className="ml-2 inline-flex items-center gap-0.5 tabular-nums font-semibold"
              style={{ color: "hsl(var(--bark))" }}
            >
              ~{tracking.eta_minutes} min
            </span>
          )}
        </p>
      )}

      {/* NO TRACKING ROW, SETTLED ARRIVAL, ARRIVED IS THE CURRENT STEP.
          The status line above only exists once a `job_tracking` row does,
          and the map needs one too — but the arrival stamps live on the jobs
          row (a poster's "Confirm They Arrived", or a job whose tracking row
          was never written). When the Arrived step carried "Poster confirmed"
          itself this case still said something; with that caption moved to
          the map (VN-20) it would have said nothing at all. So the fact gets
          the status line's own slot and wording, scoped to exactly when the
          old caption showed (Arrived is the current step). */}
      {!tracking &&
        settledArrivalLabel != null &&
        displaySteps[displayIdx]?.key === "arrived" && (
          <p
            className="text-ds-10 text-muted-foreground text-center"
            data-testid="arrival-fact-fallback"
          >
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {trackingProofCaption(currentArrivalState, null, false).text}
            </span>
          </p>
        )}

      {/* THE OTHER PARTY IS NO LONGER DRAWN HERE. It sat between the rail and
          the map for three days (owner, 2026-09-16) and the owner has moved it
          again, to directly above the action row (2026-09-19). See the note
          where the `personTile` prop used to be declared. */}

      {/* Tracking map — KEPT UNTIL DONE (owner, 2026-09-14: "Keep map until
          done"; was en-route only). Shown from On the Way through Arrived and
          Working while both positions are known (`shouldShowTrackingMap`),
          for the Helpr and the poster alike, and hidden once the job is
          marked done. Past On the Way the helper pin is the last ping on the
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
         * src/test/jobsGuardRpcParity.test.ts). So "I'm On My Way" must never
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
          // Measured from the real START, not from midnight of the job's
          // day. Off midnight, an evening job's window opened up to 18 hours
          // early and this line promised a control that was not there yet.
          const confirmOpen =
            !startAt || startAt.getTime() - Date.now() <= 24 * 3_600_000;
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
        // card's "Mark Fixed" → poster accepts). The tracker caps its index
        // at Working in this state, which made its next-step button "Done" —
        // so the card offered Done, "I'll Fix It" and "Mark Fixed" at once,
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
        // old gate let a helper tap "On the Way" at 7 AM for an 8 PM job,
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
                return `Actions unlock at ${unlockAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zoned })}${dateSuffix}`;
              })()
            : `Actions available on ${formatShortDate(jobDay!)}`
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
        // `arrivalGateMessage` names "Confirm They Arrived" and whose tap it is,
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
         * The state the GPS encouragement and the "Try My Location Again"
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
        // "Confirm They Arrived" tap, which is the way out.
        // The proof-photo gate, at RENDER time rather than only on click.
        // A state sweep found the two money controls disagreeing in 17 frames:
        // this CTA rendered an ENABLED "Request My Payout" (now "Mark Job Complete") while
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
              ?? (needsProof ? requiredProof({ require_photo_proof: requirePhotoProof ?? true }).reason : null);
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
         * ONE TAP is the "Try My Location Again" button rendered directly below
         * it (`retryEl`), which re-runs the permission pre-prompt and the fix.
         * Same gate as that button, deliberately: a line about turning Location
         * on, with no control on screen, is worse than no line at all.
         *
         * ONE SENTENCE, AND ONLY THE BENEFIT (owner, 2026-09-19, final browser
         * gate: "amber says what is BLOCKING; muted says why GPS helps. Nothing
         * else"). It used to run three sentences and end by naming the button
         * directly beneath it — while the amber line above ALSO said "turn
         * Location on" and ALSO named "Try My Location Again". Ten lines of
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
         * stacked 11px chips — "Message" and "I'm On My Way" side by side as
         * two different kinds of object, which is the screenshot the owner sent
         * twice. `JobStepPrimaryButton` is that one object; nothing about the
         * gates, the busy state or the confirm dialog moves. */
        const ctaEl = (
          <JobStepPrimaryButton
            icon={nextStatus.icon}
            // The ACTION, not the step's name — see STATUSES. After a
            // refused arrival the same tap is a retry, so it says so.
            label={arrivalRefusedHere ? "Try My Location Again" : (nextStatus.action ?? nextStatus.label)}
            // Done asks first — see the dialog below. Every other step is a
            // reversible statement about where the helper is; this one moves
            // money and cannot be taken back from here.
            onClick={() => {
              if (isDoneStep) setConfirmDoneOpen(true);
              else void updateStatus(nextStatus.key);
            }}
            // SAME OBJECT, SAME DISABLED STATE (jobRowControlSameness). The
            // before-photo gate adds a reason, not a new kind of control: a
            // control that LOOKED pressable and then failed on tap with a toast
            // is the shape the comment above `needsProof` records as the worse
            // half to get wrong, and it is not coming back for this gate.
            disabled={updating || isLocked || needsArrival || needsBeforePhoto || needsProof}
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
                title="Mark This Job Complete?"
                description="This tells the person who posted this job that the work is finished and starts the clock on your payment."
                primaryLabel="Mark Complete"
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
                  The person who posted this job gets {COPY_AUTO_RELEASE_HOURS} hours to approve the work or ask for a change. If they don’t answer, your payment releases to you automatically. You can’t take this back from here.
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
        if (inStepRow) {
          return (
            <>
              <JobStepRowSlot slot="note">{reasonEl}</JobStepRowSlot>
              {/* ONE control in this slot again. It briefly held two — the
                  glossy CTA and the outline "Try My Location Again" — and the
                  ordering comment here existed only to keep the green one
                  right-most (owner, 2026-09-16). The retry chip is gone
                  (owner, 2026-09-19; the refresh gesture does it now, see
                  src/lib/arrivalRefresh.ts), so there is nothing left to
                  order. `primaryNeeds` in jobStepRow.tsx still takes an ARRAY
                  because the day-of confirmation can put a second control here
                  through its own slot — that case is unaffected. */}
              <JobStepRowSlot slot="primary">{ctaEl}</JobStepRowSlot>
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
