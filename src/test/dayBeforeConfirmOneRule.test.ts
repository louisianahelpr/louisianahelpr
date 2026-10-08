/**
 * Owner, 2026-10-08: "if they both confirmed then why is the confirmed button
 * not checked". Measured on job 5b68bccb: the Helpr accepted at 1:23 PM CT on
 * Oct 8 for a 2:00 PM Oct 9 start (24h37m before). The confirmation box
 * measured the 24h grace from MIDNIGHT of the job day (counted it: "Helpr:
 * Confirmed"); the tracker measured from the START (did not). One rule now:
 * from the start, so both say the Helpr still owes the day-before tap.
 *
 * @mutate src/components/JobConfirmation.tsx |   const start = jobStartDateTime(dateNeeded, startTime) ?? jobDayStart(dateNeeded); |   const start = jobDayStart(dateNeeded);
 */
import { describe, expect, it } from "vitest";
import { helperDayOfConfirmation } from "@/components/JobConfirmation";

describe("the day-before grace is measured from the job's start", () => {
  it("the owner's case: an accept 24h37m before the start is NOT a day-before confirmation", () => {
    expect(
      helperDayOfConfirmation({ helperConfirmedAt: "2026-10-08T18:23:15Z", dateNeeded: "2026-10-09", startTime: "14:00:00" }),
    ).toBeNull();
  });

  it("an accept inside 24h of the start counts", () => {
    expect(
      helperDayOfConfirmation({ helperConfirmedAt: "2026-10-08T19:30:00Z", dateNeeded: "2026-10-09", startTime: "14:00:00" }),
    ).toBe("2026-10-08T19:30:00Z");
  });

  it("the real day-before stamp always counts", () => {
    expect(
      helperDayOfConfirmation({ helperConfirmedAt: null, helperDayofConfirmedAt: "2026-10-09T01:00:00Z", dateNeeded: "2026-10-09", startTime: "14:00:00" }),
    ).toBe("2026-10-09T01:00:00Z");
  });
});
