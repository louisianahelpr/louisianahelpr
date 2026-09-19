import { assertNever } from "@/lib/assertNever";
import type { Job } from "../../activityConstants";

/**
 * What a step of the POSTER's job card is handed.
 *
 * The mirror of the helper card's `HelperStepProps`, and deliberately the same
 * shape of thing: one container (PostedJobActions) owns everything that
 * outlives a step — the dispute RPCs and their confirm state, the completion
 * sheet, the poster's own instant-release flag — and each step is handed the
 * context it needs and nothing else.
 *
 * The two sides share the SHELL (`JobStepCard`), not this. Their content
 * genuinely differs — the poster approves and releases money, the helper does
 * the work and requests it — so what differs is what fills the slots.
 */
export interface PosterStepCtx {
  job: Job;
  userId: string;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  unfunded: boolean;
  completingJobId: string | null;
  confirmingArrivalJobId: string | null;
  confirmingWorkingJobId: string | null;
  /** The poster's own auto-release setting; changes what the wait is called. */
  instantReleaseOn: boolean;
  navigate: (to: string) => void;
  onBoost: (jobId: string) => void;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  onReport: (job: Job) => void;
  onViewDispute: (job: Job) => void;
  onConfirmArrival: (jobId: string) => void;
  onConfirmWorking: (jobId: string) => void;
  onActionComplete: () => void;
  /** Completion sheet — owned by the container so a re-render of the step
   *  cannot close it. */
  completionSheetOpen: boolean;
  setCompletionSheetOpen: (open: boolean) => void;
  /** Dispute controls, all container-owned for the same reason. */
  disputeActing: boolean;
  resolveConfirmOpen: boolean;
  setResolveConfirmOpen: (open: boolean) => void;
  escalateConfirmOpen: boolean;
  setEscalateConfirmOpen: (open: boolean) => void;
  escalateDispute: () => void;
  resolveDisputeAndRelease: () => void;
}

/** Which step of the poster's card a job is on. */
export type PosterStepId = "open" | "scheduled" | "in_progress" | "completed" | "disputed";

export function derivePosterStep(status: Job["status"]): PosterStepId | null {
  switch (status) {
    case "open":
      return "open";
    case "accepted":
      return "scheduled";
    case "in_progress":
    case "revision_requested":
      return "in_progress";
    case "completed":
      return "completed";
    case "disputed":
      return "disputed";
    // Both render no actions at all — see STATUS_RENDERS_ACTIONS in
    // PostedJobActions, the gate that keeps an empty bordered band off these
    // cards. Named rather than defaulted so a new enum member is a build error
    // here too (src/test/jobStatusExhaustive.test.ts).
    case "pending_approval":
    case "cancelled":
      return null;
    default:
      return assertNever(status);
  }
}

/* ───────────────────────── THE POSTER'S CONFIRMATION LADDER ─────────────────
 *
 * Owner, 2026-09-19: "on poster i see no button to confirm they arrived, are
 * working, confirmed offered. if it was clicked already it should still show
 * but with the box disabled, or the next box once they are ready to move on."
 *
 * The two vouches EXISTED and were unit-locked; what they were not is VISIBLE.
 * Both gates were written as "show only while this is the one thing to do"
 * (`!poster_confirmed_arrival_at`, `!poster_confirmed_working_at`), so the
 * moment the poster tapped, the control vanished and the card looked like it
 * had never offered one. Three separate states rendered NOTHING at all:
 *
 *   - nothing to confirm yet (the Helpr has not arrived) — no box;
 *   - the tap already made — no box;
 *   - the Helpr's location check refused (VN-33) — no box, forever. See the
 *     deadlock note on `arrivalBlockedReason` below.
 *
 * So this is ONE ladder with exactly ONE rung showing at a time, and a rung is
 * never missing while the ladder is live: disabled-with-a-reason before it can
 * be taken, enabled when it can, and a done-toned box once it has been. The
 * one-row contract (JobStepCard, VN-21) is why it is one control and not two
 * persistent chips — two would overflow the row at 375.
 *
 * WHAT THIS DOES NOT DO: it never enables a confirmation that was not already
 * enabled. Every `enabled: true` below is the step's own pre-existing gate,
 * moved here verbatim. The arrival gate is GPS **and** poster-confirm
 * (`src/lib/arrivalGate.ts`, VN-33) and stays that way.
 */

/** The poster's box, as the card should draw it right now. */
export interface PosterConfirmRung {
  /** Which confirmation this is — `null` once there is nothing left to take. */
  action: "arrival" | "working" | null;
  label: string;
  enabled: boolean;
  /** Already taken: the done tone, not a greyed primary (JobActionRow `done`). */
  done: boolean;
  /** The one honest line under the row while the box is disabled and not done. */
  reason: string | null;
  /** A GATE (something must happen first) rather than an ordinary WAIT —
   *  amber, exactly as JobTracking styles its own blocked-CTA reasons. */
  gate: boolean;
}

/** VN-33(b): the Helpr was refused as a little too far from a pin that may be
 *  wrong (within a mile, last 12h). The poster at the real door is the one who
 *  can say they are there. Same 12h window as the trigger. Lives here so the
 *  ladder and the No-Show gate cannot drift apart. */
export function recentArrivalNearMiss(job: Job): boolean {
  const at = (job as { helper_arrival_near_miss_at?: string | null }).helper_arrival_near_miss_at;
  return !!at && Date.now() - new Date(at).getTime() < 12 * 3_600_000;
}

/**
 * WHY THE ARRIVAL BOX IS DISABLED — and it must be the truth.
 *
 * THE DEADLOCK THIS SURFACES (VN-33, `mark_helper_arrival` since
 * 20260915044137): a far or fix-less arrival is REFUSED and writes nothing, so
 * `helper_arrived_at` stays null. The Helpr's own next step is then blocked
 * with copy naming the poster's "Confirm They Arrived" tap as the way out —
 * while that control was gated on `helper_arrived_at` and so never rendered.
 * Each side sat waiting for the other, and the poster's side said nothing at
 * all.
 *
 * The box is still DISABLED: the gate is GPS **AND** poster-confirm, and
 * `src/lib/arrivalGate.test.ts` holds the refusal copy to never offer one as a
 * substitute for the other. What changes is that the poster can now see the
 * box and read why it is not theirs to tap yet.
 */
function arrivalBlockedReason(job: Job, step: PosterStepId): { reason: string; gate: boolean } {
  if (step === "scheduled" && !job.helper_confirmed_at) {
    return {
      // A WAIT, not a gate: nothing is stuck, the booking simply isn't settled.
      reason: "Your Helpr hasn't confirmed this booking yet — you'll be able to confirm they arrived once they're at the job.",
      gate: false,
    };
  }
  if (!job.helper_on_the_way_at) {
    return {
      reason: "You'll be able to confirm this once your Helpr is at the job.",
      gate: false,
    };
  }
  return {
    // The honest deadlock line. It names what is stuck, whose move it is, and
    // what clears it — and it offers the poster no way around the location
    // check, because there isn't one.
    reason: "Waiting on your Helpr's location check — their phone hasn't put them at the job yet. They can retry it from their side, and this unlocks the moment it goes through.",
    gate: true,
  };
}

/**
 * The ONE box the poster's card should draw right now, or `null` where the
 * ladder has nothing to say.
 *
 * Takes the DERIVED step, never `job.status` (owner item 6b): both gates used
 * to test `job.status === "in_progress"` literally, so a job in
 * `revision_requested` — which `derivePosterStep` maps to the in-progress step
 * — lost BOTH confirmations outright.
 */
export function posterConfirmationRung(job: Job, step: PosterStepId): PosterConfirmRung | null {
  if (step !== "scheduled" && step !== "in_progress") return null;

  // Near-miss stands in for an arrival on the IN-PROGRESS step only — that is
  // where the gate already accepted it. Widening it to `scheduled` would be a
  // new enablement, which this refactor does not do.
  const arrivalClaimed = !!job.helper_arrived_at || (step === "in_progress" && recentArrivalNearMiss(job));

  let rung: PosterConfirmRung;
  if (!job.poster_confirmed_arrival_at) {
    // The step's own pre-existing gates, verbatim: scheduled also required the
    // booking's own `helper_confirmed_at`.
    const enabled = arrivalClaimed && (step === "in_progress" || !!job.helper_confirmed_at) && !job.helper_completed_at;
    const blocked = enabled ? null : arrivalBlockedReason(job, step);
    rung = {
      action: "arrival",
      // The two labels differ by step and always have. Reported, not silently
      // unified: "Confirm Arrival" is the scheduled card's wording.
      label: step === "scheduled" ? "Confirm Arrival" : "Confirm They Arrived",
      enabled,
      done: false,
      reason: blocked?.reason ?? null,
      gate: blocked?.gate ?? false,
    };
  } else if (step === "in_progress" && !job.poster_confirmed_working_at) {
    rung = {
      action: "working",
      label: "Confirm They're Working",
      enabled: true,
      done: false,
      reason: null,
      gate: false,
    };
  } else {
    rung = {
      action: null,
      label: step === "scheduled" ? "Arrival Confirmed" : "Working Confirmed",
      enabled: false,
      done: true,
      reason: null,
      gate: false,
    };
  }

  // ONCE THE HELPR HAS MARKED THE JOB DONE the poster's decision has moved on
  // to Approve, which is the row's real move — so a finished or blocked
  // confirmation box stands down rather than parking a dead control in the
  // primary slot beside it. An ENABLED rung is kept exactly as it was: this
  // removes nothing that was offered before.
  if (!rung.enabled && job.helper_completed_at) return null;
  return rung;
}

/**
 * Does the poster owe a confirmation they could take RIGHT NOW?
 *
 * For the COLLAPSED card (owner decision, 2026-09-19): the controls stay inside
 * the expanded card, but a collapsed card has to say that one is waiting —
 * that is the likeliest reason the owner saw "no button" at all. Exported as a
 * predicate so `PostedJobCard` wires one line and owns no rule of its own.
 */
export function posterOwesConfirmation(job: Job): boolean {
  const step = derivePosterStep(job.status);
  if (!step) return false;
  const rung = posterConfirmationRung(job, step);
  return !!rung?.enabled;
}
