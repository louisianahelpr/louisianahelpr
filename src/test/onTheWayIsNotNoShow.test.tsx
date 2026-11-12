/**
 * F283, the No-show half (whole-app audit 11-10, poster's Job page, on the way, Mow a front lawn): the header said
 * "Hallie is on the way" while the progress bar replaced Arrived with a red "No-show". A Helpr who set out and has
 * not arrived is running late: the bar marks Arrived "Late" ("Running late" read aloud). A Helpr who never set out is
 * still a No-show on the bar.
 *
 * @mutate src/components/tracker/jobStepFromWait.ts | job.helper_on_the_way_at && !job.helper_arrived_at ? "Running late" : "No-show?" | "No-show?"
 * @mutate src/components/tracker/stepWords.ts | "Running late": "js.l.late",  | 
 */
import { describe, expect, it } from "vitest";
import { cardBar } from "@/components/tracker/jobStepFromWait";
import { render } from "@testing-library/react";
import { JobProgress, jobStepsLabel } from "@/components/tracker/JobProgress";

const booked = { date_needed: "2024-10-30", helper_confirmed_at: "x", helper_dayof_confirmed_at: "x", poster_confirmed_at: "x" };
const face = (id: string) => ({ line: { id, tone: "you" as const, detail: "" }, face: null });

describe("F283: on the way past the start is Running late, not No-show", () => {
  it("in progress and on the way: Arrived reads Running late", () => {
    for (const id of ["overdue_no_show", "overdue_not_arrived"]) {
      const bar = cardBar("poster", face(id), { ...booked, helper_on_the_way_at: "2024-10-30T19:00:00Z" }, 0);
      expect({ id, bar }).toMatchObject({ id, bar: { stage: 5, tone: "problem", label: "Running late" } });
    }
  });

  it("never set out: still No-show", () => {
    const bar = cardBar("poster", face("overdue_no_show"), booked, 0);
    expect(bar).toMatchObject({ stage: 4, tone: "problem", label: "No-show?" });
  });

  it("drawn as the short word Late, read aloud as Running late", () => {
    expect(jobStepsLabel(5, false, "problem", "Running late")).toContain("Arrived, Running late, needs attention.");
    const { container } = render(<JobProgress barOnly progress={{ stage: 5, waitingOnYou: false, tone: "problem", label: "Running late", word: "", next: "", held: false }} />);
    const step = container.querySelector("[data-step-state='problem']")?.textContent ?? "";
    expect(step).toContain("Late");
    expect(step).not.toMatch(/Running|No-show/);
  });
});
