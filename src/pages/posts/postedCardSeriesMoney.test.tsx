// A2-C36, posted-card half (app audit 2026-10-29; lead 2026-10-29: "the same words"): the poster's card for a
// running Repeats job showed "$40" on its face and the series strip, with no word that $40 is one visit or when the
// later visits are charged. Now, under the strip: "$40 a visit · 4 visits. Each later visit is charged to your saved
// card about 3 days before it." (seriesMoneyCopy, shared with Review's CheckoutBudgetLine).
//
// Red first (2026-10-29) against origin/main 1a38dea437: no such line rendered.
//
// @mutate src/pages/posts/PostedJobSeriesControls.tsx |   const seriesMoney = visits > 1 && running && budget > 0 ? seriesMoneySentence(budget, visits, hasTaxableLine(job.category)) : null; |   const seriesMoney = null;
// JOBS-28: a taxable category's card adds "plus its sales tax" (charge-recurring-visits taxes each later visit).
// @mutate src/pages/posts/PostedJobSeriesControls.tsx | seriesMoneySentence(budget, visits, hasTaxableLine(job.category)) | seriesMoneySentence(budget, visits)
// @mutate src/pages/posts/PostedJobSeriesControls.tsx |   const running = !job.series_ended_on && job.status !== "cancelled" && job.status !== "completed"; |   const running = true;
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/pages/posts/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/series/JobSeriesCardControls", () => ({ SeriesDatesForJob: () => null }));

const { PostedJobSeriesControls } = await import("./PostedJobSeriesControls");

const SAID = "$40 a visit · 4 visits. Each later visit is charged to your saved card about 3 days before it.";
const series = {
  id: "j1", title: "Mow my lawn", status: "open", parent_job_id: null, recurrence_days: [1], recurrence_weeks: 4,
  date_needed: jobLocalDateISO(4), series_ended_on: null, budget: 40,
};
const line = () => document.querySelector("[data-series-money]")?.textContent ?? null;

describe("A2-C36: the poster's series card says the budget is per visit and when the rest is charged", () => {
  it("a running weekly series of 4 at $40: Review's words", () => {
    render(<PostedJobSeriesControls job={series} userId="p1" />);
    expect(screen.getByText(SAID)).toBeTruthy();
  });

  it("a taxable category (plumbing): the later visits are charged their sales tax too", () => {
    render(<PostedJobSeriesControls job={{ ...series, category: "plumbing" }} userId="p1" />);
    expect(line()).toBe("$40 a visit · 4 visits. Each later visit, plus its sales tax, is charged to your saved card about 3 days before it.");
  });

  it("a visit row of the series (a child) does not repeat it", () => {
    render(<PostedJobSeriesControls job={{ ...series, parent_job_id: "parent" }} userId="p1" />);
    expect(line()).toBeNull();
  });

  it("an ended, cancelled or completed series has no charge ahead, so no line", () => {
    for (const over of [{ series_ended_on: jobLocalDateISO(11) }, { status: "cancelled" }, { status: "completed" }]) {
      const { unmount } = render(<PostedJobSeriesControls job={{ ...series, ...over }} userId="p1" />);
      expect(line(), JSON.stringify(over)).toBeNull();
      unmount();
    }
  });

  it("a one-off job has no line", () => {
    render(<PostedJobSeriesControls job={{ ...series, recurrence_days: null, recurrence_weeks: null }} userId="p1" />);
    expect(line()).toBeNull();
  });
});
