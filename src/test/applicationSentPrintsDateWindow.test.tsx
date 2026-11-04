/**
 * Q2408 reader: after a Helpr applies to an "Any time this week" job, the "Application sent" pop-up's last step says
 * the window ("Do the job, Any day Nov 5-11"), not the window's first day as if the job were booked for it. The apply
 * flow hands the window's last day to the pop-up, and the deep-linked (?quickApply=) read names the column through
 * readJobsAheadOfDb (inventory in dateWindowReadsSurviveOldDb).
 *
 * @mutate src/components/dashboard/ApplicationSentDialog.tsx | jobDayLabel({ date_needed: sent.dateNeeded, date_window_end: sent.dateWindowEnd }) | jobDayLabel({ date_needed: sent.dateNeeded })
 * @mutate src/pages/home/useApplyFlow.ts |         dateWindowEnd: sentJob?.date_window_end ?? null, |         dateWindowEnd: null,
 * @mutate src/pages/home/useApplyFlow.ts | "id, title, budget, category, date_needed, date_window_end, pricing_mode, | "id, title, budget, category, date_needed, pricing_mode,
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, loading: false }) }));

const lastStep = () => {
  const steps = within(screen.getByTestId("what-next-sheet")).getAllByRole("listitem");
  return steps[steps.length - 1].textContent ?? "";
};

describe("Q2408: Application sent says the job's window", () => {
  it("a window job reads as any day of the window", () => {
    render(<ApplicationSentDialog sent={{ jobId: "w1", title: "Rake leaves", noteWithheld: false, dateNeeded: "2037-11-05", dateWindowEnd: "2037-11-11" }} onClose={() => {}} onView={() => {}} />);
    expect(lastStep()).toContain("Do the job, Any day Nov 5-11");
    expect(lastStep()).not.toMatch(/Thu, Nov 5/);
  });

  it("a one-day job still reads as its day", () => {
    render(<ApplicationSentDialog sent={{ jobId: "d1", title: "Rake leaves", noteWithheld: false, dateNeeded: "2037-11-05", dateWindowEnd: null }} onClose={() => {}} onView={() => {}} />);
    expect(lastStep()).toContain("Do the job, Thu, Nov 5");
  });

  it("the apply flow hands the window to the pop-up, and its deep-link read asks for it", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "..", "pages", "home", "useApplyFlow.ts"), "utf8"));
    expect(src).toMatch(/dateWindowEnd: sentJob\?\.date_window_end \?\? null/);
    expect(src).toMatch(/readJobsAheadOfDb\(\s*"[^"]*\bdate_window_end\b[^"]*"/);
  });
});
