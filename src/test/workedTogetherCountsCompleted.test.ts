/**
 * Q965 — "Worked together" on a profile counts jobs the two FINISHED together.
 *
 * It counted every job the pair were ever matched on, cancelled ones included
 * (Visual notes 2026-09-14: a profile read 44 against 16 completed). The
 * broad count still gates the Message button (a cancelled hire is still a
 * relationship); the tile counts only the completed rows. Q946 (2026-11-04):
 * both numbers come from ONE pair read (its exact count, its statuses).
 *
 * @mutate src/pages/user/useUserProfileData.ts | .filter((j) => j.status === "completed").length | .length
 * @mutate src/pages/user/useUserProfileData.ts |         mutualJobsCount: workedTogetherCount, |         mutualJobsCount,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(process.cwd(), "src/pages/user/useUserProfileData.ts"), "utf8"));

describe("Worked together counts completed jobs (Q965)", () => {
  it("reads the hook (floor)", () => {
    expect(src.length).toBeGreaterThan(10_000);
  });

  it("the tile's count is the completed rows of the one pair read", () => {
    const names = /\[([^\]]*)\]\s*=\s*await Promise\.all\(\[/.exec(src)?.[1].split(",").map((x) => x.trim()) ?? [];
    expect(names).toContain("mutualRes");
    expect(names).not.toContain("mutualCompletedRes");
    expect(src).toMatch(/const workedTogetherCount = wantsMutual\s*\?\s*\(\(mutualRes\?\.data \?\? \[\]\)[^;]*\.filter\(\(j\) => j\.status === "completed"\)\.length/);
    expect(src).toMatch(/mutualJobsCount: workedTogetherCount,/);
    // Every pair filter in the hook, and the select each one hangs off.
    const pairFilters = [...src.matchAll(/\.or\(\s*`and\(customer_id\.eq\.\$\{currentUserId\},helper_id/g)];
    expect(pairFilters.length).toBe(1);
    const before = src.slice(0, pairFilters[0].index);
    const pairQueries = [before.slice(before.lastIndexOf(".select(")).match(/^\.select\(([^)]*)\)/)?.[1]];
    expect(pairQueries[0]).toBe('"status", { count: "exact" }');
  });

  it("messaging still gates on the broad pair count", () => {
    expect(src).toMatch(/const canMessage = wantsMutual\s*\?\s*mutualJobsCount > 0/);
  });
});
