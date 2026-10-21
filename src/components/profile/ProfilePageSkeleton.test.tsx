import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProfilePageSkeleton } from "./ProfilePageSkeleton";
import { YOU_ROWS, YOU_STATIC_CAPTIONS } from "./profileLanding/YouMenu";
import { PROFILE_PAGE_TITLE } from "./profileLanding/headingContract";
import { blankComments } from "@/test/helpers/blankNonCode";

// The shared top bar reads the session and the bell's feed; the skeleton only needs its title here.
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title }: { title?: string }) => <header><h1>{title}</h1></header>,
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ isAdmin: false, user: null }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

/**
 * /profile's FIRST FRAME HAS WORDS IN IT (Q1173, the owner's data-aware
 * skeleton rule, Q722).
 *
 * Measured 2026-10-03 (Q1158 lab, local build, prod data, 375 Slow 4G + 4x
 * CPU): the landing's skeleton was bones only, on screen at 4.16 s, and FCP
 * waited for the profile card at 4.96 s. Since board 18 (2026-10-20) the
 * landing is the "You" top bar, the profile card, the activity tiles and FOUR
 * rows (Money · Notifications · Settings · Talk to a real person). The title and the
 * rows' words are known before any data, so the skeleton draws them for real
 * (YouMenuList itself, inert); the card and tiles (data) stay as bones.
 */

// @mutate src/components/profile/ProfilePageSkeleton.tsx | <YouMenuList captions={YOU_STATIC_CAPTIONS} /> | <Skeleton className="h-[224px] rounded-ds-lg" />
// @mutate src/components/profile/ProfilePageSkeleton.tsx | <AppTopBar title={PROFILE_PAGE_TITLE} showProfile={false} /> | <AppTopBar title=" " showProfile={false} />
// @mutate src/components/profile/profileLanding/YouMenu.tsx | disabled={!onSelect} | disabled={false}

const renderSkeleton = () =>
  render(
    <MemoryRouter>
      <ProfilePageSkeleton />
    </MemoryRouter>,
  );

describe("the Profile landing skeleton draws what is known before data (Q1173)", () => {
  it("paints the landing's real title as the page's h1", () => {
    renderSkeleton();
    expect(screen.getByRole("heading", { level: 1, name: PROFILE_PAGE_TITLE })).toBeTruthy();
  });

  it("paints board 18's four rows and their known captions, inert", () => {
    expect(YOU_ROWS.length, "YOU_ROWS is empty: this guard has rotted").toBe(4);
    const { container } = renderSkeleton();
    const root = within(container);
    for (const row of YOU_ROWS) {
      expect(root.getByText(row.label), `the skeleton has no "${row.label}" row`).toBeTruthy();
      const cap = YOU_STATIC_CAPTIONS[row.key];
      if (cap) expect(root.getByText(cap)).toBeTruthy();
    }
    // Every button in the first frame: the four rows, plus the payout row's own reserve.
    const rows = container.querySelectorAll("button");
    const payoutReserve = [...rows].filter((b) => b.querySelector("[data-payout-copy]"));
    expect(payoutReserve.length, "the skeleton's payout slot is not the row's own reserve").toBe(1);
    expect(rows.length).toBe(YOU_ROWS.length + 1);
    for (const row of rows) {
      expect(row.disabled, `"${row.textContent}" is tappable in the skeleton`).toBe(true);
      expect(row.tabIndex).toBe(-1);
    }
  });

  it("the skeleton's static captions read no data, so it never shows a guess", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "profileLanding/YouMenu.tsx"), "utf8"));
    const block = src.slice(src.indexOf("export const YOU_STATIC_CAPTIONS"), src.indexOf("export function youMoneyCaption"));
    expect(block.length, "YOU_STATIC_CAPTIONS not found: this guard has rotted").toBeGreaterThan(40);
    expect(block).not.toMatch(/\buse[A-Z]\w*\s*\(|\bprofile\??\.|earnings/);
  });
});
