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
 *   "Get started" and "How it works" are gone. Owner 11-04 (Builder 115):
 *   Declutter joins the bar after Jobs so guests can browse it (/declutter).
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
        accepted_terms_at: "2026-11-01T00:00:00Z",
        is_legacy_user: false,
      } as Parameters<typeof isProfileComplete>[0], { app_metadata: { provider: "email" } }),
    ).toBe(true);
  });
});

describe("the public top bar: Jobs | Declutter | Log in · Join free on every page", () => {
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
    // A link whose full name is sr-only (the phone "Guides" link, owner 11-18) is read by that name. The sign-up button
    // carries one word set per width (owner 11-22: "Join free" from md up, "Join / Log in" on a phone): read as two
    // entries, wide then phone, the way the two gift-guides links are.
    const links = screen.getAllByRole("link").flatMap((a) => {
      const perWidth = ["wide", "phone"].map((k) => a.querySelector(`[data-nav-join="${k}"]`)).filter((el): el is Element => !!el);
      if (perWidth.length) return perWidth.map((el) => [el.textContent?.trim() ?? "", a.getAttribute("href")]);
      return [[(a.querySelector(".sr-only") ?? a).textContent?.trim() || a.getAttribute("aria-label") || "", a.getAttribute("href")]];
    });
    unmount();
    return links;
  };
  // Owner 2026-11-18: Holiday gift guides joins the bar: in full from md up, and below md the short gift guides link
  // (named "Gift guides"; owner 11-18: "Shouldn't it be on the top nav?"). Which one shows at which width is
  // src/test/navGiftGuidesOnPhone1118.test.tsx's. Owner 11-22: on a phone Log in leaves the bar and the sign-up button
  // reads "Join / Log in" (src/test/phoneJoinOrLogIn1122.test.tsx holds which shows at which width).
  it.each(PAGES)("$path: the logo, then Jobs (/browse), Declutter (/declutter), Holiday gift guides (wide + phone), Log in (/login), Join free / Join / Log in (/signup)", ({ path, landing }) => {
    const links = barLinks(path, landing).filter(([, href]) => href !== "/");
    expect(links).toEqual([["Jobs", "/browse"], ["Declutter", "/declutter"], ["Holiday gift guides", "/gift-guides"], ["Gift guides", "/gift-guides"], ["Log in", "/login"], ["Join free", "/signup"], ["Join / Log in", "/signup"]]);
  });
  it("no page's bar says Get started or How it works, and the landing's bar is the same bar", () => {
    expect(PAGES.length).toBeGreaterThan(3);
    // Owner 11-20 (site polish A1): every page but the landing also has "Home" (/), from md up; the rest is the same bar.
    const bars = PAGES.map(({ path, landing }) => JSON.stringify(barLinks(path, landing).filter(([name, href]) => !(name === "Home" && href === "/"))));
    for (const b of bars) expect(b).not.toMatch(/Get started|How it works/);
    expect(new Set(bars).size).toBe(1);
  });
});

// The phone must not be a gate field again.
// @mutate src/components/ProtectedRoute.tsx |   { key: "full_name", label: "Full name" }, |   { key: "full_name", label: "Full name" }, { key: "phone", label: "Phone number" },
// Jobs opens the job list on every page.
// @mutate src/components/Navbar.tsx |                 to="/browse" |                 to={location.pathname === "/browse" ? "/signup" : "/browse"}
// Holiday gift guides is in the bar on every page (owner 2026-11-18).
// @mutate src/components/Navbar.tsx |                 to="/gift-guides"\n                aria-current={navSection(location.pathname) === "guides" ? "page" : undefined}\n                data-testid="nav-gift-guides"\n |                 to="/gift-guide"\n                aria-current={navSection(location.pathname) === "guides" ? "page" : undefined}\n                data-testid="nav-gift-guides"\n
// Join free is the sign-up on every page.
// @mutate src/components/Navbar.tsx |                 to="/signup" |                 to={landing ? "/signup" : "/browse"}
// The landing gets no bar of its own.
// @mutate src/components/Navbar.tsx |         {!user && ( |         {landing && <a href="#how-it-works">How it works</a>}\n        {!user && (
