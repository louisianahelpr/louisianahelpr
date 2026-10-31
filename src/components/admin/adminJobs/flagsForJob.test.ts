/**
 * Admin M5: the Flagged queue holds only jobs that can still be acted on.
 *
 * @mutate src/components/admin/adminJobs/adminJobsHelpers.ts |   if (!FLAGGABLE_STATUSES.includes(job.status ?? "")) return []; |
 * @mutate src/components/admin/adminJobs/adminJobsHelpers.ts | const FLAGGABLE_STATUSES = ["open", "accepted", "in_progress"]; | const FLAGGABLE_STATUSES = ["open"];
 * @mutate src/components/admin/adminJobs/adminJobsHelpers.ts | return [...new Set([...(job.flag_reasons ?? []), ...detectFlags(job)])]; | return detectFlags(job);
 * @mutate src/components/admin/AdminJobs.tsx | const allFlags = flagsForJob(job); | const allFlags = detectFlags(job);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { flagsForJob, STALE_DATE_FLAG } from "./adminJobsHelpers";
import type { Job } from "./types";

const job = (over: Partial<Job>): Job => ({
  id: "j", title: "Mow the yard", description: "Front and back yard, about an hour of work.",
  budget: 50, estimated_hours: 1, date_needed: "2020-01-01", status: "open", payment_status: "escrow",
  flag_reasons: [], is_seed: false, ...over,
} as Job);

describe("flagsForJob", () => {
  it.each(["open", "accepted", "in_progress"])("a %s job keeps its flags", (status) => {
    expect(flagsForJob(job({ status } as Partial<Job>))).toContain(STALE_DATE_FLAG);
  });

  it.each(["completed", "cancelled"])("a %s job has none, even with a past date and a stored flag", (status) => {
    expect(flagsForJob(job({ status, flag_reasons: ["Stored by the server"] } as Partial<Job>))).toEqual([]);
  });

  it("a live job keeps a stored flag beside what is detected, once each", () => {
    const flags = flagsForJob(job({ flag_reasons: ["Stored by the server", STALE_DATE_FLAG] }));
    expect(flags.filter((f) => f === STALE_DATE_FLAG)).toHaveLength(1);
    expect(flags).toContain("Stored by the server");
  });

  it("the Jobs screen builds its queue from it", () => {
    expect(readFileSync("src/components/admin/AdminJobs.tsx", "utf8")).toContain("const allFlags = flagsForJob(job);");
  });
});
