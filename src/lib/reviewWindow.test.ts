/**
 * DH-003: the Review chip mirrors the reviews INSERT policy's window, so it is
 * never offered for a review the server refuses (30 days after completion,
 * or during an unresolved dispute). Both chip gates must use the predicate.
 *
 * @mutate src/lib/reviewWindow.ts | if (job.has_active_dispute && !job.dispute_resolved_at) return false; | if (false) return false;
 * @mutate src/lib/reviewWindow.ts | export const REVIEW_WINDOW_DAYS = 30; | export const REVIEW_WINDOW_DAYS = 3000;
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx | (!!hasReviewed \|\| reviewWindowOpen(job)) | true
 * @mutate src/pages/jobs/AppliedJobCard.tsx | (helperReviewedJobIds.has(app.job_id) \|\| reviewWindowOpen(job)) | true
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REVIEW_WINDOW_DAYS, reviewWindowOpen } from "./reviewWindow";

const DAY = 86_400_000;
const now = Date.parse("2026-09-24T12:00:00Z");
const ago = (d: number) => new Date(now - d * DAY).toISOString();

describe("reviewWindowOpen mirrors the reviews INSERT policy (DH-003)", () => {
  it("open inside 30 days, closed after", () => {
    expect(reviewWindowOpen({ poster_completed_at: ago(29) }, now)).toBe(true);
    expect(reviewWindowOpen({ poster_completed_at: ago(31) }, now)).toBe(false);
  });

  it("uses the policy's COALESCE order", () => {
    expect(reviewWindowOpen({ poster_completed_at: ago(40), updated_at: ago(1) }, now)).toBe(false);
    expect(reviewWindowOpen({ helper_completed_at: ago(2), updated_at: ago(40) }, now)).toBe(true);
    expect(reviewWindowOpen({ updated_at: ago(2) }, now)).toBe(true);
  });

  it("closed during an unresolved dispute, open once resolved", () => {
    expect(reviewWindowOpen({ poster_completed_at: ago(1), has_active_dispute: true }, now)).toBe(false);
    expect(
      reviewWindowOpen({ poster_completed_at: ago(1), has_active_dispute: true, dispute_resolved_at: ago(0) }, now),
    ).toBe(true);
  });

  it("the window length matches the latest migration defining the policy", () => {
    const dir = "supabase/migrations";
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => /CREATE POLICY "Users can create reviews for eligible jobs"/i.test(readFileSync(`${dir}/${f}`, "utf8")))
      .pop();
    expect(latest).toBeTruthy();
    const sql = readFileSync(`${dir}/${latest}`, "utf8");
    expect(sql).toContain(`interval '${REVIEW_WINDOW_DAYS} days'`);
    expect(sql).toMatch(/has_active_dispute = false OR j\.dispute_resolved_at IS NOT NULL/);
  });

  it("both chip gates use it", () => {
    for (const f of [
      "src/pages/posts/postedJobCard/steps/CompletedStep.tsx",
      "src/pages/jobs/AppliedJobCard.tsx",
    ]) {
      expect(readFileSync(f, "utf8")).toMatch(/reviewWindowOpen\(job\)/);
    }
  });
});
