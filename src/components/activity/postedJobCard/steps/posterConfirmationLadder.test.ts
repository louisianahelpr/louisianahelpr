import { describe, it, expect } from "vitest";
import {
  posterConfirmationRung,
  posterOwesConfirmation,
  derivePosterStep,
  type PosterStepId,
} from "./posterStepContract";
import {
  STALLED_APPROVE_DISABLED_LABEL,
  STALLED_APPROVE_DISABLED_REASON,
  STALLED_FIRST_AFTER_HOURS,
} from "../../../../../supabase/functions/_shared/stalledCompletion";
import type { Job } from "../../activityConstants";

/**
 * THE POSTER'S CONFIRMATION LADDER (owner, 2026-09-19).
 *
 * "on poster i see no button to confirm they arrived, are working, confirmed
 * offered. if it was clicked already it should still show but with the box
 * disabled, or the next box once they are ready to move on."
 *
 * The controls existed and were unit-locked by jobStepOneRow.test.tsx; what
 * was never checked is that one of them is ON SCREEN. Both gates were written
 * as "render only at the instant this is tappable", so three states drew
 * nothing at all — and a state that draws nothing is exactly what the owner
 * reported. This file is the CLASS check for that: over the whole cross
 * product of the fields the gates read, it asserts
 *
 *   1. the ladder is never blank while the job is live (the defect itself);
 *   2. it never enables a confirmation the previous gates did not — the old
 *      formulas are written out below and compared rung-by-rung, because the
 *      arrival gate is GPS AND poster-confirm (VN-33) and a "fix" that quietly
 *      widened it would be a money/trust change, not a rendering one;
 *   3. a disabled box always carries a reason, and the bad-GPS deadlock's
 *      reason tells the truth without offering a way around the gate.
 */

type Fields = {
  status: Job["status"];
  helper_confirmed_at: string | null;
  helper_on_the_way_at: string | null;
  helper_arrived_at: string | null;
  helper_arrival_near_miss_at: string | null;
  poster_confirmed_arrival_at: string | null;
  poster_confirmed_working_at: string | null;
  helper_completed_at: string | null;
};

const T = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const job = (f: Partial<Fields> & { status: Job["status"] }): Job =>
  ({
    id: "job-1",
    helper_confirmed_at: null,
    helper_on_the_way_at: null,
    helper_arrived_at: null,
    helper_arrival_near_miss_at: null,
    poster_confirmed_arrival_at: null,
    poster_confirmed_working_at: null,
    helper_completed_at: null,
    ...f,
  }) as unknown as Job;

/** Every shape the two gates could ever see, built from the fields they read
 *  rather than from a list of states somebody remembered to write down. */
function matrix(): Job[] {
  const out: Job[] = [];
  for (const status of ["accepted", "in_progress", "revision_requested"] as const)
    for (const booked of [null, T(48)])
      for (const onWay of [null, T(3)])
        for (const arrived of [null, T(2)])
          for (const nearMiss of [null, T(1), T(20)])
            for (const confArr of [null, T(2)])
              for (const confWork of [null, T(1)])
                for (const done of [null, T(1)])
                  out.push(
                    job({
                      status,
                      helper_confirmed_at: booked,
                      helper_on_the_way_at: onWay,
                      helper_arrived_at: arrived,
                      helper_arrival_near_miss_at: nearMiss,
                      poster_confirmed_arrival_at: confArr,
                      poster_confirmed_working_at: confWork,
                      helper_completed_at: done,
                    }),
                  );
  return out;
}

const stepOf = (j: Job) => derivePosterStep(j.status) as PosterStepId;
const near = (j: Job) => {
  const at = (j as unknown as Fields).helper_arrival_near_miss_at;
  return !!at && Date.now() - new Date(at).getTime() < 12 * 3_600_000;
};

/** THE GATES AS THEY WERE, before the ladder — the arrival vouch, verbatim
 *  from ScheduledStep / InProgressStep at 9a39abbea. */
const legacyArrivalEnabled = (j: Job, step: PosterStepId) =>
  step === "scheduled"
    ? !!j.helper_confirmed_at && !!j.helper_arrived_at && !j.poster_confirmed_arrival_at && !j.helper_completed_at
    : j.status === "in_progress" &&
      (!!j.helper_arrived_at || near(j)) &&
      !j.poster_confirmed_arrival_at &&
      !j.helper_completed_at;
/** …and the working vouch. Note it never tested `helper_completed_at`. */
const legacyWorkingEnabled = (j: Job) =>
  j.status === "in_progress" && !j.poster_confirmed_working_at && !!j.poster_confirmed_arrival_at;

describe("the poster's confirmation ladder is never blank while the job is live", () => {
  it("draws a box for every shape of a scheduled or in-progress job the Helpr has not finished", () => {
    const blank = matrix()
      .filter((j) => !j.helper_completed_at)
      .filter((j) => posterConfirmationRung(j, stepOf(j)) === null);
    // THE OWNER'S BUG, as a set: every one of these used to render an empty
    // primary slot on a card that was asking the poster for something.
    expect(blank.map((j) => JSON.stringify(j))).toEqual([]);
  });

  it("shows exactly ONE rung — never two boxes competing for the row", () => {
    for (const j of matrix()) {
      const rung = posterConfirmationRung(j, stepOf(j));
      if (!rung) continue;
      // `action` is a single value by construction; what this pins is that a
      // finished box never also claims an action, and vice versa.
      expect(rung.done ? rung.action : "not-done").toBe(rung.done ? null : "not-done");
      if (rung.done) expect(rung.enabled).toBe(false);
    }
  });

  it("stands down once the Helpr has marked the job done, unless the vouch is still live", () => {
    // Approve is the row's real move then; a finished or blocked box would
    // park a dead control in the primary slot beside it.
    for (const j of matrix().filter((x) => x.helper_completed_at)) {
      const rung = posterConfirmationRung(j, stepOf(j));
      if (rung === null) continue;
      expect(rung.enabled, "a non-actionable box survived into the Approve state").toBe(true);
    }
  });
});

describe("the ladder enables nothing the old gates did not", () => {
  it("matches the previous arrival gate exactly on accepted and in_progress", () => {
    const widened = matrix()
      .filter((j) => j.status !== "revision_requested")
      .filter((j) => {
        const rung = posterConfirmationRung(j, stepOf(j));
        const nowEnabled = rung?.action === "arrival" && rung.enabled;
        return nowEnabled !== legacyArrivalEnabled(j, stepOf(j));
      });
    expect(widened.map((j) => JSON.stringify(j))).toEqual([]);
  });

  it("matches the previous working gate exactly on in_progress", () => {
    const widened = matrix()
      .filter((j) => j.status === "in_progress")
      .filter((j) => {
        const rung = posterConfirmationRung(j, stepOf(j));
        const nowEnabled = rung?.action === "working" && rung.enabled;
        return nowEnabled !== legacyWorkingEnabled(j);
      });
    expect(widened.map((j) => JSON.stringify(j))).toEqual([]);
  });

  it("never offers the arrival vouch on a shape with no arrival evidence at all", () => {
    for (const j of matrix().filter((x) => !x.helper_arrived_at && !near(x))) {
      const rung = posterConfirmationRung(j, stepOf(j));
      if (rung?.action === "arrival") expect(rung.enabled).toBe(false);
    }
  });
});

describe("item 6b — a revision job keeps its confirmations", () => {
  const revision = {
    status: "revision_requested" as const,
    helper_confirmed_at: T(48),
    helper_on_the_way_at: T(6),
    helper_arrived_at: T(5),
    helper_completed_at: T(2),
  };

  it("still offers the working vouch, which the literal status check swallowed", () => {
    const j = job({ ...revision, poster_confirmed_arrival_at: T(4), poster_confirmed_working_at: null });
    expect(derivePosterStep(j.status)).toBe("in_progress");
    // The old gate: `job.status === "in_progress" && …` — false here, so the
    // control vanished on every revision job.
    expect(legacyWorkingEnabled(j)).toBe(false);
    const rung = posterConfirmationRung(j, "in_progress");
    expect(rung).toMatchObject({ action: "working", enabled: true, label: "Confirm They're Working" });
    expect(posterOwesConfirmation(j)).toBe(true);
  });

  it("does not resurrect the arrival vouch on work that is already finished", () => {
    // The old arrival gate required `!helper_completed_at`, and a revision job
    // always carries one. Reading the derived step must not widen that.
    const j = job({ ...revision, poster_confirmed_arrival_at: null });
    expect(posterConfirmationRung(j, "in_progress")).toBeNull();
    expect(posterOwesConfirmation(j)).toBe(false);
  });
});

describe("item 6c — the box is drawn before the Helpr arrives, and says the truth", () => {
  /* THIS DESCRIBE WAS "the bad-GPS deadlock is surfaced, not resolved".
   *
   * Between 20260915044137 and 20260919155016, `mark_helper_arrival` REFUSED a
   * far or fix-less arrival and wrote nothing, so `helper_arrived_at` stayed
   * null — while the Helpr's own blocked CTA named the poster's "Confirm They
   * Arrived" tap as the way out. This state was a real deadlock, and the box's
   * job was to SAY so ("waiting on your Helpr's location check", amber).
   *
   * OWNER, 2026-09-19, ended it: the RPC now records the check-in on every
   * call, so `helper_arrived_at` always lands. The only way to be in this state
   * now is the ordinary one — the Helpr is on their way and has not tapped
   * "I've Arrived" yet. So the box is still drawn and still disabled, but its
   * reason is a WAIT, not a gate: nothing is stuck, and telling a poster their
   * Helpr's phone has failed a check would be a worry the app invented.
   */
  const stuck = job({
    status: "in_progress",
    helper_confirmed_at: T(48),
    helper_on_the_way_at: T(1),
    helper_arrived_at: null,
  });

  it("renders the box, disabled, instead of nothing at all", () => {
    const rung = posterConfirmationRung(stuck, "in_progress");
    expect(rung).toMatchObject({ action: "arrival", enabled: false, label: "Confirm They Arrived" });
  });

  it("says what is actually happening — on the way — and does not invent a failure", () => {
    const rung = posterConfirmationRung(stuck, "in_progress")!;
    expect(rung.reason).toMatch(/on the way/i);
    expect(rung.reason, "no location check is pending any more").not.toMatch(/location check/i);
    expect(rung.gate, "an ordinary wait, not a gate — nothing is stuck").toBe(false);
  });

  it("still never offers the poster's tap as a way around anything", () => {
    // The tap is now the WHOLE gate rather than half of one, so there is even
    // less room for copy that hints at an override: there is nothing to
    // override, and "confirm them anyway" would read as an invitation to vouch
    // for a Helpr who has not said they are there.
    const rung = posterConfirmationRung(stuck, "in_progress")!;
    expect(rung.enabled).toBe(false);
    expect(rung.reason).not.toMatch(/confirm (it |them |they )?anyway|instead|override|skip/i);
  });

  it("a plain wait is NOT dressed up as a gate", () => {
    const early = job({ status: "accepted", helper_confirmed_at: T(48) });
    const rung = posterConfirmationRung(early, "scheduled")!;
    expect(rung.gate).toBe(false);
    expect(rung.reason).toBeTruthy();
  });
});

describe("a disabled box always explains itself", () => {
  it("every blocked rung carries a reason, and every finished one does not need it", () => {
    for (const j of matrix()) {
      const rung = posterConfirmationRung(j, stepOf(j));
      if (!rung || rung.enabled) continue;
      if (rung.done) continue;
      expect(rung.reason, `a dead box with no reason: ${JSON.stringify(j)}`).toBeTruthy();
    }
  });

  it("an enabled box never carries one — the control IS the explanation", () => {
    for (const j of matrix()) {
      const rung = posterConfirmationRung(j, stepOf(j));
      if (rung?.enabled) expect(rung.reason).toBeNull();
    }
  });
});

describe("item 6e — the collapsed card's signal", () => {
  it("is true only where a confirmation can actually be taken right now", () => {
    for (const j of matrix()) {
      const rung = posterConfirmationRung(j, stepOf(j));
      expect(posterOwesConfirmation(j)).toBe(!!rung?.enabled);
    }
  });

  it("is false on the states that have no ladder at all", () => {
    for (const status of ["open", "completed", "disputed", "cancelled", "pending_approval"] as const) {
      expect(posterOwesConfirmation(job({ status })), status).toBe(false);
    }
  });
});

/* ── OWNER ITEM 7 — THE STALLED JOB, AND WHO GETS THE ROW'S ONE SLOT ────────
 *
 * The ladder and the stalled notice both want the primary slot, and only one
 * control may be in it (JobStepCard / jobStepOneRow.test.tsx). The precedence
 * is decided in `posterConfirmationRung` and nowhere else, so it is checked
 * here and nowhere else:
 *
 *   enabled confirmation  >  disabled confirmation  >  stalled notice  >  done box
 *
 * The predicate is the SWEEP's (`completionStalled`), so a card can never
 * offer a window the cron does not enforce.
 */
const DAY = "2026-09-17";
/** Well past that day's end in America/Chicago (midnight the 18th, CDT). */
const LONG_AFTER = new Date("2026-09-20T12:00:00Z");
/** Before it — the job is still legitimately running. */
const DURING = new Date("2026-09-17T18:00:00Z");

const stalledJob = (over: Partial<Record<string, unknown>> = {}): Job =>
  ({
    id: "job-1",
    status: "in_progress",
    date_needed: DAY,
    start_time: "09:00",
    estimated_hours: 2,
    helper_confirmed_at: T(48),
    helper_on_the_way_at: T(40),
    helper_arrived_at: T(39),
    helper_arrival_near_miss_at: null,
    poster_confirmed_arrival_at: T(39),
    poster_confirmed_working_at: T(38),
    helper_completed_at: null,
    poster_completed_at: null,
    ...over,
  }) as unknown as Job;

describe("item 7 — the job nobody marked done", () => {
  it("replaces the FINISHED box with the disabled stalled box and its reason", () => {
    const rung = posterConfirmationRung(stalledJob(), "in_progress", LONG_AFTER);
    expect(rung?.label).toBe(STALLED_APPROVE_DISABLED_LABEL);
    expect(rung?.enabled).toBe(false);
    expect(rung?.done, "nothing finished — the success tint would read as 'wrapped up'").toBe(false);
    expect(rung?.reason).toBe(STALLED_APPROVE_DISABLED_REASON);
    expect(rung?.gate, "a gate, not an ordinary wait — amber").toBe(true);
    expect(rung?.action, "no handler: this box can never move money").toBeNull();
  });

  it("does not show while the job is still legitimately running", () => {
    expect(posterConfirmationRung(stalledJob(), "in_progress", DURING)?.label).toBe("Working Confirmed");
  });

  it("uses the SWEEP's threshold, not one of its own", () => {
    // scheduledEndMs is the LATER of the day's end and start+estimate, so this
    // job's end is midnight the 18th in America/Chicago = 05:00Z.
    const end = new Date("2026-09-18T05:00:00Z").getTime();
    const justBefore = new Date(end + (STALLED_FIRST_AFTER_HOURS - 0.1) * 3_600_000);
    const justAfter = new Date(end + STALLED_FIRST_AFTER_HOURS * 3_600_000);
    expect(posterConfirmationRung(stalledJob(), "in_progress", justBefore)?.label).toBe("Working Confirmed");
    expect(posterConfirmationRung(stalledJob(), "in_progress", justAfter)?.label).toBe(
      STALLED_APPROVE_DISABLED_LABEL,
    );
  });

  it("loses to an ENABLED confirmation — a tap the poster can take outranks a notice", () => {
    const rung = posterConfirmationRung(
      stalledJob({ poster_confirmed_arrival_at: null }),
      "in_progress",
      LONG_AFTER,
    );
    expect(rung?.label).toBe("Confirm They Arrived");
    expect(rung?.enabled).toBe(true);
  });

  it("loses to a DISABLED confirmation — the earlier blocker is the more specific truth", () => {
    const rung = posterConfirmationRung(
      stalledJob({ poster_confirmed_arrival_at: null, helper_arrived_at: null }),
      "in_progress",
      LONG_AFTER,
    );
    expect(rung?.label).toBe("Confirm They Arrived");
    expect(rung?.enabled).toBe(false);
    // The Helpr never arrived, which is an EARLIER and more specific truth than
    // "nobody marked this job done". (Was `/location check/i` until the owner's
    // 2026-09-19 reversal made that sentence false — see the 6c block above.)
    expect(rung?.reason, "the arrival is what is missing, not the completion").toMatch(/on the way/i);
    expect(rung?.stalled, "this is the confirmation box, not the stalled notice").toBeUndefined();
  });

  it("never fires once either side has marked the job done", () => {
    for (const stamp of ["helper_completed_at", "poster_completed_at"] as const) {
      const rung = posterConfirmationRung(stalledJob({ [stamp]: T(1) }), "in_progress", LONG_AFTER);
      expect(rung?.label ?? null, stamp).not.toBe(STALLED_APPROVE_DISABLED_LABEL);
    }
  });

  it("never sets the collapsed card's owed-confirmation signal", () => {
    // `posterOwesConfirmation` reads `enabled`, and this box never is — a
    // stalled job is not a confirmation the poster is sitting on.
    expect(posterOwesConfirmation(stalledJob())).toBe(false);
  });
});
