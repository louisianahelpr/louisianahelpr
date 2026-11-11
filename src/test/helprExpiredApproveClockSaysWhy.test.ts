/**
 * F264 (whole-app audit 11-10, Helpr's Working card, Haul brush): the card read "Waiting — With E2E for approval" and
 * right under it "Helpr support is stepping in". Two states; a Helpr could not tell whether support came in over a
 * problem. The Helpr's run-out approve clock (and fix-review clock) now says why: "No reply, so support checks it".
 * The poster's own clock is unchanged.
 *
 * @mutate src/components/job-card/jobStatusLine.ts | const HELPR_NO_REPLY = "No reply, so support checks it"; | const HELPR_NO_REPLY = "Helpr support is stepping in";
 */
import { describe, expect, it } from "vitest";
import { CARD_COUNTDOWN_MAX_CHARS, helperDeadline, posterDeadline } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";

const job = {
  id: "j", status: "in_progress", helper_completed_at: "2037-10-20T12:00:00Z", revision_acceptance_deadline: "2037-10-21T12:00:00Z",
} as unknown as Job;

describe("F264: the Helpr's expired approve clock says why support steps in", () => {
  it("submitted and fix sent: 'No reply, so support checks it', one line at 375", () => {
    for (const id of ["submitted", "revision_sent"] as const) {
      const d = helperDeadline(id, job);
      expect({ id, text: d?.expiredText }).toEqual({ id, text: "No reply, so support checks it" });
      expect(d!.expiredText.length).toBeLessThanOrEqual(CARD_COUNTDOWN_MAX_CHARS);
    }
  });

  it("the poster's approve clock keeps its words", () => {
    expect(posterDeadline("approve", job)?.expiredText).toBe("Helpr support is stepping in");
  });
});
