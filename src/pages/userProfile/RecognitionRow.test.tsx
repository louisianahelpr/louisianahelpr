import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

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
    const milestoneChip = screen.getByRole("button", { name: /First Job/ });
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
