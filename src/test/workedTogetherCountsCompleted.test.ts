/**
 * Q965 — "Worked together" on a profile counts jobs the two FINISHED together.
 *
 * It counted every job the pair were ever matched on, cancelled ones included
 * (Visual notes 2026-09-14: a profile read 44 against 16 completed). The
 * broad count still gates the Message button (a cancelled hire is still a
 * relationship); the tile reads a second, completed-only count.
 *
 * @mutate src/pages/user/useUserProfileData.ts |               .eq("status", "completed")\n              .or( |               .or(
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

  it("the tile's count is a completed-only pair query", () => {
    const names = /\[([^\]]*)\]\s*=\s*await Promise\.all\(\[/.exec(src)?.[1].split(",").map((x) => x.trim()) ?? [];
    const idx = names.indexOf("mutualCompletedRes");
    expect(idx).toBeGreaterThan(-1);
    expect(src).toMatch(/const workedTogetherCount = wantsMutual \? \(mutualCompletedRes\?\.count \?\? 0\) : 0;/);
    expect(src).toMatch(/mutualJobsCount: workedTogetherCount,/);
    // The completed-only query: the last pair query in the Promise.all.
    const pairQueries = [...src.matchAll(/\.from\("jobs"\)\s*\.select\("id", \{ count: "exact", head: true \}\)([\s\S]*?)\.or\(\s*`and\(customer_id\.eq\.\$\{currentUserId\}/g)];
    expect(pairQueries.length).toBe(2);
    expect(pairQueries[1][1]).toMatch(/\.eq\("status", "completed"\)/);
  });

  it("messaging still gates on the broad pair count", () => {
    expect(src).toMatch(/const canMessage = wantsMutual\s*\?\s*mutualJobsCount > 0/);
  });
});
