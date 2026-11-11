/**
 * F273 (whole-app audit 11-10, Haul brush): past the 24-hour window the poster's job page read "Next: approve
 * Hallie's work · 24 hours passed. Helpr support will reach out; your payment stays held", which read as too late
 * to approve. The poster can still approve (nothing releases on a timer; the admin's escalation alert closes itself
 * once the job no longer waits on an approval, 20261023143240), so the line says so. The Posted card's countdown
 * says the same words.
 *
 * @mutate src/pages/jobs/jobPage/reviewTimeLeft.ts | return "You can still approve. Helpr support will check in; your payment stays held"; | return "24 hours passed. Helpr support will reach out; your payment stays held";
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx | expiredText="You can still approve. Helpr support will check in; your payment stays held." | expiredText="24 hours passed — Helpr support will reach out. Your payment stays held."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { approveDeadlineMs, reviewTimeLeft } from "./reviewTimeLeft";

describe("the review clock past its window says the poster can still approve (F273)", () => {
  it("job page: still approvable, support checks in, money held", () => {
    const now = Date.parse("2026-11-10T15:00:00Z");
    const line = reviewTimeLeft(now - 60_000, now);
    expect(line).toBe("You can still approve. Helpr support will check in; your payment stays held");
    expect(line).not.toMatch(/hours passed/);
    expect(reviewTimeLeft(now + 90 * 60_000, now)).toBe("1h 30m left, then Helpr support steps in");
  });

  it("Posted card: the countdown's expired words match", () => {
    const src = readFileSync(resolve(__dirname, "../../posts/postedJobCard/steps/InProgressStep.tsx"), "utf8");
    expect(src).toContain('expiredText="You can still approve. Helpr support will check in; your payment stays held."');
    expect(src).not.toMatch(/hours passed — Helpr support will reach out/);
  });
});

/*
 * F274 (audit 11-10, Scrub a back deck): after the Helpr sent the fix the header still timed the first "done" and read
 * "24 hours passed" while the poster had until revision_acceptance_deadline to check it.
 * @mutate src/pages/jobs/jobPage/reviewTimeLeft.ts |     if (Number.isFinite(until)) return until; |     if (Number.isFinite(until)) return null;
 * @mutate src/pages/jobs/jobPage/reviewTimeLeft.ts |   if (Number.isFinite(asked) && !(sent >= asked)) return null; |
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | ? approveDeadlineMs(job) : null; | ? Date.parse(job.helper_completed_at ?? "") + 86_400_000 : null;
 */
describe("the approve clock after a fix (F274)", () => {
  const done = "2026-11-08T15:00:00Z";
  it("a sent fix is timed by revision_acceptance_deadline, not the first done + 24 h", () => {
    const job = { helper_completed_at: done, revision_requested_at: "2026-11-08T18:00:00Z", revision_completed_at: "2026-11-09T15:00:00Z", revision_acceptance_deadline: "2026-11-12T15:00:00Z" };
    expect(approveDeadlineMs(job)).toBe(Date.parse("2026-11-12T15:00:00Z"));
    expect(reviewTimeLeft(approveDeadlineMs(job)!, Date.parse("2026-11-10T15:00:00Z"))).toBe("48h 0m left, then Helpr support steps in");
  });

  it("a fix asked for and not sent has no approve clock; no fix: done + 24 h", () => {
    expect(approveDeadlineMs({ helper_completed_at: done, revision_requested_at: "2026-11-08T18:00:00Z", revision_completed_at: null })).toBeNull();
    expect(approveDeadlineMs({ helper_completed_at: done })).toBe(Date.parse(done) + 86_400_000);
    expect(approveDeadlineMs({ helper_completed_at: null })).toBeNull();
  });

  it("the job page reads its clock from approveDeadlineMs", () => {
    const src = readFileSync(resolve(__dirname, "JobPage.tsx"), "utf8");
    expect(src).toContain("? approveDeadlineMs(job) : null;");
  });
});
