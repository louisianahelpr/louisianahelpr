/**
 * Owner, 2026-10-08 (Q1559): "the post and jobs trackers etc should be nearly
 * identical, there shouldn't be so much mismatch". The poster's card (and the
 * Helpr's own offer rail) drew Posted -> ... -> Done; the Helpr's booked card
 * dropped Posted, so the two cards of one job showed different rails.
 *
 * The class: every job-card mount of <JobTracking> draws the same rail.
 *
 * @mutate src/pages/jobs/appliedJobCard/HelperTrackerPanel.tsx |         includePostingSteps\n |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const mounts = execSync("git ls-files 'src/pages/**/*.tsx' 'src/components/**/*.tsx'", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.includes(".test.") && f !== "src/components/JobTracking.tsx")
  .flatMap((f) => {
    const s = readFileSync(join(process.cwd(), f), "utf8");
    return [...s.matchAll(/<JobTracking\s([\s\S]*?)\/>/g)].map((m) => ({ f, props: m[1] }));
  });

describe("both cards of one job draw the same tracker rail", () => {
  it("finds the card mounts (poster card, Helpr booked card, Helpr offer rail)", () => {
    expect(mounts.length).toBeGreaterThanOrEqual(3);
  });
  it("every mount includes the posting step", () => {
    expect(mounts.filter((m) => !/\bincludePostingSteps\b/.test(m.props)).map((m) => m.f)).toEqual([]);
  });
});
