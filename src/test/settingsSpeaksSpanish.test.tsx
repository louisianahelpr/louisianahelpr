/**
 * F410c (audit 11-10, High): switching to Español in You › Settings translated only "Idioma" and "Muy pronto";
 * every other row, heading and line stayed English. Now the whole screen reads its words from the dictionary
 * (src/lib/i18n/enSettings.ts, looked up by the English the screen draws), so after the switch no heading, row
 * name or row line is left in English, and the English stays exactly the words the shared labels say.
 *
 * @mutate src/components/profile/SettingsTab.tsx |     return key ? t(key) : english; |     return english;
 * @mutate src/components/profile/SettingsTab.tsx |   const label = word(englishLabel); |   const label = englishLabel;
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1", email: null, identities: [] }, profile: null, isAdmin: false, refresh: vi.fn() }) }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter" }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system" }) }));
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { useSectionPrefs: () => ({ visible: SECTIONS, prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, setHidden: vi.fn(() => true) }) };
});

import { SettingsTab, SECTION_BLURB } from "@/components/profile/SettingsTab";
import { enSettings } from "@/lib/i18n/enSettings";
import { es } from "@/lib/i18n/es";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { TAB_TITLES, REPORT_BUG_TITLE } from "@/pages/profile/types";
import { BIGGER_TEXT_LABEL, BIGGER_TEXT_SUB } from "@/components/profile/biggerTextWords";
import { SHARE_JOB_PHOTOS_LABEL } from "@/lib/jobPhotosConsent";

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
      <SettingsTab profile={null} seniorMode={false} onToggleSeniorMode={() => {}} onSelectTab={vi.fn()} onRequestLogout={vi.fn()} onRequestDelete={vi.fn()} onBack={() => {}} />
    </MemoryRouter>,
  );
}

/** Every heading, row name and row line the screen draws. */
function drawnWords(): string[] {
  const heads = [...document.querySelectorAll("section > h2")].map((h) => h.textContent ?? "");
  const rows = [...document.querySelectorAll("[data-settings-row]")].flatMap((r) =>
    [...r.querySelectorAll("span.block")].map((s) => s.textContent ?? ""),
  );
  return [...heads, ...rows].map((w) => w.trim()).filter(Boolean);
}

describe("You › Settings in Spanish (F410c)", () => {
  it("the English words are exactly the shared labels the screen draws", () => {
    expect(enSettings["settings.biggerText"]).toBe(BIGGER_TEXT_LABEL);
    expect(enSettings["settings.biggerTextSub"]).toBe(BIGGER_TEXT_SUB);
    expect(enSettings["settings.sharePhotos"]).toBe(SHARE_JOB_PHOTOS_LABEL);
    expect(enSettings["settings.notifications"]).toBe(TAB_TITLES.notifications);
    expect(enSettings["settings.savedSearches"]).toBe(TAB_TITLES.saved_searches);
    expect(enSettings["settings.editProfile"]).toBe(TAB_TITLES.profile);
    expect(enSettings["settings.security"]).toBe(TAB_TITLES.security);
    expect(enSettings["settings.blocked"]).toBe(TAB_TITLES.blocked);
    expect(enSettings["settings.warnings"]).toBe(TAB_TITLES.warnings);
    expect(enSettings["settings.legal"]).toBe(TAB_TITLES.legal);
    expect(enSettings["settings.reportBug"]).toBe(REPORT_BUG_TITLE);
    expect(enSettings["settings.jobsBlurb"]).toBe(SECTION_BLURB.jobs);
    expect(enSettings["settings.declutterBlurb"]).toBe(SECTION_BLURB.declutter);
  });

  it("in English the screen is unchanged", () => {
    renderSettings();
    expect(screen.getByRole("region", { name: "Look" })).toBeTruthy();
    expect(drawnWords()).toContain(BIGGER_TEXT_LABEL);
    expect(drawnWords()).toContain("Log out");
  });

  it("after switching to Español, no heading, row name or row line is left in English", async () => {
    setLang("es");
    await act(async () => { await ensureLangLoaded(); });
    renderSettings();
    const words = drawnWords();
    expect(words.length).toBeGreaterThan(15);
    const english = new Set<string>(Object.values(enSettings));
    // Words that are the same in both languages (none today) would be allowed; anything else English is a miss.
    const same = new Set(Object.entries(enSettings).filter(([k, v]) => es[k as keyof typeof es] === v).map(([, v]) => v));
    const left = words.filter((w) => english.has(w) && !same.has(w));
    expect(left).toEqual([]);
    expect(screen.getByRole("region", { name: "Apariencia" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Su cuenta" })).toBeTruthy();
    expect(words).toContain("Texto y botones más grandes");
    expect(words).toContain("Cerrar sesión");
    expect(words).toContain("Eliminar la cuenta");
  });
});
