/**
 * F260q: the tracker's deadline is HANDED BACK where the line is made (JobProgressState.nextBy, JobStatusLine.detailBy),
 * never read back out of the English words (jobNextStep's old BY_DAY regex, / by (Mon|Tue|...)/), so the line can be
 * worded in any language. Inventory: every jobProgressState line that carries a "by <when>" (the Helpr's and the poster's
 * confirm, waiting on the other side's confirm, the fix asked for on both sides) and the card's confirmed line.
 *
 * @mutate src/components/tracker/jobProgressState.ts |   return { ...p, nextBy: { line: p.next, text, by } }; |   return p;
 * @mutate src/components/tracker/jobProgressState.ts |   return by && by.line === p.next ? { ...coded, nextBy: by } : coded; |   return coded;
 * @mutate src/components/job-card/jobStatusLine.ts |     ...(detailBy ? { detailBy } : {}), |
 * @mutate src/components/job-card/jobStatusLine.ts |   return detail === `${text} ${by}` ? { line: detail, text, by } : null; |   return { line: detail, text, by };
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";

// Sat Nov 7 2054, 4:00 PM in Louisiana (CST); the job is Sun Nov 8 at 10:00 AM (confirm window open, not passed).
const NOW = new Date("2054-11-07T22:00:00Z");
const job = (over: Partial<Job> = {}): ProgressJob => ({
  id: "j1", title: "Haul off an old couch", status: "accepted", payment_status: "escrow", helper_id: "h", customer_id: "p",
  date_needed: "2054-11-08", start_time: "10:00", helper_confirmed_at: "2054-10-01T00:00:00Z", poster_confirmed_at: null,
  helper_dayof_confirmed_at: null, ...over,
}) as unknown as ProgressJob;
const step = (j: ProgressJob, side: "poster" | "helpr") =>
  jobNextStep(jobProgress(j, { viewer: side, otherFirst: side === "poster" ? "Yusef" : "Dana", now: NOW }), { side, otherFirst: side === "poster" ? "Yusef" : "Dana" });

describe("F260q: the tracker hands its deadline back beside the line", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());

  it("the Helpr's confirm and the poster's confirm carry their deadline", () => {
    expect(step(job(), "helpr")).toMatchObject({ text: "Confirm you'll be at the job", by: "by Sun 8:00 AM" });
    expect(step(job(), "poster")).toMatchObject({ text: "Confirm the job is still on", by: "by Sun 10:00 AM" });
  });

  it("waiting on the other side's confirm carries its deadline", () => {
    expect(step(job({ poster_confirmed_at: "2054-11-07T20:00:00Z" } as Partial<Job>), "poster")).toMatchObject({ text: "Waiting on Yusef to confirm", by: "by Sun 8:00 AM" });
    expect(step(job({ helper_dayof_confirmed_at: "2054-11-07T20:00:00Z" } as Partial<Job>), "helpr")).toMatchObject({ text: "Waiting on Dana to confirm", by: "by Sun 10:00 AM" });
  });

  it("the fix asked for carries its deadline on both sides", () => {
    const fix = job({ status: "revision_requested", revision_deadline: "2054-11-09T15:00:00Z", helper_arrived_at: "2054-11-07T15:00:00Z", poster_confirmed_working_at: "2054-11-07T15:05:00Z", helper_completed_at: "2054-11-07T18:00:00Z", revision_requested_at: "2054-11-07T19:00:00Z", poster_confirmed_at: "2054-11-07T13:00:00Z", helper_dayof_confirmed_at: "2054-11-07T13:00:00Z" } as Partial<Job>);
    const p = jobProgress(fix, { viewer: "helpr", otherFirst: "Dana", now: NOW });
    expect(p.nextBy).toEqual({ line: p.next, text: "Fix it and mark it done", by: "by Mon 9:00 AM" });
    const q = jobProgress(fix, { viewer: "poster", otherFirst: "Yusef", now: NOW });
    expect(q.nextBy).toEqual({ line: q.next, text: "Waiting on Yusef's fix", by: "by Mon 9:00 AM" });
  });

  it("the card's confirmed line hands back its deadline, and only when the detail is that line", () => {
    const waiting = job({ poster_confirmed_at: "2054-11-07T20:00:00Z" } as Partial<Job>) as unknown as Job;
    const line = posterStatusLine(waiting, 0, NOW, undefined, false, "Yusef Smith");
    expect(line.detail).toBe("Waiting on Yusef to confirm by Sun 8:00 AM");
    expect(line.detailBy).toEqual({ line: line.detail, text: "Waiting on Yusef to confirm", by: "by Sun 8:00 AM" });
    const before = posterStatusLine(job({ date_needed: "2054-11-10" } as Partial<Job>) as unknown as Job, 0, NOW, undefined, false, "Yusef Smith");
    expect(before.detailBy).toBeUndefined();
  });

  it("the tracker keeps the card's deadline when its line is the card's", () => {
    const next = "Waiting on Yusef to confirm by Sun 8:00 AM";
    const card = { line: { id: "confirmed", eyebrow: "Waiting", detail: next, tone: "them", owesConfirmation: false, detailBy: { line: next, text: "Waiting on Yusef to confirm", by: "by Sun 8:00 AM" } } };
    const p = jobProgress(job({ status: "in_progress", helper_on_the_way_at: "2054-11-07T21:00:00Z", poster_confirmed_at: "2054-11-07T20:00:00Z", helper_dayof_confirmed_at: "2054-11-07T20:00:00Z" } as Partial<Job>),
      { viewer: "poster", otherFirst: "Yusef", now: NOW, card: card as never });
    if (p.next === next) expect(p.nextBy?.by).toBe("by Sun 8:00 AM");
  });

  it("jobNextStep never reads a deadline out of the words", () => {
    const src = readFileSync(resolve(__dirname, "../components/tracker/jobNextStep.ts"), "utf8");
    expect(src).not.toMatch(/Mon\|Tue\|Wed/);
  });
});
