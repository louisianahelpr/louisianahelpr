import { describe, it, expect } from "vitest";
import { isScheduleInThePast, computeJobExpiresAt } from "./jobExpiry";

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

  it("has no expiry without a date", () => {
    expect(computeJobExpiresAt("", "09:00", NOW)).toBeNull();
  });
});
