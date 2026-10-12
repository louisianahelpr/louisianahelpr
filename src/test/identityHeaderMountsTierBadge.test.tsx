/**
 * The profile hero MOUNTS the verification-ladder badge, with the Helpr's own
 * ladder inputs (VN-14).
 *
 * onlyStripeIdVerifiedBadge.test.tsx renders <HelperTierBadge> directly, so a
 * broken mount (the row's condition gone, or the hero handing the badge the
 * wrong stats) stayed green: vacuity's mount-wiring scan named HelperTierBadge
 * "tested only in isolation" on main (push runs 38173155817, 38181478413).
 * This renders the real parent, IdentityHeader, and reads the badge from it.
 */
// @mutate src/components/profile/profileLanding/IdentityHeader.tsx | {(earnedBadges.length > 0 \|\| profile) && ( | {false && (
// @mutate src/components/profile/profileLanding/IdentityHeader.tsx | stats={helperBadgeStats ?? buildHelperBadgeStats(completedCount, null)} | stats={buildHelperBadgeStats(completedCount, null)}
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IdentityHeader } from "@/components/profile/profileLanding/IdentityHeader";
import type { Profile } from "@/components/profile/profileLanding/types";

const profile = {
  id: "u1",
  full_name: "Hallie Helper",
  avatar_url: null,
  bio: null,
  location: "Lafayette, LA",
  stripe_identity_verified: true,
  stripe_account_id: "acct_1",
} as unknown as Profile;

function renderHeader(helperBadgeStats: { completedJobs: number; avgRating: number; reviewCount: number } | null) {
  return render(
    <MemoryRouter>
      <IdentityHeader
        profile={profile}
        userId="u1"
        displayName="Hallie Helper"
        initials="HH"
        avgRating={4.9}
        reviewCount={12}
        completedCount={1}
        helperBadgeStats={helperBadgeStats}
        onSelectTab={() => {}}
        tier="free"
        hasPhoto={false}
        memberSinceLabel={null}
        earnedBadges={[]}
      />
    </MemoryRouter>,
  );
}

describe("IdentityHeader mounts HelperTierBadge", () => {
  it("shows the Top Rated rung from the Helpr's own ladder inputs", () => {
    renderHeader({ completedJobs: 30, avgRating: 4.9, reviewCount: 12 });
    expect(screen.getAllByRole("button", { name: /Verification tier: Top Rated/ })).toHaveLength(1);
  });

  it("control: a Helpr below the Trusted rung shows no ladder badge", () => {
    renderHeader({ completedJobs: 1, avgRating: 0, reviewCount: 0 });
    expect(screen.queryByRole("button", { name: /Verification tier:/ })).toBeNull();
  });
});
