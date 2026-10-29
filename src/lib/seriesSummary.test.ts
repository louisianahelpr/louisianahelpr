/**
 * A2-C41 (audit 2026-10-29, aa9-rh-*): a Helpr never saw how many visits a Repeats job is, or when it ends,
 * before applying: the browse card showed the raw "weekly" (its rows did not carry recurrence_days/weeks) and
 * the apply sheet fell back to it too. One line now says it: "Weekly · 4 visits until Nov 21".
 *
 * @mutate src/lib/format.ts |   const count = visits.length > 0 ? ` · ${visits.length} visit${visits.length === 1 ? "" : "s"}` : ""; |   const count = "";
 * @mutate src/lib/format.ts |   const until = last ? ` until ${formatShortDate(last)}` : ""; |   const until = "";
 * @mutate src/components/dashboard/JobCard.tsx | {seriesSummary(job) ?? formatRecurrenceInterval(job.recurrence_interval)} | {job.recurrence_interval \|\| "Recurring"}
 * @mutate src/components/dashboard/JobDetailDialog.tsx | {seriesSummary(job as Parameters<typeof seriesSummary>[0]) ?? recurrenceShapeLabel( | {(recurrenceShapeLabel(
 * @mutate src/hooks/useDashboardData.ts | recurrence_end_date, recurrence_days, recurrence_weeks, parent_job_id | recurrence_end_date, parent_job_id
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { seriesSummary } from "@/lib/format";
import { blankComments } from "@/test/helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));

describe("seriesSummary: the size of a Repeats job, before a Helpr agrees to it (A2-C41)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-29T15:00:00Z")); });
  afterAll(() => { vi.useRealTimers(); });

  it("Saturdays for 4 weeks from Oct 31: Weekly · 4 visits until Nov 21", () => {
    expect(seriesSummary({ date_needed: "2026-10-31", recurrence_interval: "weekly", recurrence_days: [6], recurrence_weeks: 4, recurrence_end_date: "2026-11-21" }))
      .toBe("Weekly · 4 visits until Nov 21");
  });

  it("the inventory is real: a one-time job has no series line", () => {
    expect(seriesSummary({ date_needed: "2026-10-31", recurrence_days: null })).toBeNull();
    expect(seriesSummary({ date_needed: "2026-10-31", recurrence_days: [] })).toBeNull();
  });

  it("no week count stored: still the interval and the end date, never a made-up count", () => {
    expect(seriesSummary({ date_needed: "2026-10-31", recurrence_interval: "weekly", recurrence_days: [6], recurrence_weeks: null, recurrence_end_date: "2026-11-21" }))
      .toBe("Weekly until Nov 21");
  });

  it("the browse card and the apply sheet print it, and the browse read carries the fields it needs", () => {
    expect(read("src/components/dashboard/JobCard.tsx")).toMatch(/\{seriesSummary\(job\)/);
    expect(read("src/components/dashboard/JobDetailDialog.tsx")).toMatch(/\{seriesSummary\(job/);
    expect(read("src/hooks/useDashboardData.ts")).toMatch(/recurrence_days, recurrence_weeks/);
  });
});
