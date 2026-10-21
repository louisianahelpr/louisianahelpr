/**
 * Q1848 follow-up (owner 2026-10-21): the paid-tier badge (Pro / Plus / Elite)
 * is a paid perk, so it is hidden while the 'memberships' switch is off. Every
 * paid-tier chip reads usePaidTierBadge, never tierBadgeStyle directly.
 *
 * @mutate src/hooks/usePaidTierBadge.ts |   return (tier) => (on ? tierBadgeStyle(tier) : null); |   return (tier) => tierBadgeStyle(tier);
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const flags = vi.hoisted(() => ({ memberships: false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => (k === "memberships" ? flags.memberships : false) }));

import { usePaidTierBadge } from "@/hooks/usePaidTierBadge";
import { blankComments } from "./helpers/blankNonCode";

describe("the paid-tier badge needs memberships on", () => {
  it("is null for every tier while memberships are off, and the tier's style when on", () => {
    flags.memberships = false;
    const off = renderHook(() => usePaidTierBadge()).result.current;
    expect(off("elite")).toBeNull();
    expect(off("pro")).toBeNull();
    flags.memberships = true;
    const on = renderHook(() => usePaidTierBadge()).result.current;
    expect(on("elite")).not.toBeNull();
    expect(on("free")).toBeNull();
  });

  it("no component reads tierBadgeStyle( directly; the hook is the one door", () => {
    const files = execFileSync("git", ["grep", "-l", "tierBadgeStyle(", "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && /\.tsx?$/.test(f) && !/\.test\./.test(f));
    // Floor: 2 files name tierBadgeStyle( on 2026-10-21.
    expect(files.length).toBeGreaterThan(1);
    const callers = files.filter((f) => /\btierBadgeStyle\(/.test(blankComments(readFileSync(f, "utf8")).replace(/export function tierBadgeStyle\(/, "")));
    expect(callers.filter((f) => f !== "src/hooks/usePaidTierBadge.ts")).toEqual([]);
    expect(readFileSync("src/hooks/usePaidTierBadge.ts", "utf8")).toContain("(on ? tierBadgeStyle(tier) : null)");
    // The three chips that draw it: the public profile header, the job's poster card, the applicant row.
    for (const f of ["src/pages/user/ProfileBadge.tsx", "src/components/dashboard/JobPosterCard.tsx", "src/pages/posts/postedJobs/ApplicantsPanel.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/usePaidTierBadge\(\)/);
    }
  });
});
