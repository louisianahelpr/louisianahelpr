/**
 * Owner, 2026-10-08 (Q1552): "it should also say the person's name at the
 * bottom, so Lexi Accepted or Lexi Confirmed or Lexi is on the way, Lexi is
 * working" and "remove booked, just say the Helpr's name and they accepted".
 *
 * The class: when the other person's name is known, every collapsed sentence
 * about them names them; without it the unnamed sentence stays.
 *
 * @mutate src/components/job-card/jobStatusLine.ts |   const named = helperName ? POSTER_NAMED[id]?.(helperName, job) : undefined; |   const named = undefined;
 * @mutate src/components/job-card/jobStatusLine.ts |   const named = app.posterName ? HELPER_NAMED[id]?.(firstName(app.posterName)) : undefined; |   const named = undefined;
 */
import { describe, expect, it } from "vitest";
import { helperStatusLine, posterStatusLine } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

const NOW = new Date("2032-10-14T12:00:00Z");
const job = (over: Record<string, unknown>) =>
  ({ id: "j", title: "t", status: "accepted", helper_id: "h", customer_id: "p", date_needed: "2032-10-20", start_time: "14:00:00", ...over }) as unknown as Job;
const line = (j: Job, name: string | null = "Lexi Lombas") => posterStatusLine(j, 0, NOW, undefined, false, name).detail;

describe("the poster's collapsed sentence names the Helpr", () => {
  it("accepted -> 'Lexi accepted' (no 'Booked')", () => {
    expect(line(job({ helper_confirmed_at: "2032-10-13T00:00:00Z" }))).toBe("Lexi accepted");
  });
  it("on the way -> 'Lexi is on the way'", () => {
    expect(line(job({ status: "in_progress", helper_confirmed_at: "x", helper_on_the_way_at: "2032-10-14T11:00:00Z", date_needed: "2032-10-14" }))).toBe("Lexi is on the way");
  });
  it("offer out -> names who hasn't accepted", () => {
    expect(line(job({ helper_confirmed_at: null }))).toMatch(/Lexi hasn't accepted yet/);
  });
  it("no name known: the unnamed sentence", () => {
    expect(line(job({ helper_confirmed_at: "2032-10-13T00:00:00Z" }), null)).toBe("Booked: they accepted");
  });
});

describe("the Helpr's collapsed sentence names the poster", () => {
  const app = (jobOver: Record<string, unknown>, status = "pending") =>
    ({ id: "a", job_id: "j", helper_id: "h", status, posterName: "Sam Smith", job: job({ status: "open", helper_id: null, ...jobOver }) }) as unknown as AppliedApp;
  it("applied -> 'Sam hasn't replied yet'", () => {
    expect(helperStatusLine(app({ expires_at: "2099-01-01T00:00:00Z" })).detail).toBe("Sam hasn't replied yet");
  });
});
