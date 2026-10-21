/**
 * BOARD 120, left screen (You › Settings › Your account): the account row
 * shows what is true now (your email and how you sign in), ID shows only when
 * verified (no flow starts an ID check any more), and Delete account sits at
 * the foot of the group in --alert text, opening the existing delete dialog.
 * No "Pause my account": it does not exist (lead 2026-10-21).
 *
 * @mutate src/components/profile/SettingsTab.tsx | {onRequestDelete && <Row testId="delete-account" | {false && <Row testId="delete-account"
 * @mutate src/components/profile/SettingsTab.tsx |   const NAMES: Record<string, string> = { email: "Password", google: "Google", apple: "Apple" }; |   const NAMES: Record<string, string> = {};
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const user = vi.hoisted(() => ({ current: { id: "u1", email: "lexi@example.com", identities: [{ provider: "email" }, { provider: "google" }] } as unknown }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: user.current, profile: null, isAdmin: false }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system" }) }));
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { useSectionPrefs: () => ({ visible: SECTIONS, prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, setHidden: vi.fn() }) };
});

import { SettingsTab, accountLine } from "@/components/profile/SettingsTab";
import type { Profile } from "@/components/profile/profileLanding/types";

afterEach(cleanup);

const renderIt = (profile: Partial<Profile> | null, onRequestDelete = vi.fn()) => {
  render(
    <MemoryRouter>
      <SettingsTab profile={profile as Profile | null} seniorMode={false} onSelectTab={vi.fn()} onRequestLogout={vi.fn()} onRequestDelete={onRequestDelete} onBack={() => {}} />
    </MemoryRouter>,
  );
  return onRequestDelete;
};

describe("You › Settings › Your account, board 120", () => {
  it("the account line is the real email and sign-in methods, each only when known", () => {
    expect(accountLine("lexi@example.com", [{ provider: "email" }, { provider: "google" }])).toBe("lexi@example.com · Password, Google");
    expect(accountLine(null, [{ provider: "apple" }])).toBe("Apple");
    expect(accountLine(undefined, [])).toBeNull();
  });

  it("renders the line, no ID row when unverified, and Delete account opens the delete dialog", () => {
    const onDelete = renderIt(null);
    expect(screen.getByText("lexi@example.com · Password, Google")).toBeTruthy();
    expect(screen.queryByText("ID")).toBeNull();
    const del = screen.getByText("Delete account");
    expect(del.getAttribute("style")).toContain("--alert-ink");
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/pause/i)).toBeNull();
  });

  it("shows ID · Verified only for a verified member", () => {
    renderIt({ user_id: "u1", stripe_identity_verified: true } as Partial<Profile>);
    expect(screen.getByText("ID")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
  });
});
