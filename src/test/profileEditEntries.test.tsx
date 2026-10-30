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
// @mutate src/pages/user/BookMeShareButton.tsx |       {userId && <BookMeShareButton | {false && <BookMeShareButton
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
import { OwnProfileActions } from "@/pages/user/BookMeShareButton";

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
    const END = "<OwnProfileActions userId={userId} displayName={displayName} />";
    const actions = src.slice(start, src.indexOf(END, start) + END.length);
    expect(actions.length).toBeGreaterThan(200);
    // The own-profile branch renders the extracted Edit button (OwnProfileEditButton.tsx, batch 2 train e8920b8ca6).
    // B59 (2026-10-29): the Book me share button sits just before Edit, in one row,
    // both rendered by OwnProfileActions (BookMeShareButton.tsx; B66 moved the pair out
    // to keep UserProfile.tsx under its size baseline).
    expect(actions).toMatch(/\) : isOwnProfile \? \(\s*<OwnProfileActions userId=\{userId\} displayName=\{displayName\} \/>$/);
    expect(src).toContain('const OWN_PROFILE_TITLE = "How others see you";');
    expect(src).toMatch(/const headerTitle = isOwnProfile \? OWN_PROFILE_TITLE : "Profile";/);
  });

  it("your own profile's title row shows Book me link then Edit, and Edit opens Edit profile", () => {
    render(<OwnProfileActions userId="u1" displayName="Audit W." />);
    const ids = Array.from(document.querySelectorAll("[data-testid]")).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["own-profile-book-me", "own-profile-edit"]);
    fireEvent.click(screen.getByTestId("own-profile-edit"));
    expect(navigate).toHaveBeenCalledWith(EDIT_PROFILE_PATH);
  });

  it("the own-profile Edit button opens Edit profile", () => {
    render(<OwnProfileEditButton />);
    fireEvent.click(screen.getByTestId("own-profile-edit"));
    expect(navigate).toHaveBeenCalledWith(EDIT_PROFILE_PATH);
  });
});
