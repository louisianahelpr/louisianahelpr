/**
 * JA-30 (Jobs audit 2026-11-01): during a dispute the tracker line read "A real person at Helpr is looking at the
 * problem. The money stays held": no when, and the brand cut to "Helpr". It now says when they hear back (the
 * dispute's own deadline, after which Louisiana Helpr support decides) and names the brand in full, on both sides.
 *
 * @mutate src/components/tracker/jobProgressState.ts | decideMs > now ? `, with an answer by ${when(decideMs)}` : ""; | "";
 */
import { describe, expect, it } from "vitest";
import { jobProgress } from "@/components/tracker/jobProgressState";

const NOW = new Date("2032-10-20T15:00:00Z");
const job = {
  status: "disputed", helper_id: "h1", payment_status: "escrow", has_active_dispute: true,
  helper_completed_at: "2032-10-20T12:00:00Z", dispute_deadline: "2032-10-23T15:00:00Z",
};

describe("JA-30: the dispute line says when they hear back", () => {
  for (const viewer of ["poster", "helpr"] as const) {
    it(`${viewer}: the answer's day and time, and Louisiana Helpr`, () => {
      const p = jobProgress(job as never, { viewer, otherFirst: "Dana", now: NOW });
      expect(p.label).toBe("Dispute");
      // 2032-10-23 15:00Z is Sat 10:00 AM in Louisiana.
      expect(p.next).toMatch(/A real person at Louisiana Helpr is looking at the problem, with an answer by Sat 10:00 AM\. The money stays held/);
    });
  }
  it("past the deadline it promises no time it can no longer keep", () => {
    const p = jobProgress({ ...job, dispute_deadline: "2032-10-19T15:00:00Z" } as never, { viewer: "poster", otherFirst: "Yusef", now: NOW });
    expect(p.next).not.toMatch(/answer by/);
    expect(p.next).toMatch(/Louisiana Helpr/);
  });
});
