/**
 * EVERY JOURNEY THAT TYPES INTO POST A JOB THROWS ITS DRAFT AWAY (Q1035, 2026-11-04).
 *
 * Post a job keeps a half-finished post on the account (OPS-3, save_my_job_post_draft) and the hourly
 * job-post-draft-reminder cron sends a "Finish your job post?" notice and email for an unposted one. The journeys
 * run on the SHARED test accounts, so a journey that fills the form and never posts leaves a draft behind
 * (measured on prod 2026-11-04 8:30 PM: the poster seat held one from the 01:23Z run, reminded_at null; only the
 * sweep's is_seed skip kept it quiet). The class, over the journeys' own inventory: every e2e/journeys spec that
 * drives the form (fillJobDetails / fillBudget from postJobForm.ts) imports clearJobPostDraft and calls it.
 *
 * @mutate e2e/journeys/post-job-day-tap.spec.ts | if (draftOwner) await clearJobPostDraft(request, draftOwner); | if (draftOwner) void 0;
 * @mutate e2e/journeys/recurring-picker.spec.ts | await clearJobPostDraft(request, session); | await Promise.resolve(session);
 * @mutate e2e/journeys/jobPostDraft.ts | if (read.ok() && (body === "" \|| body === "null")) return; | return;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "e2e/journeys");
const specs = readdirSync(DIR)
  .filter((f) => f.endsWith(".spec.ts"))
  .map((f) => ({ f, src: blankComments(readFileSync(join(DIR, f), "utf8")) }));
const typing = specs.filter((s) => /\bfill(JobDetails|Budget)\(/.test(s.src));

describe("journeys that type into Post a job clear the account's draft (Q1035)", () => {
  it("finds the journeys that drive the form (inventory floor)", () => {
    expect(specs.length).toBeGreaterThan(14);
    expect(typing.map((s) => s.f).sort()).toEqual(
      expect.arrayContaining(["02-marketplace.spec.ts", "keyboard-focus.spec.ts", "post-job-day-tap.spec.ts", "recurring-picker.spec.ts"]),
    );
    expect(typing.length).toBeGreaterThanOrEqual(4);
  });

  it("each one calls clearJobPostDraft", () => {
    const missing = typing.filter((s) => !/await clearJobPostDraft\(request, \w+(\.\w+)?\)/.test(s.src)).map((s) => s.f);
    expect(missing, "these journeys type into Post a job and leave the draft on a shared test account").toEqual([]);
  });

  it("the helper clears, reads the draft back as the member, and throws when it is still there", () => {
    const helper = blankComments(readFileSync(join(DIR, "jobPostDraft.ts"), "utf8"));
    expect(helper).toContain("/rest/v1/rpc/clear_my_job_post_draft");
    expect(helper).toContain("/rest/v1/rpc/my_job_post_draft");
    expect(helper).toContain('if (read.ok() && (body === "" || body === "null")) return;');
    expect(helper).toMatch(/throw new Error\(`the journey's job-post draft was not cleared/);
  });
});
