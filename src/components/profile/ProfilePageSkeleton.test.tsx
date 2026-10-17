import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProfilePageSkeleton } from "./ProfilePageSkeleton";
import { WORK_MENU_GROUP } from "./profileLanding/workMenuGroup";
import { useProfileLandingDerived } from "./profileLanding/useProfileLandingDerived";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ isAdmin: false }) }));
// Memberships switch OFF, the shipped state (roadmap F4): the landing reads it.
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

/**
 * /profile's FIRST FRAME HAS WORDS IN IT (Q1173, the owner's data-aware
 * skeleton rule, Q722).
 *
 * Measured 2026-10-03 (Q1158 lab, local build, prod data, 375 Slow 4G + 4x
 * CPU): the landing's skeleton was bones only, on screen at 4.16 s, and FCP
 * waited for the profile card at 4.96 s. The page title and the Work rows are
 * known before any data, so the skeleton now draws them for real and only the
 * identity card (all profile data) stays as bones.
 *
 * The class this stops: a skeleton that draws a grey bar where the loaded
 * screen has fixed words. The inventory is WORK_MENU_GROUP itself, the same
 * object the loaded landing renders, so a row added there is asserted here
 * with no edit to this file.
 */

// @mutate src/components/profile/ProfilePageSkeleton.tsx | <SettingsGroup group={WORK_MENU_GROUP} /> | <Skeleton className="h-[400px] rounded-ds-lg" />
// @mutate src/components/profile/ProfilePageSkeleton.tsx | title="Profile" | title=" "
// @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx |     WORK_MENU_GROUP,\n | { ...WORK_MENU_GROUP, items: WORK_MENU_GROUP.items.slice(1) },\n
// @mutate src/components/profile/profileLanding/SettingsSection.tsx | disabled={!onSelect} | disabled={false}

const renderSkeleton = () =>
  render(
    <MemoryRouter>
      <ProfilePageSkeleton />
    </MemoryRouter>,
  );

describe("the Profile landing skeleton draws what is known before data (Q1173)", () => {
  it("paints the landing's real title as the page's h1", () => {
    renderSkeleton();
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
  });

  it("paints every Work row's label and description, inert", () => {
    // FLOOR: an empty group would pass the loop below vacuously.
    expect(WORK_MENU_GROUP.items.length, "WORK_MENU_GROUP is empty — this guard has rotted").toBeGreaterThan(3);
    const { container } = renderSkeleton();
    const root = within(container);
    expect(root.getByText(WORK_MENU_GROUP.title)).toBeTruthy();
    for (const item of WORK_MENU_GROUP.items) {
      expect(root.getByText(item.label), `the skeleton has no "${item.label}" row`).toBeTruthy();
      expect(root.getByText(item.desc), `the "${item.label}" row has no description`).toBeTruthy();
    }
    // Drawn, not live: nothing in the first frame can be tapped or tabbed to
    // before the page that handles it has arrived.
    // Every button in the first frame: the Work rows, plus the payout row's own
    // reserve (PayoutStatusRow holds that slot at its real height).
    const rows = container.querySelectorAll("button");
    const payoutReserve = [...rows].filter((b) => b.querySelector("[data-payout-copy]"));
    expect(payoutReserve.length, "the skeleton's payout slot is not the row's own reserve").toBe(1);
    expect(rows.length).toBe(WORK_MENU_GROUP.items.length + 1);
    for (const row of rows) {
      expect(row.disabled, `"${row.textContent}" is tappable in the skeleton`).toBe(true);
      expect(row.tabIndex).toBe(-1);
    }
  });

  it("the loaded landing's first group is the very rows the skeleton drew", () => {
    // Same object, not an equal copy: the skeleton cannot drift from the page.
    const { result } = renderHook(() => useProfileLandingDerived({ profile: null }));
    expect(result.current.menuGroups[0]).toBe(WORK_MENU_GROUP);
  });

  it("the Work group reads no data, so the skeleton never shows a guess", () => {
    const src = blankComments(
      readFileSync(resolve(__dirname, "profileLanding/workMenuGroup.tsx"), "utf8"),
    );
    expect(src.length, "workMenuGroup.tsx read as empty — this guard has rotted").toBeGreaterThan(200);
    expect(src, "a hook in the Work group means a row depends on data").not.toMatch(/\buse[A-Z]\w*\s*\(/);
    expect(src, "the Work group reads the profile").not.toMatch(/\bprofile\??\./);
  });
});
