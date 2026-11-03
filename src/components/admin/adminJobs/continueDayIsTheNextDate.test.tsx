/**
 * Owner report 11-03: Admin → Jobs said "Sun, Nov 1" and "Date needed has passed", and counted job 7b1da54b (Mow and
 * Weed Eat, in_progress) "stale-dated", though it has an agreed continue day (job_continue_days new_date 2026-11-05,
 * status 'set', Helpr confirmed, not closed). The card and the stale check read only jobs.date_needed.
 *
 * Now the next date is the latest OPEN continue day ('set', not closed), else date_needed: on the card ("· continues")
 * and in the stale-date flag that sorts a row last. Admins can read job_continue_days (20261103212624; PGlite proof
 * src/test/pglite/adminJobsReadContinueDays.pglite.mjs).
 */
// @mutate src/components/admin/adminJobs/adminJobsHelpers.ts |   if (isPastDue(nextJobDate(job, continueDate).date)) { |   if (isPastDue(job.date_needed)) {
// @mutate src/components/admin/adminJobs/adminJobsHelpers.ts |     if (r.status !== "set" \|\| r.closed_at) continue; |     if (r.closed_at) continue;
// @mutate src/components/admin/adminJobs/adminJobsHelpers.ts |     if (!prev \|\| r.new_date > prev) out.set(r.job_id, r.new_date); |     if (!prev) out.set(r.job_id, r.new_date);
// @mutate src/components/admin/adminJobs/JobListItem.tsx | {formatJobDate(next.date)}{next.continues ? " · continues" : ""} | {formatJobDate(job.date_needed)}
// @mutate src/components/admin/AdminJobs.tsx |           const detected = detectFlags(job, nextDates.get(job.id)); |           const detected = detectFlags(job);
// @mutate src/components/admin/AdminJobs.tsx |  continueDate={continueDates.get(job.id)} |  continueDate={undefined}
// @mutate src/components/admin/adminJobs/JobDetailDialog.tsx | {continueDate && <p className="text-ds-12 text-foreground" data-admin-continues="">Continues: {formatJobDate(continueDate)}</p>} | {null}
// @mutate src/components/admin/AdminJobs.tsx |  continueDate={detailJob ? continueDates.get(detailJob.id) : undefined} |  continueDate={undefined}
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { detectFlags, isStaleOnly, nextJobDate, openContinueDates, STALE_DATE_FLAG, type ContinueDayRow } from "./adminJobsHelpers";
import { JobListItem } from "./JobListItem";
import type { Job } from "./types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { blankComments } from "@/test/helpers/blankNonCode";

const PAST = jobLocalDateISO(-2);
const AHEAD = jobLocalDateISO(2);
const job = (o: Partial<Job> = {}): Job =>
  ({
    id: "7b1da54b-b59c-458a-9017-d4da604a1f1b",
    title: "Mow and Weed Eat",
    description: "Mow the front and back yard and weed eat the edges.",
    budget: 60,
    status: "in_progress",
    payment_status: "escrow",
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    date_needed: PAST,
    category: "yard",
    location: "Abbeville, LA",
    ...o,
  }) as unknown as Job;

const row = (o: Partial<ContinueDayRow> = {}): ContinueDayRow => ({ job_id: "j1", new_date: AHEAD, status: "set", closed_at: null, ...o });

describe("the job's next date is its open continue day", () => {
  it("only a 'set', unclosed continue day counts, and the latest one wins", () => {
    const m = openContinueDates([
      row({ job_id: "a", new_date: "2026-11-05" }),
      row({ job_id: "a", new_date: "2026-11-07" }),
      row({ job_id: "b", status: "proposed" }),
      row({ job_id: "c", closed_at: "2026-11-02T10:00:00Z" }),
      row({ job_id: "d", status: "declined" }),
    ]);
    expect([...m.entries()]).toEqual([["a", "2026-11-07"]]);
  });

  it("a past first date with a continue day ahead is not stale-dated", () => {
    expect(detectFlags(job())).toContain(STALE_DATE_FLAG); // control: no continue day, the first date has passed
    const flags = detectFlags(job(), AHEAD);
    expect(flags).not.toContain(STALE_DATE_FLAG);
    expect(isStaleOnly(flags)).toBe(false);
  });

  it("a continue day that has itself passed is still stale-dated", () => {
    expect(detectFlags(job(), jobLocalDateISO(-1))).toContain(STALE_DATE_FLAG);
  });

  it("nextJobDate: the continue day when there is one, else date_needed", () => {
    expect(nextJobDate(job(), AHEAD)).toEqual({ date: AHEAD, continues: true });
    expect(nextJobDate(job(), undefined)).toEqual({ date: PAST, continues: false });
  });
});

describe("the admin card shows the next date", () => {
  it("'<day> · continues', and no 'Date needed has passed'", () => {
    render(<JobListItem job={job()} flags={detectFlags(job(), AHEAD)} isResolved={false} onOpen={() => {}} continueDate={AHEAD} />);
    expect(screen.getByText(/· continues$/)).toBeInTheDocument();
    expect(screen.queryByText("Date needed has passed")).toBeNull();
  });

  it("control: no continue day, the first date and the passed note", () => {
    render(<JobListItem job={job()} flags={detectFlags(job())} isResolved={false} onOpen={() => {}} />);
    expect(screen.queryByText(/· continues$/)).toBeNull();
    expect(screen.getByText("Date needed has passed")).toBeInTheDocument();
  });

  it("AdminJobs reads the open continue days and hands them to the flags and the card", () => {
    const src = blankComments(readFileSync("src/components/admin/AdminJobs.tsx", "utf8"));
    expect(src).toContain("fetchOpenContinueDates()");
    expect(src).toContain("detectFlags(job, nextDates.get(job.id))");
    expect(src).toContain("continueDate={continueDates.get(job.id)}");
    expect(src.length).toBeGreaterThan(1000);
  });

  it("the job dialog keeps the first date and adds 'Continues: <day>' (lead 11-03)", () => {
    const src = blankComments(readFileSync("src/components/admin/AdminJobs.tsx", "utf8"));
    expect(src).toContain("continueDate={detailJob ? continueDates.get(detailJob.id) : undefined}");
    const dialog = blankComments(readFileSync("src/components/admin/adminJobs/JobDetailDialog.tsx", "utf8"));
    expect(dialog).toContain("{formatJobDate(detailJob.date_needed)}");
    expect(dialog).toContain("Continues: {formatJobDate(continueDate)}");
  });
});
