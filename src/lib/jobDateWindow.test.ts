/**
 * Q2408: a window job reads as a window on every card, never as its first day.
 *
 * @mutate src/lib/jobDateWindow.ts |   if (!hasDateWindow(job)) return formatJobDate(job.date_needed); |   return formatJobDate(job.date_needed);
 * @mutate src/lib/jobDateWindow.ts |   return hasDateWindow(job) ? job.date_window_end! : job.date_needed; |   return job.date_needed;
 * @mutate src/lib/jobDateWindow.ts | export const DATE_WINDOW_EXTRA_DAYS = 6; | export const DATE_WINDOW_EXTRA_DAYS = 7;
 * @mutate src/components/dashboard/JobCard.tsx | {jobDayLabel(job)} | {formatJobDate(job.date_needed)}
 * @mutate src/components/job-card/MineJobFace.tsx |     job.date_needed ? jobDayLabel(job) : null, |     job.date_needed ? formatJobDate(job.date_needed) : null,
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { trackedFiles } from "@/test/helpers/trackedFiles";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobDayLabel, jobLastDay, weekWindowEnd, hasDateWindow, DATE_WINDOW_EXTRA_DAYS } from "./jobDateWindow";

describe("Q2408 job date window", () => {
  it("a one-day job reads as its day; a window reads as a window", () => {
    expect(jobDayLabel({ date_needed: "2026-11-04" })).toBe("Wed, Nov 4");
    expect(jobDayLabel({ date_needed: "2026-11-04", date_window_end: null })).toBe("Wed, Nov 4");
    expect(jobDayLabel({ date_needed: "2026-11-04", date_window_end: "2026-11-10" })).toBe("Any day Nov 4-10");
    expect(jobDayLabel({ date_needed: "2026-10-30", date_window_end: "2026-11-05" })).toBe("Any day Oct 30-Nov 5");
    expect(jobDayLabel({ date_needed: null })).toBe("");
  });

  it("an end not after the first day is not a window", () => {
    expect(hasDateWindow({ date_needed: "2026-11-04", date_window_end: "2026-11-04" })).toBe(false);
    expect(jobDayLabel({ date_needed: "2026-11-04", date_window_end: "2026-11-01" })).toBe("Wed, Nov 4");
  });

  it("the window is the first day plus 6 (7 days), across a month end", () => {
    expect(weekWindowEnd("2026-11-04")).toBe("2026-11-10");
    expect(weekWindowEnd("2026-12-28")).toBe("2027-01-03");
  });

  it("the last day is the window's end, else the one day", () => {
    expect(jobLastDay({ date_needed: "2026-11-04", date_window_end: "2026-11-10" })).toBe("2026-11-10");
    expect(jobLastDay({ date_needed: "2026-11-04" })).toBe("2026-11-04");
    expect(jobLastDay({})).toBeNull();
  });

  it("the client's 6 matches the database CHECK (newest migration naming it)", () => {
    const dir = "supabase/migrations";
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const hits = files.filter((f) => readFileSync(`${dir}/${f}`, "utf8").includes("jobs_date_window_end_in_a_week"));
    expect(hits.length).toBeGreaterThan(0);
    const sql = readFileSync(`${dir}/${hits[hits.length - 1]}`, "utf8");
    expect(sql).toMatch(new RegExp(`date_window_end <= date_needed \\+ ${DATE_WINDOW_EXTRA_DAYS}\\b`));
  });

  it("no screen prints a job's day with formatJobDate(job.date_needed): it would show a window as its first day", () => {
    const files = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/") && f !== "src/lib/jobDateWindow.ts");
    expect(files.length).toBeGreaterThan(500);
    const hits = files.filter((f) => /formatJobDate\(\s*job\??\.date_needed\s*\)/.test(blankComments(readFileSync(f, "utf8"))));
    // ApplyTimeQuestion asks "Does <first day> work?" on purpose, and only after hasDateWindow says it is a window.
    // @two-way src/lib/jobDateWindow.test.ts:stale allowlist entry (no longer prints the first day)
    const ALLOWED = ["src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx"];
    for (const f of ALLOWED) expect(hits, `${f}: stale allowlist entry (no longer prints the first day), remove it`).toContain(f);
    for (const f of ALLOWED) expect(readFileSync(f, "utf8")).toMatch(/hasDateWindow\(job\) \? formatJobDate\(job\.date_needed\)/);
    expect(hits.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });
});
