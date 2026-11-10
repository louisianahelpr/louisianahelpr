/**
 * F106 (owner UI audit 2026-11-09, Posted > Done: "Show 'Done · Oct 24' once"): every poster Done line that opens
 * with "Done" names the day the job was done, once, in Louisiana time. Inventory: every POSTER_WAIT id whose
 * detail starts with "Done" is in the dated set (a new Done state without a date fails here).
 * @mutate src/components/job-card/jobStatusLine.ts |  : withDoneDate(copy.detail, id, job)), |  : copy.detail),
 * @mutate src/components/job-card/jobStatusLine.ts |   const at = id === "done_marked" ? job.poster_marked_done_at : job.completed_at ?? job.poster_completed_at; |   const at = job.completed_at ?? job.poster_completed_at;
 * @mutate src/components/job-card/jobStatusLine.ts | { timeZone: "America/Chicago", month: "short", day: "numeric" } | { timeZone: "UTC", month: "short", day: "numeric" }
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { posterStatusLine, withDoneDate } from "./jobStatusLine";
import type { Job } from "./activityConstants";

const base = {
  id: "j1", status: "completed", payment_status: "released", customer_id: "p", helper_id: "h", title: "Mow",
  date_needed: "2026-10-24", created_at: "2026-10-20T12:00:00Z", budget: 40,
} as unknown as Job;

describe("F106: a Done line says the day, once", () => {
  it("a paid, completed job reads 'Done · Oct 24 · paid and closed' (Louisiana day, not UTC)", () => {
    // 03:30Z on Oct 25 is 10:30 PM Oct 24 in Louisiana.
    const line = posterStatusLine({ ...base, completed_at: "2026-10-25T03:30:00Z" } as Job);
    expect(line.id).toBe("done_paid");
    expect(line.detail).toBe("Done · Oct 24 · paid and closed");
    expect(line.detail.match(/Done/g)).toHaveLength(1);
  });

  it("a cancelled job filed under Done reads 'Done · <the day it was filed>'", () => {
    const job = { ...base, status: "cancelled", payment_status: "refunded", completed_at: null, poster_marked_done_at: "2026-10-24T18:00:00Z", cancelled_at: "2026-10-20T18:00:00Z" } as unknown as Job;
    const line = posterStatusLine(job);
    expect(line.id).toBe("done_marked");
    expect(line.detail).toBe("Done · Oct 24");
  });

  it("no stamp leaves the line as it was; non-Done lines never get a date", () => {
    expect(withDoneDate("Done · paid and closed", "done_paid", { completed_at: null, poster_completed_at: null, poster_marked_done_at: null })).toBe("Done · paid and closed");
    expect(withDoneDate("Reviewed — tip still open", "done_tip_open", { completed_at: "2026-10-24T18:00:00Z", poster_completed_at: null, poster_marked_done_at: null })).toBe("Reviewed — tip still open");
  });

  it("every poster state whose words open with 'Done' is dated (inventory from POSTER_WAIT)", () => {
    const src = readFileSync("src/components/job-card/jobStatusLine.ts", "utf8");
    const doneIds = [...src.matchAll(/^\s+(\w+): \{ detail: "Done\b/gm)].map((m) => m[1]);
    expect(doneIds.length).toBeGreaterThan(3);
    const dated = src.match(/const DONE_DATED = new Set<PosterWait>\(\[([^\]]+)\]\)/)?.[1] ?? "";
    for (const id of doneIds) expect(dated, id).toContain(`"${id}"`);
  });
});
