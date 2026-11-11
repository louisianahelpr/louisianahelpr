/**
 * F290a (whole-app audit 11-10, Job page, Helpr view, on the way / arrived): a Helpr past the start time read
 * "Day passed — tap I've arrived" / "Day passed — tap Start" (a scolding, and wrong on the same day), and the bar
 * swapped the step's own name (Arrived, Working) for "Late", so the Helpr lost which step was next.
 * Now: the line says the start time went by and names the tap; the Helpr's bar keeps every step name and marks the
 * stuck one in the warning colour (tone "problem", no replacement word). The poster's bar keeps its words.
 *
 * @mutate src/components/tracker/jobStepFromWait.ts | const LATE_STEP: Entry = (job) => at(stuck(job), "problem"); | const LATE_STEP: Entry = (job) => at(stuck(job), "problem", "Overdue");
 * @mutate src/components/job-card/jobStatusLine.ts | overdue_not_arrived: { detail: "Past the start time — tap I've arrived" }, | overdue_not_arrived: { detail: "Day passed — tap I've arrived" },
 */
import { describe, expect, it } from "vitest";
import { HELPER_WAIT, HELPER_WAIT_IDS } from "@/components/job-card/jobStatusLine";
import { cardBar, HELPER_STEP, POSTER_STEP } from "@/components/tracker/jobStepFromWait";
import { jobStepsLabel } from "@/components/tracker/JobProgress";

const onTheWay = { date_needed: "2024-10-30", helper_confirmed_at: "x", helper_dayof_confirmed_at: "x", poster_confirmed_at: "x", helper_on_the_way_at: "x" };
const face = (id: string) => ({ line: { id, tone: "you" as const, detail: "" }, face: null });

describe("F290a: a late Helpr's line and bar", () => {
  it("the lines say the start time passed, never 'Day passed', and name the tap", () => {
    expect(HELPER_WAIT.overdue_not_arrived.detail).toBe("Past the start time — tap I've arrived");
    expect(HELPER_WAIT.overdue_start_working.detail).toBe("Past the start time — tap Start");
  });

  it("every overdue step on the Helpr's bar keeps its own name (no replacement word)", () => {
    const overdue = HELPER_WAIT_IDS.filter((id) => id.startsWith("overdue_"));
    expect(overdue.length).toBeGreaterThan(6);
    for (const id of overdue) {
      const bar = cardBar("helpr", face(id), onTheWay, 0);
      expect({ id, tone: bar?.tone, label: bar?.label }).toEqual({ id, tone: "problem", label: undefined });
    }
    expect(cardBar("helpr", face("overdue_not_arrived"), onTheWay, 0)?.stage).toBe(5);
    expect(HELPER_STEP.overdue_start_working).toEqual({ stage: 6, tone: "problem" });
  });

  it("the poster's bar still names the problem", () => {
    expect(cardBar("poster", face("stalled"), onTheWay, 0)?.label).toBe("Overdue");
    expect(POSTER_STEP.overdue_unhired).toMatchObject({ label: "Overdue" });
  });

  it("the read-out says 'needs attention' once when the step has no problem word", () => {
    const s = jobStepsLabel(5, false, "problem");
    expect(s).toContain("Arrived, needs attention.");
    expect(s).not.toContain("needs attention, needs attention");
  });
});
