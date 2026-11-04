// Q2408 live proof (Builder 1, 2026-11-04): an "Any time this week" job posted on prod as the seed poster stored
// date_needed 2026-11-05 and date_window_end 2026-11-11, but Post a job's review step (screen 5) read
// "When Thu, Nov 5 · 9:00 AM · Flexible": the one place left that printed a window job's first day as its day
// (shot ~/.lh-shots/b1-q2408/3-after-submit.png). It now prints jobDayLabel, as every card does.
//
// Red first: on origin/main d76ecc310b the window case below fails (the row reads "Thu, Nov 5").
//
// @mutate src/components/postjob/CheckoutStep.tsx | jobDayLabel({ date_needed: whenDate, date_window_end: dateWindowEnd }) | formatJobDate(whenDate)
// @mutate src/pages/post-job/CheckoutStepView.tsx |         dateWindowEnd={form.dateWindowEnd} |         dateWindowEnd={null}
// Same walk: the shared card meta row (My Posts' PostedJobMetaRow, the Helpr's AppliedJobCard) printed
// formatJobDate(dateNeeded) itself, so an open window job's card read its first day too.
// @mutate src/components/job-card/JobCardMetaRow.tsx | {jobDayLabel({ date_needed: dateNeeded, date_window_end: dateWindowEnd })} | {jobDayLabel({ date_needed: dateNeeded, date_window_end: null })}
// @mutate src/pages/posts/postedJobCard/PostedJobMetaRow.tsx |         dateWindowEnd={job.date_window_end ?? null} |         dateWindowEnd={null}
// The hire sheet ("Your job moves from <posted when> to this time") and the Applicants header printed the first day too.
// @mutate src/components/ResponseDeadlineDialog.tsx | [jobDayLabel(postedJob), jobStartTimeLabel | [formatJobDate(postedJob.date_needed!), jobStartTimeLabel
// @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | selectedJob.date_needed ? jobDayLabel(selectedJob) : null | selectedJob.date_needed ? String(selectedJob.date_needed) : null
// @mutate src/pages/jobs/AppliedJobCard.tsx |         dateWindowEnd={job.date_window_end ?? null} |         dateWindowEnd={null}
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutStepView } from "./CheckoutStepView";
import { JobCardMetaRow } from "@/components/job-card/JobCardMetaRow";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { usePostJobForm } from "./usePostJobForm";

vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));
vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));

function makeForm(over: Record<string, unknown> = {}): ReturnType<typeof usePostJobForm> {
  return {
    setStep: vi.fn(), title: "Clean my kitchen", description: "Counters, floor and the stove top.", categoryLabel: "Cleaning",
    category: "cleaning", imagePreviews: [], streetAddress: "314 Lynn St", city: "Delcambre", addrState: "LA", zipCode: "70528",
    dateNeeded: "2026-11-05", dateWindowEnd: null, startTime: "09:00", estimatedHours: "", isFlexibleSchedule: true, specialRequirements: "",
    isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
    isGroupJob: false, helpersNeeded: "2",
    isUrgent: false, urgentFeeNum: 0, budgetNum: 25, helprActivity: null, customerFeeAmount: 0, onboardingFeeAmount: 0,
    totalCharge: 25, hasGift: false, giftAppliedAmount: 0, giftCreditAmount: 0, giftLoading: false, giftUnavailable: false,
    confirmed: false, setConfirmed: vi.fn(), saveCardForFuture: false, setSaveCardForFuture: vi.fn(), saving: false,
    redirecting: false, uploading: false, uploadProgress: null, handleSubmit: vi.fn(), parish: "Vermilion",
    ...over,
  } as unknown as ReturnType<typeof usePostJobForm>;
}

const whenRow = () => (screen.getByText("When").closest("div")!.textContent ?? "").replace(/\s+/g, " ");

describe("Q2408: Post a job's review prints an 'Any time this week' window, not its first day", () => {
  it("Nov 5 through Nov 11 reads 'Any day Nov 5-11'", () => {
    render(<CheckoutStepView form={makeForm({ dateWindowEnd: "2026-11-11" })} />);
    const row = whenRow();
    expect(row).toContain("Any day Nov 5-11");
    expect(row).not.toContain("Thu, Nov 5");
  });

  it("a one-day job keeps its day", () => {
    render(<CheckoutStepView form={makeForm({ isFlexibleSchedule: false })} />);
    expect(whenRow()).toContain("Thu, Nov 5");
    expect(whenRow()).not.toMatch(/Any day/);
  });
});

describe("Q2408: the shared card meta row prints the window (My Posts and the Helpr's applied card)", () => {
  it("a window prints 'Any day Nov 5-11'; a one-day job keeps 'Thu, Nov 5'", () => {
    const { unmount } = render(<JobCardMetaRow dateNeeded="2026-11-05" dateWindowEnd="2026-11-11" startTime={null} location="Delcambre, LA" expiresAt={null} />);
    expect(screen.getByText("Any day Nov 5-11")).toBeTruthy();
    unmount();
    render(<JobCardMetaRow dateNeeded="2026-11-05" startTime={null} location="Delcambre, LA" expiresAt={null} />);
    expect(screen.getByText("Thu, Nov 5")).toBeTruthy();
  });
  const callers = ["src/pages/posts/postedJobCard/PostedJobMetaRow.tsx", "src/pages/jobs/AppliedJobCard.tsx"];
  for (const f of callers) {
    it(`${f} passes the job's window to the row`, () => {
      const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "..", f), "utf8"));
      expect(src).toMatch(/dateNeeded=\{job\.date_needed\}\s*dateWindowEnd=\{job\.date_window_end \?\? null\}/);
    });
  }
  it("inventory: both card callers are checked", () => expect(callers.length).toBeGreaterThan(1));
});

describe("Q2408: the hire sheet and the Applicants header print the window", () => {
  it("hiring a Helpr who picked Fri, Nov 6 on a window job: 'moves from Any day Nov 5-11'", () => {
    Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
    const job = { title: "Clean my kitchen", date_needed: "2026-11-05", date_window_end: "2026-11-11", start_time: null, budget: 25, is_group_job: false, urgent_fee: null, is_flexible_schedule: true };
    render(<ResponseDeadlineDialog open helperName="Andre Landry" job={job} suggestedTime={{ date: "2026-11-06", time: "10:00" }} onConfirm={() => {}} onClose={() => {}} />);
    expect(document.body.textContent).toContain("Your job moves from Any day Nov 5-11");
    expect(document.body.textContent).not.toContain("moves from Thu, Nov 5");
  });
  it("ApplicantsPanel's job line prints jobDayLabel", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "..", "src/pages/posts/postedJobs/ApplicantsPanel.tsx"), "utf8"));
    expect(src).toMatch(/selectedJob\.date_needed \? jobDayLabel\(selectedJob\) : null/);
  });
});
