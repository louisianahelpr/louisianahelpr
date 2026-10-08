/**
 * Owner, 2026-10-08 (Q1570, pop-up "Both must tap confirm"; job 28f8cff5 went
 * On My Way with no confirmation from either side): an accept inside the
 * day-before window used to count as the Helpr's confirm, so the tracker
 * offered "I'm On My Way" without anyone tapping anything.
 *
 * The class: only the Helpr's own day-before tap counts, on the card, on the
 * tracker's Confirmed step, and on the server (helper_mark_on_the_way refuses
 * helper_not_dayof_confirmed, 20261008203441).
 *
 * @mutate src/components/JobConfirmation.tsx |   return helperDayofConfirmedAt ?? null; |   return "accept-counted";
 * @mutate src/components/JobTracking.tsx |   const helperHasConfirmed = !!helperDayofConfirmedAt; |   const helperHasConfirmed = !!helperConfirmedAt;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helperDayOfConfirmation } from "@/components/JobConfirmation";
import { deriveCurrentStatusIdx } from "@/components/JobTracking";

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const inTwoHours = new Date(NOW + 2 * 3_600_000);
const day = inTwoHours.toISOString().slice(0, 10);

describe("accepting never counts as the Helpr's day-before confirm", () => {
  it("an accept 1 hour before a same-day start is not a confirm", () => {
    expect(helperDayOfConfirmation({ helperConfirmedAt: iso(NOW - 3_600_000), helperDayofConfirmedAt: null, dateNeeded: day })).toBeNull();
  });
  it("the Helpr's own tap is", () => {
    expect(helperDayOfConfirmation({ helperConfirmedAt: iso(NOW - 3_600_000), helperDayofConfirmedAt: iso(NOW), dateNeeded: day })).toBe(iso(NOW));
  });
  it("the tracker's Confirmed step needs both taps, never the accept", () => {
    const base = { trackingStatus: null, jobStatus: "accepted", helperConfirmedAt: iso(NOW - 3_600_000), posterConfirmedAt: iso(NOW), jobDateNeeded: day, jobStartTime: null };
    const withAcceptOnly = deriveCurrentStatusIdx({ ...base, helperDayofConfirmedAt: null } as never);
    const withTap = deriveCurrentStatusIdx({ ...base, helperDayofConfirmedAt: iso(NOW) } as never);
    expect(withTap).toBeGreaterThan(withAcceptOnly);
  });
  it("On My Way waits for the day-before tap in the tracker too", () => {
    const src = readFileSync(join(process.cwd(), "src/components/JobTracking.tsx"), "utf8");
    expect(src).toMatch(/const helperHasConfirmed = !!helperDayofConfirmedAt;/);
  });
});
