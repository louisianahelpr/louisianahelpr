/**
 * PHOTO AND PHONE OPTIONAL, BROWSE FIRST (owner, 2026-10-09).
 *
 * Moved here from PhotoPrompt.test.tsx when the prompt that asked for a photo,
 * phone and birthday before the first Apply or Post was removed (owner,
 * 2026-10-14, "no later prompt"; src/test/applyAndPostAskNoProfileDetails.test.tsx).
 * These cases never tested the prompt: they pin the profile gate and the
 * public top bar's links.
 *
 * - The profile gate passes a profile with no photo and no phone.
 * - (A Google/Apple sign-up's age check moved to Complete Profile's 18+ box on
 *   2026-10-14, owner: src/test/socialSignupPassesThe18Box.test.tsx.)
 * - The public top bar is ONE bar on every page, the landing included (owner,
 *   2026-10-21): signed out it is "Jobs | Log in · Join free", Jobs opening the
 *   job list (/browse) and Join free the sign-up (/signup), on every page.
 *   "Get started" and "How it works" are gone.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { isProfileComplete } from "@/components/ProtectedRoute";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import Navbar from "./Navbar";

describe("profile photo and phone are optional", () => {
  it("the profile gate passes a profile with no photo", () => {
    expect(
      isProfileComplete({
        full_name: "Ben L",
        avatar_url: null,
        date_of_birth: null,
        phone: null,
        location: "Lafayette",
        is_legacy_user: false,
      } as Parameters<typeof isProfileComplete>[0], { app_metadata: { provider: "email" } }),
    ).toBe(true);
  });
});

describe("the public top bar: Jobs | Log in · Join free on every page", () => {
  // Every public page the bar shows on, the landing (its own `landing` layout) included.
  const PAGES: { path: string; landing: boolean }[] = [
    { path: "/", landing: true },
    { path: "/browse", landing: false },
    { path: "/help", landing: false },
    { path: "/legal", landing: false },
    { path: "/support", landing: false },
  ];
  const barLinks = (path: string, landing: boolean) => {
    const { unmount } = render(<MemoryRouter initialEntries={[path]}><Navbar landing={landing} /></MemoryRouter>);
    const links = screen.getAllByRole("link").map((a) => [a.textContent?.trim() || a.getAttribute("aria-label") || "", a.getAttribute("href")]);
    unmount();
    return links;
  };
  it.each(PAGES)("$path: the logo, then Jobs (/browse), Log in (/login), Join free (/signup)", ({ path, landing }) => {
    const links = barLinks(path, landing).filter(([, href]) => href !== "/");
    expect(links).toEqual([["Jobs", "/browse"], ["Log in", "/login"], ["Join free", "/signup"]]);
  });
  it("no page's bar says Get started or How it works, and the landing's bar is the same bar", () => {
    expect(PAGES.length).toBeGreaterThan(3);
    const bars = PAGES.map(({ path, landing }) => JSON.stringify(barLinks(path, landing)));
    for (const b of bars) expect(b).not.toMatch(/Get started|How it works|Declutter/);
    expect(new Set(bars).size).toBe(1);
  });
});

// The phone must not be a gate field again.
// @mutate src/components/ProtectedRoute.tsx |   { key: "location", label: "City" }, |   { key: "phone", label: "Phone number" }, { key: "location", label: "City" },
// Jobs opens the job list on every page.
// @mutate src/components/Navbar.tsx |                 to="/browse" |                 to={location.pathname === "/browse" ? "/signup" : "/browse"}
// Join free is the sign-up on every page.
// @mutate src/components/Navbar.tsx |                 to="/signup" |                 to={landing ? "/signup" : "/browse"}
// The landing gets no bar of its own.
// @mutate src/components/Navbar.tsx |         {!user && ( |         {landing && <a href="#how-it-works">How it works</a>}\n        {!user && (
