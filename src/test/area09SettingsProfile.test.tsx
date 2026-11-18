/**
 * Design audit area 09 (Settings, You, profiles, account; 11-18). The screens that were still English in Spanish
 * (H1) read their words from src/lib/i18n/enAccount.ts, the Spanish has every key, and the smaller fixes hold:
 * one "Match phone" / "Color and text" name (L8), "and" not "&" in Settings' sentence copy (L19), 44px rows in the
 * visitor's More menu (L16), a heart that says its state (L17).
 *
 * @mutate src/components/profile/WarningsTab.tsx |         title={t("acct.warningsTitle")} |         title="Warnings and strikes"
 * @mutate src/pages/profile/BlockedPeopleTab.tsx |               ? t("acct.blockedSome") |               ? "They can't message you."
 * @mutate src/components/profile/AccessibilityTab.tsx |   { value: "system", label: t("acct.matchPhone"), | { value: "system", label: "Auto",
 * @mutate src/components/profile/ShowInSearchSwitch.tsx | {t("acct.searchTitle")} | Show my profile in search engines
 * @mutate src/pages/user/VisitorProfileActions.tsx | <DropdownMenuItem onClick={onBlock} className="min-h-11"> | <DropdownMenuItem onClick={onBlock}>
 * @mutate src/components/SaveHelperButton.tsx |       aria-pressed={saved} |
 * @mutate src/lib/i18n/enSettings.ts | "Terms, rules and privacy" | "Terms, rules & privacy"
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system", setTheme: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null }) }));

import { enAccount } from "@/lib/i18n/enAccount";
import { esAccount } from "@/lib/i18n/esAccount";
import { enSettings } from "@/lib/i18n/enSettings";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { TAB_TITLES } from "@/pages/profile/types";
import { WarningsTab } from "@/components/profile/WarningsTab";
import { AccessibilityTab } from "@/components/profile/AccessibilityTab";
import { ShowInSearchSwitch } from "@/components/profile/ShowInSearchSwitch";

const src = (p: string) => blankComments(readFileSync(resolve(p), "utf8"));

beforeEach(() => { __resetLangForTests(); window.localStorage.clear(); });
afterEach(() => { cleanup(); __resetLangForTests(); });

async function spanish() {
  await act(async () => { setLang("es"); await ensureLangLoaded(); });
}

function renderAll() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WarningsTab violations={[]} loading={false} onBack={() => {}} />
        <AccessibilityTab seniorMode={false} onBack={() => {}} />
        <ShowInSearchSwitch userId="u1" initial={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("design audit area 09: the account screens follow the member's language (H1)", () => {
  it("every English word has its Spanish, and none is left as the English", () => {
    const keys = Object.keys(enAccount) as (keyof typeof enAccount)[];
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) {
      expect(esAccount[k], k).toBeTruthy();
      if (!/^acct\.(profile)$/.test(k)) expect(esAccount[k], k).not.toBe(enAccount[k]);
    }
  });

  it("Warnings, Color and text and the search switch draw no English after switching to Español", async () => {
    await spanish();
    const { container } = renderAll();
    const text = container.textContent ?? "";
    for (const english of ["Warnings and strikes", "Good standing", "of 3 strikes", "Color and text", "Color mode", "Light", "Dark", "Match phone", "Show my profile in search engines"]) {
      expect(text, english).not.toContain(english);
    }
    expect(text).toContain("Advertencias y faltas");
    expect(text).toContain("Color y texto");
    expect(text).toContain("Mostrar mi perfil en buscadores");
  });

  it("in English: the strikes line is a 13px sentence and Good standing has no trailing Keep it up (L13)", () => {
    const { container } = renderAll();
    const line = container.querySelector("[data-strikes-line]")!;
    expect(line.textContent).toBe("0 of 3 strikes");
    expect(line.className).toContain("text-ds-13");
    expect(line.className).not.toContain("uppercase");
    expect(container.textContent).not.toContain("Keep it up");
  });

  it("Blocked people reads its words from the dictionary", () => {
    const blocked = src("src/pages/profile/BlockedPeopleTab.tsx");
    for (const k of ["acct.blockedTitle", "acct.blockedSome", "acct.blockedNone", "acct.unblock", "acct.blockedLoadFailed", "acct.goneName"]) {
      expect(blocked).toContain(`t("${k}"`);
    }
    expect(blocked).not.toMatch(/"You haven't blocked anyone/);
  });
});

describe("design audit area 09: one name each, and plain 'and' (L8, L19)", () => {
  it("the screen, its tab title and Settings' row say Color and text; system is Match phone", async () => {
    expect(TAB_TITLES.accessibility).toBe("Color and text");
    expect(enSettings["settings.colorMode"]).toBe("Color and text");
    expect(enSettings["settings.matchPhone"]).toBe("Match phone");
    expect(src("src/components/profile/SettingsTab.tsx")).toContain('system: "Match phone"');
    const { container } = renderAll();
    expect(container.textContent).toContain("Match phone");
    expect(container.textContent).not.toContain("Auto");
  });

  it("Settings' words use 'and', never '&'", () => {
    const amp = Object.entries(enSettings).filter(([, v]) => v.includes("&"));
    expect(Object.keys(enSettings).length).toBeGreaterThan(40);
    expect(amp).toEqual([]);
  });
});

describe("design audit area 09: the visitor's profile actions (L16, L17)", () => {
  it("each More menu row is 44px tall", () => {
    const items = src("src/pages/user/VisitorProfileActions.tsx").match(/<DropdownMenuItem\b[^>]*>/g) ?? [];
    expect(items.length).toBeGreaterThan(1);
    for (const tag of items) expect(tag).toContain('className="min-h-11"');
  });

  it("the heart says whether this Helpr is saved", () => {
    expect(src("src/components/SaveHelperButton.tsx")).toContain("aria-pressed={saved}");
  });
});
