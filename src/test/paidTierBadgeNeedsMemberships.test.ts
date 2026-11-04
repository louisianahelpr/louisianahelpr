/**
 * Q1848 follow-up (owner 2026-10-21): the paid-tier badge (Pro / Plus / Elite)
 * is a paid perk, so it is hidden while the 'memberships' switch is off. Every
 * paid-tier chip reads usePaidTierBadge, never tierBadgeStyle directly.
 *
 * Memberships RETIRED (owner 2026-11-04): the badge is null for every tier,
 * whatever the switch says.
 *
 * @mutate src/hooks/usePaidTierBadge.ts |   return () => null; |   return (tier) => (tier === "elite" ? ({} as never) : null);
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const flags = vi.hoisted(() => ({ memberships: false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => (k === "memberships" ? flags.memberships : false) }));

import { usePaidTierBadge } from "@/hooks/usePaidTierBadge";
import { blankComments } from "./helpers/blankNonCode";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

describe("the paid-tier badge is retired with memberships", () => {
  it("is null for every tier, even with the memberships switch on", () => {
    for (const sw of [false, true]) {
      flags.memberships = sw;
      const badge = renderHook(() => usePaidTierBadge()).result.current;
      for (const t of [...Object.keys(TIER_PERKS), null, undefined]) expect(badge(t), `${t} sw=${sw}`).toBeNull();
    }
  });

  it("no component reads tierBadgeStyle( directly; the hook is the one door", () => {
    const files = execFileSync("git", ["grep", "-l", "tierBadgeStyle(", "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && /\.tsx?$/.test(f) && !/\.test\./.test(f));
    // Floor: 2 files named tierBadgeStyle( on 2026-10-21; 1 (the lib itself) since the badge was retired 2026-11-04.
    expect(files.length).toBeGreaterThan(0);
    const callers = files.filter((f) => /\btierBadgeStyle\(/.test(blankComments(readFileSync(f, "utf8")).replace(/export function tierBadgeStyle\(/, "")));
    expect(callers.filter((f) => f !== "src/hooks/usePaidTierBadge.ts")).toEqual([]);
    expect(blankComments(readFileSync("src/hooks/usePaidTierBadge.ts", "utf8"))).toContain("return () => null;");
    // The three chips that draw it: the public profile header, the job's poster card, the applicant row.
    for (const f of ["src/pages/user/ProfileBadge.tsx", "src/components/dashboard/JobPosterCard.tsx", "src/pages/posts/postedJobs/ApplicantsPanel.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/usePaidTierBadge\(\)/);
    }
  });
});
