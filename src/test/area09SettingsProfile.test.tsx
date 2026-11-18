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
 * @mutate src/pages/profile/SavedSearchesTab.tsx | font-semibold text-ds-15 line-clamp-2 break-words | font-semibold text-ds-15 truncate
 * @mutate src/pages/profile/SavedSearchesTab.tsx | title={t("ss.title")} | title="Saved searches"
 * @mutate src/components/profile/profileLanding/YouCard.tsx |           Public profile\n |           View my public profile\n
 * @mutate src/lib/i18n/enYourPage.ts | "yp.page": "Your public profile" | "yp.page": "Your page"
 * @mutate src/lib/i18n/enAccount.ts | "acct.linkTitle": "Public profile link" | "acct.linkTitle": "Your profile link"
 * @mutate src/components/profile/SettingsTab.tsx |         <PaymentMethodsRow />\n |
 * @mutate src/pages/admin/AdminFrame.tsx |         title="Log out?" |         title="Sign out?"
 * @mutate src/lib/i18n/enScreens.ts | "profileGate.signOut": "Log out" | "profileGate.signOut": "Sign out"
 * @mutate src/components/help/HelpEntry.tsx |   if (onHelpScreen(pathname, search)) return null; |
 * @mutate src/components/profile/SupportInline.tsx | data-support-reply-time="">{SUPPORT_REPLY_PROMISE}</p> | data-support-reply-time="">A real person reads every message. {SUPPORT_REPLY_PROMISE}</p>
 * @mutate src/components/profile/DeleteAccountDialog.tsx |   return <WhatHappensList lines={WHAT_HAPPENS} extra={<DownloadFirst />} />; |   return <WhatHappensList lines={[...WHAT_HAPPENS, DOWNLOAD_LINE]} />;
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
import { onHelpScreen } from "@/components/help/HelpEntry";

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

describe("design audit area 09: Saved searches speaks Spanish (H1)", () => {
  it("every word on the screen comes from t(), none is an English literal", () => {
    const tab = src("src/pages/profile/SavedSearchesTab.tsx");
    const keys = tab.match(/t\("ss\.[A-Za-z]+"/g) ?? [];
    expect(keys.length).toBeGreaterThan(15);
    for (const lit of ["Saved searches", "Pause all alerts", "Delete search", "Keep it", "Alerts for this search"]) {
      expect(tab, lit).not.toMatch(new RegExp(`[>"]${lit}[<"]`));
    }
  });
});

describe("design audit area 09: one name for the public profile (M3)", () => {
  it("You, the link card, Settings and the profile itself all say public profile", () => {
    const you = src("src/components/profile/profileLanding/YouCard.tsx");
    expect(you).toMatch(/>\s*Public profile\s*<\/Button>/);
    expect(you).not.toContain("View my public profile");
    expect(enAccount["acct.linkTitle"]).toBe("Public profile link");
    expect(src("src/components/profile/ProfileLinkRow.tsx")).toContain('{t("acct.linkTitle")}');
    const yp = src("src/lib/i18n/enYourPage.ts");
    expect(yp).toContain('"yp.page": "Your public profile"');
    expect(yp).toContain('"yp.shareLabel": "Share profile"');
    const own = src("src/pages/user/UserProfile.tsx");
    expect(own).not.toContain("How others see you");
    const names = [you, own, yp, src("src/components/profile/ProfileLinkRow.tsx")].join("\n");
    for (const old of ["Your profile link", "\"Your page\"", "Share your page"]) expect(names, old).not.toContain(old);
  });
});

describe("design audit area 09: Privacy shows the saved address and where cards live (M14)", () => {
  it("Settings' Privacy group has a Saved address row and a Payment methods row", () => {
    const tab = src("src/components/profile/SettingsTab.tsx");
    const privacy = tab.slice(tab.indexOf('<Group title="Privacy">'));
    expect(privacy.indexOf("<SavedAddressRow />")).toBeGreaterThan(0);
    expect(privacy.indexOf("<PaymentMethodsRow />")).toBeGreaterThan(0);
    expect(enAccount["acct.paymentMethodsBody"]).toContain("Stripe");
    expect(esAccount["acct.paymentMethodsBody"]).toContain("Stripe");
  });
});

describe("design audit area 09 L6 / area 11b L12: Log out, never Sign out", () => {
  it("every log-out control and dialog says Log out", () => {
    const files = [
      "src/components/auth/Under13Blocked.tsx",
      "src/pages/auth/AccountBanned.tsx",
      "src/pages/admin/AdminFrame.tsx",
      "src/components/admin/AdminSidebar.tsx",
      "src/pages/auth/ResetPassword.tsx",
      "src/lib/i18n/enScreens.ts",
      "src/components/auth/SignOutConfirmDialog.tsx",
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const code = src(f);
      expect(code, f).not.toMatch(/["'>]\s*Sign [Oo]ut\b|Sign out everywhere|sign back in/);
    }
  });
});

describe("design audit area 09: the Help screen says it once (L9)", () => {
  it("no second 'A real person reads every message', and no Help button on Help", () => {
    expect(src("src/components/profile/SupportInline.tsx")).not.toContain("A real person reads every message");
    expect(onHelpScreen("/profile", "?tab=support")).toBe(true);
    expect(onHelpScreen("/support", "")).toBe(true);
    expect(onHelpScreen("/profile", "?tab=settings")).toBe(false);
    expect(onHelpScreen("/home", "")).toBe(false);
    expect(src("src/components/help/HelpEntry.tsx")).toContain("if (onHelpScreen(pathname, search)) return null;");
  });
});

describe("design audit area 09: the delete sheet's download hint is a button (L12)", () => {
  it("from Settings, step 1 offers Download my data in place, through the same export", () => {
    const dlg = src("src/components/profile/DeleteAccountDialog.tsx");
    expect(dlg).toContain("extra={<DownloadFirst />}");
    const fn = dlg.slice(dlg.indexOf("function DownloadFirst("), dlg.indexOf("function WhatHappensList("));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toContain("useDataExport(");
    expect(fn).toContain("onClick={() => void startExport()}");
  });
});

describe("design audit area 09: saved search rows (M8)", () => {
  it("the name wraps to two lines and the row has no chevron", () => {
    const tab = src("src/pages/profile/SavedSearchesTab.tsx");
    const name = tab.match(/<span data-saved-search-name="" className="([^"]+)"/);
    expect(name).not.toBeNull();
    expect(name![1]).toContain("line-clamp-2");
    expect(name![1]).not.toContain("truncate");
    expect(tab).not.toContain("ChevronRight");
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
