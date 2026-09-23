/**
 * The stalled-completion ladder (owner, 2026-09-19, pop-up: "Nudge both, then
 * admin queue. Never move money automatically.").
 *
 * A job that reaches `in_progress` and is never marked done by either side is
 * matched by no other scheduled sweep — the escrow is simply held forever.
 * `supabase/functions/_shared/stalledCompletion.ts` is the one rule for when
 * that has happened and what is due; this pins its schedule and its copy, the
 * way `arrivalNudgeStage.test.ts` pins VN-33's.
 *
 * The three thresholds are the app's own constants, asserted against their
 * sources below so the ladder cannot drift away from them silently.
 */
import { describe, expect, it } from "vitest";
import {
  completionStalled,
  hoursPastScheduledEnd,
  scheduledEndMs,
  stalledCompletionStage,
  STALLED_APPROVE_DISABLED_LABEL,
  STALLED_APPROVE_DISABLED_REASON,
  STALLED_APPROVE_DISABLED_DETAIL,
  STALLED_APPROVE_DETAIL_TITLE,
  STALLED_ESCALATE_AFTER_HOURS,
  STALLED_FIRST_AFTER_HOURS,
  STALLED_GAP_BEFORE_ESCALATE,
  STALLED_GAP_FIRST_TO_SECOND,
  STALLED_SECOND_AFTER_HOURS,
  stalledAdminBody,
  stalledEscalatedBody,
  stalledNudgeBodyPosted,
  stalledNudgeBodyWorking,
  type NudgeLedger,
  type StalledEvidence,
} from "../../../supabase/functions/_shared/stalledCompletion";
import {
  AUTO_COMPLETE_HOURS,
  TOTAL_TO_PAYOUT_HOURS,
} from "../../../supabase/functions/_shared/escrowTiming";
import { SECOND_AFTER_HOURS } from "../../../supabase/functions/_shared/arrivalNudge";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/** A job on 2026-09-15, 09:00 Central, estimated at 3 hours. */
const JOB: StalledEvidence = {
  status: "in_progress",
  helper_completed_at: null,
  poster_completed_at: null,
  date_needed: jobLocalDateISO(-5),
  start_time: "09:00:00",
  estimated_hours: 3,
};

const END = scheduledEndMs(JOB.date_needed!, JOB.start_time, JOB.estimated_hours);
/** `h` hours past the job's scheduled end. */
const at = (h: number) => new Date(END + h * 3_600_000);
const L = (first?: number, second?: number, esc?: number): NudgeLedger => ({
  first_sent_at: first == null ? null : at(first).toISOString(),
  second_sent_at: second == null ? null : at(second).toISOString(),
  escalated_at: esc == null ? null : at(esc).toISOString(),
});

describe("the thresholds are the app's own constants, not new numbers", () => {
  it("the second nudge lands at AUTO_COMPLETE_HOURS", () => {
    expect(STALLED_SECOND_AFTER_HOURS).toBe(AUTO_COMPLETE_HOURS);
  });

  it("a human is asked at 48h — decoupled from TOTAL_TO_PAYOUT_HOURS since Q202", () => {
    // The owner's rule is that money never moves on this path. So at the exact
    // moment the normal path would have paid out, a person is asked instead.
    // Q202 (2026-09-23) lengthened the standard payout to 72h after done as a
    // card-dispute buffer. The admin escalation for a job NOBODY marked done
    // was not part of that decision and stays at 48h (see stalledCompletion.ts).
    expect(STALLED_ESCALATE_AFTER_HOURS).toBe(48);
    expect(STALLED_ESCALATE_AFTER_HOURS).toBeLessThan(TOTAL_TO_PAYOUT_HOURS);
  });

  it("the first-nudge grace is the app's finest lateness unit", () => {
    // arrivalNudge's own second stage, and cancellationFee's harshest tier.
    expect(STALLED_FIRST_AFTER_HOURS).toBe(SECOND_AFTER_HOURS);
  });

  it("the ladder is strictly increasing", () => {
    expect(STALLED_FIRST_AFTER_HOURS).toBeLessThan(STALLED_SECOND_AFTER_HOURS);
    expect(STALLED_SECOND_AFTER_HOURS).toBeLessThan(STALLED_ESCALATE_AFTER_HOURS);
  });
});

describe("scheduledEndMs — every error errs LATE", () => {
  it("is start_time + estimated_hours when the work runs past midnight", () => {
    // 22:00 start, 5 hours → 03:00 the next day, later than the day's end.
    const end = scheduledEndMs("2026-09-15", "22:00:00", 5);
    expect(new Date(end).toISOString()).toBe("2026-09-16T08:00:00.000Z"); // 03:00 CDT
  });

  it("is the END of the job's day when the work finishes inside it", () => {
    // 09:00 + 3h = 12:00, but "some time on the 15th" is not over until the
    // 15th is. Nudging at 14:00 would accuse a Helpr who is still working.
    expect(scheduledEndMs("2026-09-15", "09:00:00", 3)).toBe(
      scheduledEndMs("2026-09-15", null, null),
    );
    expect(new Date(scheduledEndMs("2026-09-15", null, null)).toISOString()).toBe(
      "2026-09-16T05:00:00.000Z", // midnight on the 16th, CDT
    );
  });

  it("survives the two days a year that are not 24 hours long", () => {
    // Spring forward (2026-03-08) and fall back (2026-11-01) in Central. The
    // day AFTER each is a plain calendar step, and midnight is resolved in the
    // zone — so the answer is local midnight, never 23:00 or 01:00.
    for (const [d, iso] of [
      ["2026-03-07", "2026-03-08T06:00:00.000Z"], // CST -6 → the 8th starts at 06:00Z
      ["2026-03-08", "2026-03-09T05:00:00.000Z"], // CDT -5 after the switch
      ["2026-10-31", "2026-11-01T05:00:00.000Z"],
      ["2026-11-01", "2026-11-02T06:00:00.000Z"],
    ] as const) {
      expect(new Date(scheduledEndMs(d, null, null)).toISOString(), d).toBe(iso);
    }
  });

  it("a null or nonsense estimate never pulls the end EARLIER", () => {
    const base = scheduledEndMs("2026-09-15", "09:00:00", null);
    expect(scheduledEndMs("2026-09-15", "09:00:00", -99)).toBe(base);
    expect(scheduledEndMs("2026-09-15", "09:00:00", Number.NaN)).toBe(base);
  });
});

describe("completionStalled — the predicate the sweep AND the card read", () => {
  it("is false before the grace has run out", () => {
    expect(completionStalled(JOB, at(STALLED_FIRST_AFTER_HOURS - 0.1))).toBe(false);
    expect(completionStalled(JOB, at(STALLED_FIRST_AFTER_HOURS))).toBe(true);
  });

  it("is false the moment EITHER side marks it done", () => {
    expect(completionStalled({ ...JOB, helper_completed_at: at(1).toISOString() }, at(48))).toBe(false);
    expect(completionStalled({ ...JOB, poster_completed_at: at(1).toISOString() }, at(48))).toBe(false);
  });

  it("is false for any status but in_progress", () => {
    for (const status of ["open", "accepted", "completed", "cancelled", "disputed", "revision_requested"]) {
      expect(completionStalled({ ...JOB, status }, at(48)), status).toBe(false);
    }
  });

  it("is false for a job with no date rather than throwing", () => {
    expect(completionStalled({ ...JOB, date_needed: null }, at(48))).toBe(false);
    expect(Number.isNaN(hoursPastScheduledEnd({ ...JOB, date_needed: null }, at(48)))).toBe(true);
  });
});

describe("stalledCompletionStage", () => {
  it("sends nothing until the grace has run out", () => {
    expect(stalledCompletionStage(JOB, null, at(1))).toBeNull();
    expect(stalledCompletionStage(JOB, null, at(STALLED_FIRST_AFTER_HOURS))).toBe("first");
  });

  it("waits until 24h for the second nudge, then sends it once", () => {
    expect(stalledCompletionStage(JOB, L(2), at(23.9))).toBeNull();
    expect(stalledCompletionStage(JOB, L(2), at(24))).toBe("second");
    expect(stalledCompletionStage(JOB, L(2, 24), at(30))).toBeNull();
  });

  it("escalates at 48h, even if the second nudge was missed, and only once", () => {
    expect(stalledCompletionStage(JOB, L(2, 24), at(48))).toBe("escalate");
    expect(stalledCompletionStage(JOB, L(2), at(60))).toBe("escalate");
    expect(stalledCompletionStage(JOB, L(2, 24, 48), at(200))).toBeNull();
  });

  it("never escalates in the same breath as a late first nudge", () => {
    // A row that was already old when this sweep first ran (or when it came
    // back from an outage) still walks the WHOLE ladder. Every threshold is
    // long past, so without the gaps it would be nudged and escalated on
    // consecutive runs and nobody would have had a chance to answer.
    expect(stalledCompletionStage(JOB, L(200), at(200.5))).toBeNull();
    expect(stalledCompletionStage(JOB, L(200), at(200 + STALLED_GAP_FIRST_TO_SECOND - 0.1))).toBeNull();
    expect(stalledCompletionStage(JOB, L(200), at(200 + STALLED_GAP_FIRST_TO_SECOND))).toBe("second");

    const second = 200 + STALLED_GAP_FIRST_TO_SECOND;
    expect(stalledCompletionStage(JOB, L(200, second), at(second + STALLED_GAP_BEFORE_ESCALATE - 0.1)))
      .toBeNull();
    expect(stalledCompletionStage(JOB, L(200, second), at(second + STALLED_GAP_BEFORE_ESCALATE)))
      .toBe("escalate");

    // Second nudge missed entirely (a dropped run): escalation still waits the
    // gap after the first, then goes — it does not first send a stale nudge.
    expect(stalledCompletionStage(JOB, L(200), at(200 + STALLED_GAP_BEFORE_ESCALATE))).toBe("escalate");
  });

  it("sends the first nudge before anything else, however late the run", () => {
    expect(stalledCompletionStage(JOB, null, at(500))).toBe("first");
  });

  it("stops the instant somebody marks the job done", () => {
    const done = { ...JOB, helper_completed_at: at(1).toISOString() };
    expect(stalledCompletionStage(done, L(2), at(48))).toBeNull();
  });
});

describe("the copy", () => {
  it("never names a role as an identity — CLAUDE.md, 'never role-based'", () => {
    // roleNeutralCopy.test.ts scans supabase/functions for exactly this; the
    // assertion is repeated here so the failure names the ladder, not a walker.
    const all = [
      STALLED_APPROVE_DISABLED_LABEL,
      STALLED_APPROVE_DISABLED_REASON,
      STALLED_APPROVE_DISABLED_DETAIL,
      STALLED_APPROVE_DETAIL_TITLE,
      stalledNudgeBodyPosted("Mow the lawn", false),
      stalledNudgeBodyPosted("Mow the lawn", true),
      stalledNudgeBodyWorking("Mow the lawn", false),
      stalledNudgeBodyWorking("Mow the lawn", true),
      stalledEscalatedBody("Mow the lawn"),
    ].join(" ");
    expect(all).not.toMatch(/\bposters?\b/i);
    expect(all).not.toMatch(/\bcustomers?\b/i);
    expect(all).not.toMatch(/\bhelpers?\b/); // the brand spelling is "Helpr"
  });

  it("tells the person who posted the job that their money is NOT moving", () => {
    // The owner's rule is that money never moves automatically here, so the
    // disabled control has to say so — an unexplained dead button reads as
    // "something has gone wrong with my payment". This is the ONE sentence the
    // card shows, so it is where the escrow promise has to be.
    expect(STALLED_APPROVE_DISABLED_REASON).toMatch(/escrow/i);
  });

  it("the visible line is ONE sentence — owner, 2026-09-19: 'trim to one sentence'", () => {
    /* It measured 112px / 7 lines at 375 and 128px / 8 lines at 320 in 11px
     * semibold amber, above a three-line disabled button: ~23% of the viewport,
     * reading louder than the tracker above it. A passive explanation of
     * inaction must not outrank the job's own state.
     *
     * Sentence-counted rather than character-counted because the owner's rule
     * is about sentences; the em-dash clause is deliberate and stays. */
    const sentences = STALLED_APPROVE_DISABLED_REASON.split(/[.!?]+\s+/).filter(Boolean);
    expect(sentences, STALLED_APPROVE_DISABLED_REASON).toHaveLength(1);
    // A hard ceiling too, so "one sentence" cannot be satisfied by one very
    // long one. The measured 7-line version was 236 characters.
    expect(STALLED_APPROVE_DISABLED_REASON.length).toBeLessThanOrEqual(120);
  });

  it("the rest is kept, behind the tap — the trim is not a deletion", () => {
    // Every fact the pre-trim line carried is still in one of the two strings:
    // what to ask for, and that nothing moves until a person acts.
    expect(STALLED_APPROVE_DISABLED_DETAIL).toMatch(/Mark Job Complete/);
    expect(STALLED_APPROVE_DISABLED_DETAIL).toMatch(/nothing is released or refunded/i);
    expect(STALLED_APPROVE_DISABLED_DETAIL).toMatch(/our team/i);
    // The two halves must not repeat each other — that is what made the
    // original long.
    expect(STALLED_APPROVE_DISABLED_DETAIL).not.toMatch(/escrow/i);
    expect(STALLED_APPROVE_DETAIL_TITLE.length).toBeLessThanOrEqual(40);
  });

  it("names the job in every message, so a notification is actionable on its own", () => {
    for (const s of [
      stalledNudgeBodyPosted("Mow the lawn", false),
      stalledNudgeBodyWorking("Mow the lawn", true),
      stalledEscalatedBody("Mow the lawn"),
      stalledAdminBody("Mow the lawn", 49),
    ]) {
      expect(s).toContain("Mow the lawn");
    }
  });

  it("the admin queue item says a human must decide and nothing moves on its own", () => {
    const body = stalledAdminBody("Mow the lawn", 48.6);
    expect(body).toMatch(/49h/); // rounded, not a float
    expect(body).toMatch(/Nothing moves automatically/i);
    expect(body).toMatch(/release, refund, or open a dispute/i);
  });
});

// @mutate supabase/functions/_shared/stalledCompletion.ts | if (hours >= STALLED_ESCALATE_AFTER_HOURS && sinceLastSent >= STALLED_GAP_BEFORE_ESCALATE) { | if (hours >= STALLED_ESCALATE_AFTER_HOURS) {
