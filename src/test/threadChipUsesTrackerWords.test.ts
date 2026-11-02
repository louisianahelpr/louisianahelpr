/**
 * A3-88 (audit 11-01): the inbox row's chip said "Accepted" while the open thread's tracker lit "Hired". The chip (the
 * inbox row and the chat header both read threadJobChipLabel) now uses the tracker's own stage word for each status
 * that pins a stage: accepted -> Hired, in_progress -> Working, pending_approval -> Done. Every word is checked
 * against the tracker's step list, so the two cannot drift.
 *
 * @mutate src/lib/expiredListingInThread.ts |   return TRACKER_WORD[status] ?? jobStatusLabel(status); |   return jobStatusLabel(status);
 * @mutate src/lib/expiredListingInThread.ts | accepted: "Hired", | accepted: "Accepted",
 */
import { describe, expect, it } from "vitest";
import { threadJobChipLabel } from "@/lib/expiredListingInThread";
import { JOB_PROGRESS_STEPS } from "@/components/tracker/jobProgressState";

describe("A3-88: the thread chip names the stage with the tracker's word", () => {
  const onPath = ["accepted", "in_progress", "pending_approval"];
  it("each on-path status reads as a tracker step", () => {
    const words = onPath.map((s) => threadJobChipLabel(s, null));
    expect(words).toEqual(["Hired", "Working", "Done"]);
    for (const w of words) expect(JOB_PROGRESS_STEPS as readonly string[]).toContain(w);
  });
  it("off the path keeps its own word", () => {
    expect(threadJobChipLabel("open", null)).toBe("Open");
    expect(threadJobChipLabel("disputed", null)).toBe("Disputed");
    expect(threadJobChipLabel("cancelled", { jobExpired: true, viewerIsPoster: true })).toBe("Expired");
  });
});
