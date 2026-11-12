/**
 * Q2600 (Jobs audit 1102b row 14): during a dispute the job page's bold line was two sentences with no final period
 * ("A real person at Louisiana Helpr is looking at the problem, with an answer by Sat 10:00 AM. The money stays held").
 * It is now a short title ("We're looking into it") with the explanation as plain body text under it, ending in a
 * period, on the job page's next-step line, the cards' strips and the tracker's own line.
 *
 * @mutate src/components/tracker/jobProgressState.ts | at(null, false, "Under review", t("jl.disputeNext"), held), body: | at(null, false, "Under review", t("jl.disputeBody"), held), body:
 * @mutate src/components/tracker/jobNextStep.ts | if (progress.body) v.body = progress.body; | 
 * @mutate src/components/ui/NextStep.tsx | {value.body && <span data-next-step-body="" | {false && <span data-next-step-body=""
 * @mutate src/components/tracker/JobProgress.tsx | {line && progress.body && ( | {false && progress.body && (
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { NextStep } from "@/components/ui/NextStep";
import { JobProgress } from "@/components/tracker/JobProgress";

const NOW = new Date("2032-10-20T15:00:00Z");
const job = {
  status: "disputed", helper_id: "h1", payment_status: "escrow", has_active_dispute: true,
  helper_completed_at: "2032-10-20T12:00:00Z", dispute_deadline: "2032-10-23T15:00:00Z",
};
const BODY = "A real person at Louisiana Helpr is looking at the problem, with an answer by Sat, Oct 23 at 10:00 AM. The money stays held.";

describe("Q2600: the dispute line is a short title with the explanation as body", () => {
  for (const side of ["poster", "helpr"] as const) {
    it(`${side}: the job page's line is the title in bold and the explanation under it`, () => {
      const p = jobProgress(job as never, { viewer: side, otherFirst: "Dana", now: NOW });
      expect(p.next).toBe("We're looking into it");
      expect(p.body).toBe(BODY);
      const step = jobNextStep(p, { side, otherFirst: "Dana" });
      expect(step).toMatchObject({ text: "We're looking into it", body: BODY });
      const { container } = render(<NextStep value={step} />);
      const bold = container.querySelector("[data-next-step] > .font-semibold");
      expect(bold?.textContent).toBe("We're looking into it");
      const body = container.querySelector("[data-next-step-body]");
      expect(body?.textContent).toBe(BODY);
      expect(body?.className).not.toMatch(/font-semibold/);
    });
  }
  it("the tracker's own line (a card with no next-step line) shows the body too", () => {
    const p = jobProgress(job as never, { viewer: "poster", otherFirst: "Dana", now: NOW });
    const { container } = render(<JobProgress progress={p} compact />);
    expect(container.querySelector("[data-job-progress-next]")?.textContent).toBe("We're looking into it");
    expect(container.querySelector("[data-job-progress-body]")?.textContent).toBe(BODY);
  });
  it("the job page's tracker under the next-step line repeats neither", () => {
    const p = jobProgress(job as never, { viewer: "poster", otherFirst: "Dana", now: NOW });
    const { container } = render(<JobProgress progress={{ ...p, next: "" }} />);
    expect(container.querySelector("[data-job-progress-body]")).toBeNull();
  });
});
