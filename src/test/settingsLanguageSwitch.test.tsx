/**
 * Spanish language option (owner-approved 2026-10-29): You › Settings › Look
 * has a Language row carrying the ONE shared English / Español switch
 * (src/components/LanguageToggle.tsx). Choosing Español there switches the
 * app (and <html lang>) and is remembered on this device (helpr_lang).
 *
 * @mutate src/components/profile/SettingsTab.tsx | right={<LanguageToggle />} | right={<span />}
 * @mutate src/components/profile/SettingsTab.tsx | <Row testId="language" | <Row testId="lang-hidden"
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, isAdmin: false }) }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter" }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system" }) }));
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { useSectionPrefs: () => ({ visible: SECTIONS, prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, setHidden: vi.fn(() => true) }) };
});

import { SettingsTab } from "@/components/profile/SettingsTab";
import { LANG_KEY, getLang, __resetLangForTests } from "@/lib/i18n/language";

beforeEach(() => {
  __resetLangForTests();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
});

function renderSettings() {
  render(
    <MemoryRouter>
      <SettingsTab profile={null} seniorMode={false} onToggleSeniorMode={() => {}} onSelectTab={vi.fn()} onRequestLogout={vi.fn()} onBack={() => {}} />
    </MemoryRouter>,
  );
}

describe("You › Settings › Language", () => {
  it("the Look group has a Language row with the shared English / Español switch", () => {
    renderSettings();
    const look = screen.getByRole("region", { name: "Look" });
    const row = look.querySelector('[data-settings-row="language"]') as HTMLElement | null;
    expect(row, "Language row in Look").not.toBeNull();
    const toggle = within(row as HTMLElement).getByTestId("language-toggle");
    const buttons = within(toggle).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["English", "Español"]);
    expect(buttons.length).toBeGreaterThan(1);
  });

  it("choosing Español switches the app, <html lang> and the saved choice", () => {
    renderSettings();
    const row = document.querySelector('[data-settings-row="language"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Español" }));
    expect(getLang()).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(window.localStorage.getItem(LANG_KEY)).toBe("es");
    expect(within(row).getByRole("button", { name: "Español" }).getAttribute("aria-pressed")).toBe("true");
  });
});
