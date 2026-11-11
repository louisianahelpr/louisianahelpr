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
import { reviewTimeLeft } from "./reviewTimeLeft";

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
