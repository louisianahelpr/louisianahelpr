/**
 * PHOTO AND PHONE OPTIONAL, BROWSE FIRST (owner, 2026-10-09).
 *
 * Moved here from PhotoPrompt.test.tsx when the prompt that asked for a photo,
 * phone and birthday before the first Apply or Post was removed (owner,
 * 2026-10-14, "no later prompt"; src/test/applyAndPostAskNoProfileDetails.test.tsx).
 * These cases never tested the prompt: they pin the profile gate and the
 * header's Get Started, which stay as they were.
 *
 * - The profile gate passes a profile with no photo and no phone.
 * - (A Google/Apple sign-up's age check moved to Complete Profile's 18+ box on
 *   2026-10-14, owner: src/test/socialSignupPassesThe18Box.test.tsx.)
 * - Get Started opens the job list from the landing page; on the job list it is
 *   the sign-up.
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

describe("browse first: the header's Get Started", () => {
  const getStarted = (path: string) => {
    const { unmount } = render(<MemoryRouter initialEntries={[path]}><Navbar /></MemoryRouter>);
    const href = screen.getByRole("link", { name: "Get Started" }).getAttribute("href");
    unmount();
    return href;
  };
  it("opens the job list from the landing page", () => expect(getStarted("/")).toBe("/browse"));
  it("is the sign-up on the job list itself", () => expect(getStarted("/browse")).toBe("/signup"));
});

// The phone must not be a gate field again.
// @mutate src/components/ProtectedRoute.tsx |   { key: "location", label: "City" }, |   { key: "phone", label: "Phone number" }, { key: "location", label: "City" },
// Get Started opens the job list.
// @mutate src/components/Navbar.tsx | ? "/signup" : "/browse"; | ? "/signup" : "/signup";
