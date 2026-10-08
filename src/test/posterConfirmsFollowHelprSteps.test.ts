/**
 * Owner, 2026-10-08: "where do i confirm they arrived? it should be a greyed out
 * confirm they arrived button" (Q1568) and "the helpr never marked they were
 * working so the poster shouldn't have been able to confirm they were working"
 * (Q1571; job 28f8cff5, poster 32 s ahead of the Helpr).
 *
 * The class: each poster confirm is offered only AFTER the Helpr's own step,
 * and before it the button is drawn greyed with a line saying when it turns on.
 * The server refuses the working one out of order
 * (enforce_poster_working_confirm_order, 20261008203441).
 *
 * @mutate src/pages/posts/postedJobCard/steps/posterStepContract.ts |       enabled: helperWorking, |       enabled: true,
 * @mutate src/pages/posts/postedJobCard/steps/posterStepContract.ts |     if (step !== "in_progress" \|\| !job.helper_on_the_way_at \|\| job.helper_completed_at \|\| isPastDue(job.date_needed)) return null; |     return null;
 */
import { describe, expect, it } from "vitest";
import { posterConfirmationRung } from "@/pages/posts/postedJobCard/steps/posterStepContract";
import type { Job } from "@/components/job-card/activityConstants";

const T = "2026-10-08T19:00:00Z";
const job = (over: Record<string, unknown>) =>
  ({ id: "j", status: "in_progress", helper_id: "h", helper_confirmed_at: T, is_group_job: false, ...over }) as unknown as Job;

describe("the poster's confirms follow the Helpr's steps", () => {
  it("on the way: Confirm They Arrived is drawn greyed, saying when it turns on", () => {
    const r = posterConfirmationRung(job({ helper_on_the_way_at: T }), "in_progress")!;
    expect(r.label).toBe("Confirm They Arrived");
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/turns on once your Helpr says they've arrived/);
  });
  it("arrived: it turns on", () => {
    expect(posterConfirmationRung(job({ helper_on_the_way_at: T, helper_arrived_at: T }), "in_progress")!.enabled).toBe(true);
  });
  it("arrival confirmed, Helpr not working yet: Confirm They're Working is greyed", () => {
    const r = posterConfirmationRung(job({ helper_arrived_at: T, poster_confirmed_arrival_at: T }), "in_progress", new Date(), false)!;
    expect(r.label).toBe("Confirm They're Working");
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/turns on once your Helpr taps Start Working/);
  });
  it("the Helpr tapped Start Working: it turns on", () => {
    const r = posterConfirmationRung(job({ helper_arrived_at: T, poster_confirmed_arrival_at: T }), "in_progress", new Date(), true)!;
    expect(r.enabled).toBe(true);
    expect(r.reason).toBeNull();
  });
});
