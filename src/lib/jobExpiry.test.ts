import { describe, it, expect } from "vitest";
import { isScheduleInThePast, isScheduleTooSoon, computeJobExpiresAt } from "./jobExpiry";

/**
 * THE FAILURE THESE PREVENT
 *
 * `isScheduleInThePast` is the only thing standing between a poster and a job
 * created already-expired — invisible to every helper the moment they pay.
 * It used to build its own instant with `new Date(\`${date}T${time}\`)`, which
 * resolves in the BROWSER's zone, while the job itself starts in
 * America/Chicago. So the gate answered a different question than the one the
 * schedule asks, and it answered it wrong in both directions for anyone not
 * sitting in Central time.
 *
 * The zone is injected on both sides below, which is the part that matters: a
 * test that builds "now" in the runtime's own zone cancels the offset out and
 * passes whether the code is right or wrong. Here the SAME arguments are asked
 * in two zones and must give two different answers — an implementation that
 * ignores the zone cannot satisfy that.
 */

// 2026-09-06 14:30 UTC. In Central (CDT, UTC-5) that is 09:30; in Pacific
// (PDT, UTC-7) it is 07:30. A 09:00 job has therefore started in one and not
// the other, from one instant.
const NOW = new Date("2026-09-06T14:30:00Z");

describe("isScheduleInThePast", () => {
  it("resolves the start in the JOB's zone, not the runtime's", () => {
    // 09:00 Central = 14:00Z, which is before NOW → already started.
    expect(isScheduleInThePast("2026-09-06", "09:00", NOW, "America/Chicago")).toBe(true);
    // 09:00 Pacific = 16:00Z, which is after NOW → has not started.
    expect(isScheduleInThePast("2026-09-06", "09:00", NOW, "America/Los_Angeles")).toBe(false);
  });

  it("clears the moment the poster moves the job to a later day", () => {
    // This is the reported symptom: pick today at a time that has gone, get
    // refused, change the date to tomorrow. The refusal must not survive it.
    expect(isScheduleInThePast("2026-09-06", "09:00", NOW, "America/Chicago")).toBe(true);
    expect(isScheduleInThePast("2026-09-07", "09:00", NOW, "America/Chicago")).toBe(false);
  });

  it("clears the moment the poster moves the start time later the same day", () => {
    expect(isScheduleInThePast("2026-09-06", "09:00", NOW, "America/Chicago")).toBe(true);
    expect(isScheduleInThePast("2026-09-06", "11:00", NOW, "America/Chicago")).toBe(false);
  });

  it("does not refuse a schedule that has not started yet", () => {
    // 08:30 Central is 13:30Z — half an hour before NOW, so a 09:00 Central
    // start is still ahead of it.
    const earlier = new Date("2026-09-06T13:30:00Z");
    expect(isScheduleInThePast("2026-09-06", "09:00", earlier, "America/Chicago")).toBe(false);
  });

  it("never refuses on missing data", () => {
    // A half-filled form must be blocked by the "pick a date" / "pick a time"
    // checks that name the missing field, not by a past-schedule message about
    // a schedule that does not exist yet.
    expect(isScheduleInThePast("", "09:00", NOW, "America/Chicago")).toBe(false);
    expect(isScheduleInThePast("2026-09-06", "", NOW, "America/Chicago")).toBe(false);
  });

  it("accepts a Postgres HH:MM:SS time as well as the form's HH:MM", () => {
    expect(isScheduleInThePast("2026-09-06", "09:00:00", NOW, "America/Chicago")).toBe(true);
    expect(isScheduleInThePast("2026-09-06", "11:00:00", NOW, "America/Chicago")).toBe(false);
  });
});

describe("computeJobExpiresAt", () => {
  it("still floors a past schedule into the future", () => {
    // Unchanged behaviour, asserted here because the past-schedule gate above
    // is the thing that keeps it from ever mattering — if the gate is ever
    // weakened, this floor is the only remaining reason a paid listing is
    // visible at all.
    const expiry = computeJobExpiresAt("2020-01-01", "09:00", NOW);
    expect(expiry).not.toBeNull();
    expect(new Date(expiry as string).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("expires at the job's Central start, whatever zone it was posted from", () => {
    // 2026-09-20 09:00 CDT = 14:00Z. Asked in two zones, the old browser-zone
    // parse gave 09:00 Pacific (16:00Z) and 09:00 Eastern (13:00Z).
    const early = new Date("2026-09-01T00:00:00Z");
    expect(computeJobExpiresAt("2026-09-20", "09:00", early)).toBe("2026-09-20T14:00:00.000Z");
    expect(computeJobExpiresAt("2026-09-20", "09:00", early, "America/Los_Angeles")).toBe("2026-09-20T16:00:00.000Z");
  });

  it("uses the end of the job's day when there is no start time", () => {
    const early = new Date("2026-09-01T00:00:00Z");
    expect(computeJobExpiresAt("2026-09-20", "", early)).toBe("2026-09-21T04:59:00.000Z");
  });

  it("is right on both DST Sundays (single-pass offset was an hour out)", () => {
    const early = new Date("2026-01-01T00:00:00Z");
    // 05:00 CST on fall-back Sunday = 11:00Z; 06:00 CDT on spring-forward = 11:00Z.
    expect(computeJobExpiresAt("2026-11-01", "05:00", early)).toBe("2026-11-01T11:00:00.000Z");
    expect(computeJobExpiresAt("2026-03-08", "06:00", early)).toBe("2026-03-08T11:00:00.000Z");
    // A repeated 01:30 resolves like Postgres AT TIME ZONE: the later, standard-time instant.
    expect(computeJobExpiresAt("2026-11-01", "01:30", early)).toBe("2026-11-01T07:30:00.000Z");
  });

  it("has no expiry without a date", () => {
    expect(computeJobExpiresAt("", "09:00", NOW)).toBeNull();
  });
});
// Proof this guard can fail (scripts/vacuity). Pin the zone instead of taking
// the injected one and the gate is back to answering a different question than
// the schedule asks — the exact browser-zone defect, and the reason both sides
// of these tests inject a zone rather than letting the runtime's cancel out.
// @mutate src/lib/jobExpiry.ts | jobStartDateTime(dateNeeded, startTime, timeZone) | jobStartDateTime(dateNeeded, startTime, "America/Chicago")

/**
 * Owner, 2026-10-08 (pop-up: "At least 2 hours"): a 1:37 PM post for a 2:00 PM
 * start showed "34 minutes left" at 2:03. A new job needs 2 hours' notice and
 * its listing closes at the start.
 *
 * @mutate src/lib/jobExpiry.ts | export const MIN_POST_NOTICE_MS = 2 * 60 * 60 * 1000; | export const MIN_POST_NOTICE_MS = 0;
 * @mutate src/lib/jobExpiry.ts |   return scheduled.getTime() > now.getTime()\n    ? scheduled.toISOString() |   return scheduled.getTime() > now.getTime() + MIN_LISTING_WINDOW_MS\n    ? scheduled.toISOString()
 */
describe("a new job needs 2 hours' notice, and its listing closes at its start", () => {
  // 2026-10-08 18:37Z = 1:37 PM CDT, the owner's post.
  const POSTED = new Date("2026-10-08T18:37:00Z");
  it("the owner's case: a 2:00 PM start posted at 1:37 PM is too soon", () => {
    expect(isScheduleTooSoon("2026-10-08", "14:00", POSTED, "America/Chicago")).toBe(true);
  });
  it("3:36 PM is too soon, 3:37 PM is fine", () => {
    expect(isScheduleTooSoon("2026-10-08", "15:36", POSTED, "America/Chicago")).toBe(true);
    expect(isScheduleTooSoon("2026-10-08", "15:37", POSTED, "America/Chicago")).toBe(false);
  });
  it("'any time that day' counts as 11:59 PM", () => {
    expect(isScheduleTooSoon("2026-10-08", "", POSTED, "America/Chicago")).toBe(false);
    expect(isScheduleTooSoon("2026-10-08", "", new Date("2026-10-09T04:30:00Z"), "America/Chicago")).toBe(true);
  });
  it("the listing expires AT a start that is ahead, never an hour later", () => {
    const soon = computeJobExpiresAt("2026-10-08", "14:00", POSTED, "America/Chicago");
    expect(soon).toBe(new Date("2026-10-08T19:00:00Z").toISOString());
  });
});
