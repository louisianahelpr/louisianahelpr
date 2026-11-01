/**
 * A2-C41 rest / A2-C42 rest (audit 2026-10-29). A Repeats job's size, "Weekly · 4 visits until Nov 21"
 * (seriesSummary), reached the browse card and the apply sheet (seriesSummary.test.ts) but not the three
 * places after it: the "Application sent" sheet, the poster's Hire dialog, and the hired Helpr's own
 * /jobs/:id, which also lacked the standing Helpr's Leave series (their Activity card had it).
 *
 * @mutate src/components/dashboard/ApplicationSentDialog.tsx |   if (series) return date ? `Do the job: ${series}, starting ${date}` : `Do the job: ${series}`; |
 * @mutate src/components/ResponseDeadlineDialog.tsx |   const seriesLine = job ? seriesSummary(job) : null; |   const seriesLine = null;
 * @mutate src/pages/jobs/jobPage/HiredSeriesSection.tsx |   const canLeave = job.recurring_helper_id === userId && job.helper_id === userId && | const canLeave = job.helper_id === userId &&
 * @mutate src/pages/jobs/jobPage/HiredSeriesSection.tsx |   const line = isSeries ? seriesSummary(job) : null; |   const line = isSeries ? "Repeats" : null;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |           {isHired && <HiredSeriesSection job={job} userId={userId} />}\n |
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | payout_scheduled_at, parent_job_id, recurrence_days, recurrence_weeks, recurrence_interval, recurrence_end_date, recurring_helper_id, direct_offer_status, latitude, longitude"; | payout_scheduled_at, direct_offer_status, latitude, longitude";
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";
import { HiredSeriesSection } from "@/pages/jobs/jobPage/HiredSeriesSection";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, loading: false }) }));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));
vi.mock("@/lib/jobSeriesState", () => ({ fetchJobSeriesState: async () => new Map() }));
vi.mock("@/components/series/EndSeriesControl", () => ({
  EndSeriesControl: ({ mode }: { mode?: string }) => <button type="button">{mode === "leave" ? "Leave series" : "End series"}</button>,
}));
vi.mock("@/components/series/JobSeriesCardControls", () => ({ SeriesDatesForJob: () => null }));

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
// The clock is frozen at Thu Oct 29 2026 (beforeAll), so jobLocalDateISO(2) is Sat, Oct 31; read after the freeze.
const series = () => ({ date_needed: jobLocalDateISO(2), recurrence_interval: "weekly", recurrence_days: [6], recurrence_weeks: 4, recurrence_end_date: "2026-11-21" });
const LINE = "Weekly · 4 visits until Nov 21";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});
afterAll(() => { vi.useRealTimers(); });

describe("the Application sent sheet says every visit applied for", () => {
  it("a Repeats job: Do the job: Weekly · 4 visits until Nov 21, starting Sat, Oct 31", () => {
    const job = { id: "j1", title: "Mow", budget: 40, ...series() };
    render(<ApplicationSentDialog sent={{ jobId: "j1", title: "Mow", noteWithheld: false, dateNeeded: job.date_needed, job: job as never }} onClose={() => {}} onView={() => {}} />);
    const steps = within(screen.getByTestId("what-next-sheet")).getAllByRole("listitem");
    expect(steps[3].textContent).toContain(`Do the job: ${LINE}, starting Sat, Oct 31`);
  });

  it("a one-time job keeps its one date", () => {
    render(<ApplicationSentDialog sent={{ jobId: "j2", title: "Mow", noteWithheld: false, dateNeeded: jobLocalDateISO(2), job: { id: "j2", budget: 40, date_needed: jobLocalDateISO(2), recurrence_days: null } as never }} onClose={() => {}} onView={() => {}} />);
    const steps = within(screen.getByTestId("what-next-sheet")).getAllByRole("listitem");
    expect(steps[3].textContent).toContain("Do the job, Sat, Oct 31");
    expect(steps[3].textContent).not.toContain("visits");
  });
});

describe("the poster's Hire dialog says every visit the hire covers", () => {
  it("a Repeats job shows the series line under the date", () => {
    render(<ResponseDeadlineDialog open helperName="Andre" job={{ title: "Mow", start_time: "09:00", budget: 40, ...series() }} onConfirm={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-hire-series]")?.textContent).toBe(LINE);
  });

  it("a one-time job has no series line", () => {
    render(<ResponseDeadlineDialog open helperName="Andre" job={{ title: "Mow", date_needed: jobLocalDateISO(2), start_time: "09:00", budget: 40 }} onConfirm={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-hire-series]")).toBeNull();
  });
});

describe("the hired Helpr's /jobs/:id carries the series line and Leave series", () => {
  const base = () => ({ id: "p1", title: "Mow", status: "accepted", helper_id: "h1", parent_job_id: null, ...series() }) as unknown as JobPageRow;
  const renderSection = (job: JobPageRow) =>
    render(<QueryClientProvider client={new QueryClient()}><HiredSeriesSection job={job} userId="h1" /></QueryClientProvider>);

  it("the standing Helpr sees the line and Leave series", async () => {
    renderSection({ ...base(), recurring_helper_id: "h1" });
    expect(document.querySelector("[data-job-series]")?.textContent).toContain(LINE);
    await waitFor(() => expect(screen.getByRole("button", { name: "Leave series" })).toBeInTheDocument());
  });

  it("a Helpr hired on it who is not its standing Helpr sees the line, no Leave series", () => {
    renderSection({ ...base(), recurring_helper_id: "someone-else" });
    expect(document.querySelector("[data-job-series]")?.textContent).toContain(LINE);
    expect(screen.queryByRole("button", { name: "Leave series" })).toBeNull();
  });

  it("a one-time job renders nothing", () => {
    renderSection({ ...base(), recurrence_days: null, recurring_helper_id: "h1" });
    expect(document.querySelector("[data-job-series]")).toBeNull();
  });

  it("JobPage renders it for the hired Helpr, and the party read carries the series fields", () => {
    expect(read("src/pages/jobs/jobPage/JobPage.tsx")).toMatch(/\{isHired && <HiredSeriesSection job=\{job\} userId=\{userId\} \/>\}/);
    const cols = read("src/pages/jobs/jobPage/useJobPage.ts").match(/const PARTY_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "";
    const names = cols.split(",").map((c) => c.trim());
    expect(names.length).toBeGreaterThan(20);
    for (const c of ["parent_job_id", "recurrence_days", "recurrence_weeks", "recurrence_interval", "recurrence_end_date", "recurring_helper_id"]) expect(names, c).toContain(c);
  });
});
