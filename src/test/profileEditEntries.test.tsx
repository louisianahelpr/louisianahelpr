/**
 * App audit 2026-10-29 (A3-C6, A3-C7): Edit profile was reachable only through
 * You > Settings > Your account > Edit profile, and your own public profile was
 * titled "Profile Review" (its "How others see you" eyebrow never paints, so at
 * 375 nothing said it was a preview).
 *
 * Now: the You header card has "Edit", your own public profile has "Edit" in
 * its title row, both open Edit profile (EDIT_PROFILE_PATH), and the preview is
 * titled "How others see you".
 */
// @mutate src/components/profile/profileLanding/YouCard.tsx |         onClick={() => navigate(EDIT_PROFILE_PATH)} |         onClick={() => navigate("/profile")}
// @mutate src/pages/user/UserProfile.tsx |           ) : isOwnProfile ? ( |           ) : false ? (
// @mutate src/pages/user/OwnProfileEditButton.tsx |       onClick={() => navigate(EDIT_PROFILE_PATH)} |       onClick={() => navigate("/profile")}
// @mutate src/pages/user/UserProfile.tsx | const OWN_PROFILE_TITLE = "How others see you"; | const OWN_PROFILE_TITLE = "Profile Review";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { readSource } from "./helpers/walkSource";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<object>()), useNavigate: () => navigate }));

import { EDIT_PROFILE_PATH, YouCard } from "@/components/profile/profileLanding/YouCard";
import { OwnProfileEditButton } from "@/pages/user/OwnProfileEditButton";

afterEach(() => {
  cleanup();
  navigate.mockClear();
});

describe("Edit profile is one tap from your own profile surfaces (A3-C6, A3-C7)", () => {
  it("Edit profile is the settings tab the Settings row opens", () => {
    expect(EDIT_PROFILE_PATH).toBe("/profile?tab=profile");
  });

  it("the You header card has an Edit that opens Edit profile", () => {
    render(<YouCard profile={null} userId="u1" displayName="Audit W." avgRating={null} reviewCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(navigate).toHaveBeenCalledWith(EDIT_PROFILE_PATH);
  });

  it("your own public profile has Edit in its title row and is titled How others see you", () => {
    const src = blankComments(readSource("src/pages/user/UserProfile.tsx") ?? "");
    // Floor: the title-row actions block was found at all.
    const start = src.indexOf("titleActions={\n");
    const actions = src.slice(start, src.indexOf("<OwnProfileEditButton />", start) + "<OwnProfileEditButton />".length);
    expect(actions.length).toBeGreaterThan(200);
    // The own-profile branch renders the extracted Edit button (OwnProfileEditButton.tsx, batch 2 train e8920b8ca6).
    expect(actions).toMatch(/\) : isOwnProfile \? \(\s*<OwnProfileEditButton \/>$/);
    expect(src).toContain('const OWN_PROFILE_TITLE = "How others see you";');
    expect(src).toMatch(/const headerTitle = isOwnProfile \? OWN_PROFILE_TITLE : "Profile";/);
  });

  it("the own-profile Edit button opens Edit profile", () => {
    render(<OwnProfileEditButton />);
    fireEvent.click(screen.getByTestId("own-profile-edit"));
    expect(navigate).toHaveBeenCalledWith(EDIT_PROFILE_PATH);
  });
});
