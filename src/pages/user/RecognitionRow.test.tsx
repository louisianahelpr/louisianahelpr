import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { RecognitionRow } from "./RecognitionRow";

/**
 * VN-17 (owner, 2026-09-14): the "As a Helpr" milestone chips drew bigger
 * icons than the "Verified" chips because MilestoneIcon dropped the sizing
 * className ProfileBadge clones onto every icon. Every chip's mark must carry
 * the same size class. VN-13: no "Verification in progress" chip.
 */
function renderRow() {
  return render(
    <RecognitionRow
      milestoneStats={{ completedJobs: 12, avgRating: 5, reviewCount: 12, repeatHirePercent: 0, credentialTier: 0 }}
      idVerified
      ladderProfile={null}
      ladderStats={null}
      credentials={{}}
      backgroundChecked={false}
    />,
  );
}

describe("RecognitionRow badge sizing", () => {
  it("sizes milestone icons the same as the ID verified icon", () => {
    renderRow();
    const idChip = screen.getByRole("button", { name: /ID verified/ });
    const milestoneChip = screen.getByRole("button", { name: /Trusted Helpr/ });
    const idIcon = idChip.querySelector("svg");
    const milestoneIcon = milestoneChip.querySelector("svg");
    expect(idIcon).not.toBeNull();
    expect(milestoneIcon).not.toBeNull();
    const sizeOf = (el: Element) =>
      (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => /^[wh]-/.test(c)).sort().join(" ");
    expect(sizeOf(milestoneIcon!)).not.toBe("");
    expect(sizeOf(milestoneIcon!)).toBe(sizeOf(idIcon!));
    expect(idChip.className).toBe(milestoneChip.className);
  });

  it("never renders a Verification in progress chip", () => {
    renderRow();
    expect(screen.queryByText(/Verification in progress/i)).toBeNull();
  });
});

// VN-17 itself: MilestoneIcon swallows the sizing className ProfileBadge
// clones on, so milestone marks draw lucide's 24px default.
// @mutate src/pages/user/RecognitionRow.tsx | return <Icon className={className} style={{ color }} />; | return <Icon style={{ color }} />;

// Q985 (owner, 2026-09-11: "not needed it clerly mentions this above"): the
// tier-1 ladder rung is literally "Verified", the same claim as the ID
// verified pill above it, so tier 1 draws no rung. Tiers 2 and 3 still do.
// @mutate src/pages/user/RecognitionRow.tsx | if (tier === 0 \|\| tier === 1) return null; | if (tier === 0) return null;
describe("RecognitionRow verification ladder (Q985)", () => {
  const verified = { idv_status: "verified", stripe_account_id: "acct_test" };
  const renderLadder = (stats: { completedJobs: number; avgRating: number; reviewCount: number }) =>
    render(
      <RecognitionRow
        milestoneStats={{ completedJobs: stats.completedJobs, avgRating: stats.avgRating, reviewCount: stats.reviewCount, repeatHirePercent: 0, credentialTier: 0 }}
        idVerified
        ladderProfile={verified}
        ladderStats={stats}
        credentials={{}}
        backgroundChecked={false}
      />,
    );
  const ladderChips = () => screen.queryAllByRole("button").filter((b) => /^(Verified|Trusted|Top Rated)\b/.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));

  it("draws no rung at tier 1, so Verified is said once (by the ID verified pill)", () => {
    renderLadder({ completedJobs: 1, avgRating: 5, reviewCount: 1 });
    expect(screen.getByRole("button", { name: /ID verified/ })).toBeTruthy();
    expect(ladderChips()).toEqual([]);
  });

  it("still draws the earned rung at tier 2", () => {
    renderLadder({ completedJobs: 6, avgRating: 4.9, reviewCount: 4 });
    expect(ladderChips().map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim())).toEqual([expect.stringMatching(/^Trusted/)]);
  });
});

/**
 * AUD31-51: a 31-job Helpr's row read "Neighborhood pro · Trusted Helpr · Rising star · First job". Only the highest
 * job-count rung shows; the lower ones are one tap away behind "+N more"; a credential milestone still shows.
 * @mutate src/pages/user/RecognitionRow.tsx |     if (!milestone.requirement.credentialTier && milestone !== topRung) lowerRungs.push(milestoneSpec(milestone)); |     if (false) lowerRungs.push(milestoneSpec(milestone));
 * @mutate src/pages/user/RecognitionRow.tsx |   const hidden = [...(overflows ? specs.slice(VISIBLE_BADGE_CAP) : []), ...lowerRungs]; |   const hidden = overflows ? specs.slice(VISIBLE_BADGE_CAP) : [];
 * @mutate src/pages/user/RecognitionRow.tsx |   const topRung = earned.find((m) => !m.requirement.credentialTier); |   const topRung = earned[earned.length - 1];
 */
describe("AUD31-51: one ladder rung on the profile", () => {
  const row = (credentialTier = 0) =>
    render(
      <RecognitionRow
        milestoneStats={{ completedJobs: 31, avgRating: 4.9, reviewCount: 7, repeatHirePercent: 0, credentialTier }}
        idVerified={false}
        ladderProfile={null}
        ladderStats={null}
        credentials={{}}
        backgroundChecked={false}
      />,
    );

  it("shows only the highest job-count rung; the lower ones open from +N more", () => {
    row();
    expect(screen.getByRole("button", { name: /Neighborhood pro/ })).toBeTruthy();
    for (const lower of [/First job/, /Rising star/, /Trusted Helpr/]) expect(screen.queryByRole("button", { name: lower })).toBeNull();
    const more = screen.getByRole("button", { name: /^See all \d+ more badges$/ });
    fireEvent.click(more);
    expect(screen.getAllByText("First job").length).toBeGreaterThan(0);
  });

  it("a credential milestone (Licensed pro) still shows beside the top rung", () => {
    row(2);
    expect(screen.getByRole("button", { name: /Licensed pro/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Neighborhood pro/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /First job/ })).toBeNull();
  });
});
