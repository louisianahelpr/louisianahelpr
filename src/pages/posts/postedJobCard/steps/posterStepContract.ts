import { assertNever } from "@/lib/assertNever";
import {
  completionStalled,
  STALLED_APPROVE_DISABLED_LABEL,
  STALLED_APPROVE_DISABLED_REASON,
} from "../../../../../supabase/functions/_shared/stalledCompletion";
import type { Job } from "../../../../components/job-card/activityConstants";

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
 *   - the Helpr's location check refused (VN-33) — no box, forever. That third
 *     state no longer exists: since 20260919155016 `mark_helper_arrival` records
 *     the check-in on every call, so `helper_arrived_at` always lands and the
 *     box always arrives. See the deadlock note on `arrivalBlockedReason` below.
 *
 * So this is ONE ladder with exactly ONE rung showing at a time, and a rung is
 * never missing while the ladder is live: disabled-with-a-reason before it can
 * be taken, enabled when it can, and a done-toned box once it has been. The
 * one-row contract (JobStepCard, VN-21) is why it is one control and not two
 * persistent chips — two would overflow the row at 375.
 *
 * WHAT THIS DOES NOT DO: it never enables a confirmation that was not already
 * enabled. Every `enabled: true` below is the step's own pre-existing gate,
 * moved here verbatim.
 *
 * WHAT THE ARRIVAL BOX IS FOR, since the owner's 2026-09-19 reversal: it is now
 * THE gate, not half of one. `posterOwesArrivalConfirmation`
 * (`src/lib/arrivalGate.ts`) is `helper_arrived_at && !poster_confirmed_arrival_at`
 * — and note what is NOT in it: `helper_arrival_verified_at` and the near-miss
 * columns. This box must never be gated on either. A GPS-verified Helpr still
 * needs this tap ("even if gps does confirm they are there the poster still
 * needs ro cfnrm wither way"), and a Helpr with Location off must still be able
 * to get it.
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
  /**
   * THIS IS THE STALLED-JOB NOTICE, not a confirmation the poster could ever
   * take. Set only by the owner-item-7 branch at the bottom of
   * `posterConfirmationRung`.
   *
   * A discriminant rather than a label comparison, because a second control —
   * the "Why?" chip that carries `STALLED_APPROVE_DISABLED_DETAIL` — has
   * to appear on the SAME row under exactly this condition, and a card whose
   * chip and whose box disagreed would offer an explanation of a notice that
   * is not on screen (or hide the explanation of one that is).
   */
  stalled?: true;
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
 * THE DEADLOCK THIS USED TO SURFACE (VN-33, `mark_helper_arrival` between
 * 20260915044137 and 20260919155016): a far or fix-less arrival was REFUSED and
 * wrote nothing, so `helper_arrived_at` stayed null. The Helpr's own next step
 * was then blocked with copy naming the poster's "Confirm They Arrived" tap as
 * the way out — while that control was gated on `helper_arrived_at` and so
 * never rendered. Each side sat waiting for the other, and the poster's side
 * said nothing at all.
 *
 * THE DEADLOCK IS GONE (owner's 2026-09-19 reversal): the RPC records every
 * check-in, with or without a fix, so the only reason this box is still
 * disabled is that the Helpr has not said they are there yet. The last branch's
 * copy changed with it — it used to say "waiting on your Helpr's location
 * check", which after the reversal is simply not what anyone is waiting for.
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
    // On the way, not there yet. A WAIT, not a gate: nothing is stuck and
    // nobody has to do anything about it — the Helpr taps "I've Arrived" when
    // they get there and this box unlocks in the same moment.
    //
    // It used to read "Waiting on your Helpr's location check — their phone
    // hasn't put them at the job yet", in amber, which was true only while a
    // fix-less arrival was refused outright. After 2026-09-19 nothing waits on
    // a location check, and telling a poster their Helpr's phone has failed
    // something is a worry the app invented.
    reason: "Your Helpr is on the way — you'll be able to confirm this the moment they mark themselves arrived.",
    gate: false,
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
export function posterConfirmationRung(
  job: Job,
  step: PosterStepId,
  now: Date = new Date(),
): PosterConfirmRung | null {
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

  /* ── THE STALLED JOB (owner item 7, 2026-09-19) ───────────────────────────
   *
   * "like for 24 hours passed that needs to be deleted. that should have been
   * a button like work done but since they never clicked it it should be
   * disabled and say why."
   *
   * A job that reached `in_progress` and was never marked done by either side
   * showed the poster NOTHING: `InProgressStep`'s Approve chip is gated on
   * `helper_completed_at`, so with no completion stamp there was no control
   * and no explanation — and until `d738344c1` no sweep either, so the escrow
   * simply sat. This is the explanation, in the one place a step card puts a
   * control it cannot offer: a DISABLED box with the reason under it.
   *
   * IT IS THE CRON'S OWN PREDICATE (`completionStalled`, the module the sweep
   * runs on), so the card can never promise a window the sweep does not
   * enforce, and the two can never drift.
   *
   * PRECEDENCE — why this sits BELOW everything above it rather than at the
   * top of the function. Both this notice and the confirmation ladder want the
   * row's ONE primary slot (JobStepCard, jobStepOneRow.test.tsx), and the
   * ladder does NOT stand down on its own here: what stands it down is a
   * completion stamp, and a stalled job has neither. So the order is decided
   * once, in this one place, and it is decided by how SPECIFIC and how
   * ACTIONABLE each box is:
   *
   *   1. an ENABLED confirmation wins. It is a tap the poster can take right
   *      now, and taking it is how the job moves; a control the user can act
   *      on always outranks a notice they cannot.
   *   2. a DISABLED confirmation still wins, because its reason names an
   *      EARLIER and more specific link in the same chain. On a job whose
   *      Helpr never arrived, "your Helpr is on the way" is the truth and
   *      "your Helpr hasn't marked this job done yet" is close to a lie —
   *      nobody ever turned up to mark anything.
   *      Replacing a precise blocker with a vaguer one downstream of it makes
   *      the card less honest, not more; and that poster is not left without a
   *      move, because No-Show is a chip on the same row.
   *   3. otherwise — the ladder has nothing left to say (a FINISHED box, which
   *      is a fact the poster already knows) — the stalled notice takes the
   *      slot. That is exactly the state the owner described: everything went
   *      fine, and then nobody clicked Work Done.
   *
   * The sweep is unaffected either way: it nudges both parties on its own
   * clock (`stalledCompletionStage`), so a poster whose card is showing a more
   * specific blocker still hears about the stall.
   *
   * Nothing is enabled by this branch and no money moves from it: the owner's
   * rule is that a stalled job is released or refunded only by a human
   * decision (see the module header), so the card's job here is to say so.
   */
  if (rung.done && completionStalled(job, now)) {
    return {
      action: null,
      label: STALLED_APPROVE_DISABLED_LABEL,
      enabled: false,
      // Not `done`: nothing was finished. The success tint would read as "this
      // job is wrapped up", which is the opposite of what is happening.
      done: false,
      reason: STALLED_APPROVE_DISABLED_REASON,
      // A GATE, not an ordinary wait — amber. Something must happen before the
      // poster's own next move exists (the Helpr's tap, or our team), the job
      // is past the time it should have ended, and their money is held while
      // it stays that way. That is the same shape as the arrival deadlock
      // above, and the opposite of "the booking simply isn't settled yet".
      gate: true,
      stalled: true,
    };
  }
  return rung;
}

/**
 * Is the card showing the STALLED-JOB notice right now?
 *
 * Derived from the rung itself rather than re-deriving the condition, so the
 * "Why?" chip that reveals `STALLED_APPROVE_DISABLED_DETAIL` and the
 * disabled box it explains are decided by ONE predicate. (The same mistake the
 * confirmation ladder was built to fix: two `show*` flags for one state.)
 */
export function posterStalledNotice(job: Job, now: Date = new Date()): boolean {
  const step = derivePosterStep(job.status);
  if (!step) return false;
  return posterConfirmationRung(job, step, now)?.stalled === true;
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
