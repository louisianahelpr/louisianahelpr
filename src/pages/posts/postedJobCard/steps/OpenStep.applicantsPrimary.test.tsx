/**
 * Owner, 2026-10-08: the job card's row is ONE row, More (left) + one primary.
 * Live, an open job drew a full-width "Applicants" button with a full-width
 * "More" box under it: two rows.
 *
 * The class: an open job's Applicants is the step row's primary, and the card
 * draws no separate Applicants block for an open job.
 *
 * @mutate src/pages/posts/postedJobCard/steps/OpenStep.tsx |         applicantsPrimary ? ( |         false ? (
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("an open job's Applicants is the row's primary", () => {
  it("OpenStep draws it as the JobStepCard primary", () => {
    expect(src("src/pages/posts/postedJobCard/steps/OpenStep.tsx")).toMatch(/primary=\{\s*applicantsPrimary \? \(\s*<JobStepPrimaryButton/);
  });
  it("the card no longer draws the separate block for an open job", () => {
    expect(src("src/pages/posts/PostedJobCard.tsx")).toMatch(/\{job\.status !== "open" && <PostedJobApplicants/);
  });
});
