/**
 * Audit A2-L19 (2026-10-29, ~/.lh-shots/app-audit-1028/2-jobs-h2/p2f-plist-cancelled-p1-375.png): every cancelled
 * card in Posted said "Cancelled" twice, the status line and then the tracker's label, over an empty 8-segment
 * strip. A collapsed card draws no tracker for a job off the path in the "cancelled" tone (cancelled, expired,
 * refunded): the status line above already says it. A job still on the path keeps its bar.
 *
 * The progress states come from the real jobProgress(), so a change to what a cancelled job's tone is shows here.
 *
 * @mutate src/components/job-card/MineJobFace.tsx |       {progress && progress.stage !== null && progress.tone !== "cancelled" && ( |       {progress && progress.stage !== null && (
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MineJobFace } from "@/components/job-card/MineJobFace";
import { jobProgress, type JobProgressState, type ProgressJob } from "@/components/tracker/jobProgressState";

const NOW = new Date("2037-10-21T15:00:00Z");
const base: ProgressJob = { status: "open", helper_id: null, payment_status: "unpaid" };
const poster = (j: Partial<ProgressJob>) => jobProgress({ ...base, ...j }, { viewer: "poster", otherFirst: "Jolie", now: NOW });

const face = (status: string, progress: JobProgressState) =>
  render(
    <MemoryRouter>
      <MineJobFace jobId="j1" title="Mow two lawns" category="yard_work" photo={null} when="Fri, Oct 30" status={<span>{status}</span>} money="$25" action={null} progress={progress} />
    </MemoryRouter>,
  );

const CANCELLED_CASES: Array<[string, Partial<ProgressJob>]> = [
  ["cancelled", { status: "cancelled" }],
  ["expired", { status: "expired" }],
];

describe("a cancelled card says Cancelled once, over no empty strip", () => {
  it("inventory: the off-path cases are in the 'cancelled' tone with stage 0 (the state that drew the empty strip)", () => {
    expect(CANCELLED_CASES.length).toBeGreaterThan(1);
    for (const [name, j] of CANCELLED_CASES) {
      const p = poster(j);
      expect({ name, tone: p.tone, stage: p.stage }).toEqual({ name, tone: "cancelled", stage: 0 });
    }
  });

  it.each(CANCELLED_CASES)("%s: no tracker on the card, and 'Cancelled' is drawn once", (_name, j) => {
    const { container } = face("Cancelled", poster(j));
    expect(container.querySelector("[data-mine-face-progress]")).toBeNull();
    expect((container.textContent ?? "").match(/Cancelled/g)).toHaveLength(1);
  });

  it("a job on the path keeps its bar (the fix is not 'never draw it')", () => {
    const p = poster({ status: "open" });
    expect(p.tone).toBe("progress");
    expect(p.stage).not.toBeNull();
    const { container } = face("No applicants yet", p);
    expect(container.querySelector("[data-mine-face-progress]")).not.toBeNull();
  });
});
