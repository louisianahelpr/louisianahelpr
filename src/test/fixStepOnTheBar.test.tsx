/**
 * F274 (whole-app audit 11-10, Job page, revision requested): the progress bar showed a plain "Done" while a fix was
 * asked for, so the poster could not tell a job waiting on a fix from a finished one. The current step now reads
 * "Fix": on Working while the fix is owed, on Done once the Helpr sent it. Both sides, both moments.
 *
 * @mutate src/components/tracker/jobStepFromWait.ts | const FIX_OWED = at(6, "progress", "Fix"); | const FIX_OWED = at(6, "progress");
 * @mutate src/components/tracker/jobStepFromWait.ts | const FIX_SENT = at(7, "progress", "Fix"); | const FIX_SENT = at(7, "progress");
 * @mutate src/components/tracker/JobProgress.tsx | : (s === "you" \|\| s === "them") && label ? stepWord(label) : null; | : null;
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { JobProgress } from "@/components/tracker/JobProgress";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

const owed: ProgressJob = {
  id: "j274", status: "revision_requested", helper_id: "h", customer_id: "p", payment_status: "escrow",
  date_needed: jobLocalDateISO(-2), start_time: "09:00", helper_confirmed_at: ago(80), helper_dayof_confirmed_at: ago(60),
  poster_confirmed_at: ago(60), helper_on_the_way_at: ago(50), helper_arrived_at: ago(49), poster_confirmed_working_at: ago(49),
  helper_completed_at: ago(40), revision_requested_at: ago(30), revision_deadline: ahead(40),
};
const sent: ProgressJob = { ...owed, revision_completed_at: ago(2), revision_acceptance_deadline: ahead(20) };

const draw = (j: ProgressJob, viewer: "poster" | "helpr") => {
  const p = jobProgress(j, { viewer, otherFirst: viewer === "poster" ? "Eli" : "Lexi", workUnderway: true, tracking: { status: "working" } });
  const { container } = render(<JobProgress progress={p} />);
  const bar = container.querySelector("[data-job-steps]") as HTMLElement;
  const current = container.querySelector('[data-step-state="you"], [data-step-state="them"]') as HTMLElement | null;
  return { p, bar, current };
};

describe("F274: a fix asked for reads Fix on the bar", () => {
  afterEach(cleanup);
  const cases: [string, ProgressJob, "poster" | "helpr", number][] = [
    ["fix owed, poster", owed, "poster", 6],
    ["fix owed, Helpr", owed, "helpr", 6],
    ["fix sent, poster", sent, "poster", 7],
    ["fix sent, Helpr", sent, "helpr", 7],
  ];
  it("covers both sides at both moments", () => {
    expect(cases.length).toBeGreaterThan(3);
  });
  for (const [name, j, viewer, stage] of cases) {
    it(`${name}: the current step says Fix`, () => {
      const { p, bar, current } = draw(j, viewer);
      expect(p.stage).toBe(stage);
      // The drawn word is "Fix"; the hidden name keeps the step's full name beside it ("Fix, Done: ...").
      expect(current?.querySelector(".job-step-full")?.textContent).toBe("Fix");
      expect(bar.getAttribute("aria-label")).toContain("(Fix)");
    });
  }
  it("a job with no fix asked keeps the step's own name", () => {
    const { current } = draw({ ...owed, status: "in_progress", revision_requested_at: null, revision_deadline: null }, "poster");
    expect(current?.textContent ?? "").not.toContain("Fix");
  });
});
