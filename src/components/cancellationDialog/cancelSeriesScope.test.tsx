/**
 * Q2677 (audit 1102e row 15): a recurring job's "Cancel job" opened the single-job sheet with no word on
 * whether it cancels this visit or the whole series. poster_cancel_job cancels ONLY the row it is given
 * (newest definition: supabase/migrations/20261102074317_cancel_fee_waived_payee_under_review.sql, its one
 * `UPDATE public.jobs ... WHERE id = v_job.id`); a booked visit is its own jobs row (parent_job_id set), and
 * charge-recurring-visits counts a visit row of ANY status on a date as booked and never scans a cancelled
 * parent. So: a visit sheet says only that visit is cancelled and the series goes on; a series sheet says
 * the whole series ends and an already-booked visit still goes ahead. The page passes the job's own fields,
 * so a failed (or preview-shimmed) second read can no longer drop the line.
 */
// @mutate src/components/cancellationDialog/CancelDialogNotices.tsx |   if (row.parent_job_id) return "visit"; |   if (row.parent_job_id) return null;
// @mutate src/components/cancellationDialog/CancelDialogNotices.tsx | The rest of the series goes on as planned. | Every future visit stops.
// @mutate src/components/cancellationDialog/CancelDialogNotices.tsx |   if (scope === "series") return `Cancel the whole "${jobTitle}" series?`; |   if (scope === "series") return `Cancel "${jobTitle}"?`;
// @mutate src/components/CancellationDialog.tsx |           {seriesScope && <CancelSeriesNotice scope={seriesScope} jobDate={jobDate} />} |           {seriesScope === "series" && <CancelSeriesNotice scope={seriesScope} jobDate={jobDate} />}
// @mutate src/components/CancellationDialog.tsx |   const seriesScope = passedScope !== undefined ? passedScope : readScope; |   const seriesScope = readScope;
// @mutate src/components/job-card/ActivityDialogs.tsx |           parentJobId={props.cancelDialogJob.parent_job_id} |           parentJobId={undefined}
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CancellationDialog } from "@/components/CancellationDialog";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
// The fallback read answers "no series" (as the preview shim did): a passed prop must still win.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const base = {
  jobId: "job-1",
  jobTitle: "Mow and edge the lawn",
  jobDate: "2026-11-05",
  jobStartTime: "09:00:00",
  jobBudget: 60,
  hasHelper: true,
  wasFunded: true,
  helperName: "Eli",
  open: true,
  onClose: vi.fn(),
  onCancelled: vi.fn(),
};

describe("Q2677 the recurring cancel sheet says what it cancels", () => {
  it("a visit: only that visit, the series goes on", () => {
    render(<CancellationDialog {...base} parentJobId="parent-1" recurrenceDays={null} />);
    expect(screen.getByText("Cancel only the Thu, Nov 5 visit?")).toBeInTheDocument();
    const line = screen.getByTestId("cancel-series-scope").textContent ?? "";
    expect(line).toBe("This cancels only the visit on Thu, Nov 5. The rest of the series goes on as planned.");
    expect(line).not.toMatch(/whole series/);
  });

  it("the series itself: the whole series, an already-booked visit still goes ahead", () => {
    render(<CancellationDialog {...base} parentJobId={null} recurrenceDays={[2, 4]} />);
    expect(screen.getByText('Cancel the whole "Mow and edge the lawn" series?')).toBeInTheDocument();
    expect(screen.getByTestId("cancel-series-scope").textContent).toBe(
      "This cancels the whole series. No more visits are booked. A visit that is already booked still goes ahead.",
    );
  });

  it("a one-off job: the plain title and no scope line", () => {
    render(<CancellationDialog {...base} parentJobId={null} recurrenceDays={null} />);
    expect(screen.getByText('Cancel "Mow and edge the lawn"?')).toBeInTheDocument();
    expect(screen.queryByTestId("cancel-series-scope")).toBeNull();
  });

  it("the page passes the job's own series fields to the sheet", () => {
    const src = blankComments(readFileSync("src/components/job-card/ActivityDialogs.tsx", "utf8"));
    expect(src).toContain("parentJobId={props.cancelDialogJob.parent_job_id}");
    expect(src).toContain("recurrenceDays={props.cancelDialogJob.recurrence_days}");
  });

  it("the copy matches poster_cancel_job: one UPDATE, on the given row only", () => {
    const sql = readFileSync("supabase/migrations/20261102074317_cancel_fee_waived_payee_under_review.sql", "utf8");
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.poster_cancel_job"), sql.indexOf("REVOKE ALL ON FUNCTION public.poster_cancel_job"));
    const updates = body.match(/UPDATE public\.jobs[\s\S]*?WHERE[^;]*;/g) ?? [];
    expect(updates.length).toBe(1);
    expect(updates[0]).toMatch(/WHERE id = v_job\.id;$/);
    expect(body).not.toMatch(/parent_job_id/);
  });
});
