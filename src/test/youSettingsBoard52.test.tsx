/**
 * BOARD 52, You › Settings (spec v2 §9.17): Look (color mode, bigger text and
 * buttons), Your sections (a switch per OPEN section; a closed section says
 * "Opening soon" and shows "Soon" instead of a switch, §1.8), Alerts, Your
 * account, then Log out. Reached from the You tab's Settings row, and a tab
 * opened from here backs out to Settings, not to the landing.
 *
 * @mutate src/components/profile/SettingsTab.tsx |                 on ? ( |                 true ? (
 * @mutate src/components/profile/SettingsTab.tsx |       <Group title="Look"> |       <Group title="Display">
 * @mutate src/pages/profile/types.ts |   security: "Account and security", |   security: "Account Security",
 * @mutate src/pages/profile/Profile.tsx |     returnTo.current = "settings"; |     returnTo.current = null;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const setHidden = vi.hoisted(() => vi.fn(() => true));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, isAdmin: false }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter" }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system" }) }));
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { useSectionPrefs: () => ({ visible: SECTIONS, prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, setHidden }) };
});

import { SettingsTab } from "@/components/profile/SettingsTab";
import { TAB_TITLES } from "@/pages/profile/types";

afterEach(cleanup);

function renderSettings(onSelectTab = vi.fn(), onRequestLogout = vi.fn()) {
  render(
    <MemoryRouter>
      <SettingsTab profile={null} seniorMode={false} onToggleSeniorMode={() => {}} onSelectTab={onSelectTab} onRequestLogout={onRequestLogout} onBack={() => {}} />
    </MemoryRouter>,
  );
  return { onSelectTab, onRequestLogout };
}

describe("You › Settings, board 52", () => {
  it("is a Profile tab named Settings", () => {
    expect(TAB_TITLES.settings).toBe("Settings");
  });

  it("groups in the board's order, then Log out", () => {
    renderSettings();
    const groups = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(groups.slice(0, 4)).toEqual(["Look", "Your sections", "Alerts", "Your account"]);
    expect(screen.getByText("Log out")).toBeTruthy();
  });

  it("open sections get a switch; a closed one says Opening soon with no switch", () => {
    renderSettings();
    const sections = screen.getByRole("region", { name: "Your sections" });
    const jobs = within(sections).getByText("Jobs").closest("[data-settings-row]") as HTMLElement;
    const shops = within(sections).getByText("Shops").closest("[data-settings-row]") as HTMLElement;
    expect(within(jobs).getByRole("switch")).toBeTruthy();
    expect(within(shops).queryByRole("switch")).toBeNull();
    expect(shops.textContent).toContain("Opening soon");
    expect(shops.textContent).toContain("Soon");
    fireEvent.click(within(sections).getByRole("switch", { name: "Show Declutter" }));
    expect(setHidden).toHaveBeenCalledWith("declutter", true);
  });

  it("rows open their tabs and Log out asks to log out", () => {
    const { onSelectTab, onRequestLogout } = renderSettings();
    fireEvent.click(screen.getByText("Notifications"));
    fireEvent.click(screen.getByText("Account and security"));
    fireEvent.click(screen.getByText("Log out"));
    expect(onSelectTab.mock.calls.map((c) => c[0])).toEqual(["notifications", "security"]);
    expect(onRequestLogout).toHaveBeenCalledTimes(1);
  });

  it("each row is named what the screen it opens is titled (one source, sentence case)", () => {
    renderSettings();
    for (const key of ["notifications", "profile", "security", "warnings"] as const) {
      expect(screen.getByText(TAB_TITLES[key])).toBeTruthy();
    }
    expect([TAB_TITLES.profile, TAB_TITLES.security, TAB_TITLES.warnings, TAB_TITLES.support]).toEqual([
      "Edit profile", "Account and security", "Warnings and strikes", "Help",
    ]);
  });

  it("a tab opened from Settings backs out to Settings", () => {
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/profile/Profile.tsx"), "utf8"));
    expect(page).toMatch(/const openFromSettings = useCallback\(\(key: string\) => \{\s*returnTo\.current = "settings";/);
    expect(page).toContain("onSelectTab={openFromSettings}");
  });
});
