/**
 * F260q (owner 11-11 ~2:10 PM, OWNER-DECISIONS.md "Spanish everything"): the signed-out public pages speak Spanish
 * when the visitor picks it. The footer (on every public page, landing included) reads the Spanish words through
 * landing/useGuestSpanish.ts (no i18n module on first paint), carries the English / Español switch (lazy), and
 * follows a switch made on the page; /fees and /safety read t().
 *
 * @mutate src/components/Footer.tsx |   const w = (key: string, english: string) => es?.[key] ?? english; |   const w = (key: string, english: string) => (void key, english);
 * @mutate src/components/landing/useGuestSpanish.ts |     window.addEventListener(LANG_EVENT, read); |     void LANG_EVENT;
 * @mutate src/components/Footer.tsx |           <LanguageToggle />\n        </Suspense> |           {null}\n        </Suspense>
 * @mutate src/pages/info/Fees.tsx |         <p>{t("fees.postFree")}</p> |         <p>Posting a job is free.</p>
 * @mutate src/pages/info/Safety.tsx |         <li>{t("safety.moneyHeld")}</li> |         <li>Your money is held safely until you approve the work.</li>
 * @mutate src/components/landing/useHeroWords.ts |     window.addEventListener("helpr:lang", read); |     void read;
 * @mutate src/components/profile/LegalTab.tsx | <span className="relative truncate">{tr(`legal.tab.${key}` as const)}</span> | <span className="relative truncate">{`${key}`}</span>
 * @mutate src/pages/info/legal/LegalTabBar.tsx | <span className="relative">{tr(`legal.tab.${t}` as const)}</span> | <span className="relative">{`${t}`}</span>
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, ready: true, loading: false }) }));
vi.mock("@/lib/useIdCheckOnForViewer", () => ({ useIdCheckOnForViewer: () => true }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/components/landing/LandingProof", () => ({ LandingProof: () => null }));

import Footer from "@/components/Footer";
import Fees from "@/pages/info/Fees";
import Safety from "@/pages/info/Safety";
import { enPublic } from "@/lib/i18n/enPublic";
import { esPublic } from "@/lib/i18n/esPublic";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { Tabs } from "@/components/ui/tabs";
import { LegalTabBar } from "@/pages/info/legal/LegalTabBar";
import { TAB_LABELS, VALID_TABS } from "@/pages/info/legal/legalSections";

const footerSrc = blankComments(readFileSync("src/components/Footer.tsx", "utf8"));
const pairs = [...footerSrc.matchAll(/\bw\("([\w.]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]] as const);

beforeEach(() => {
  __resetLangForTests();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
  window.localStorage.clear();
});

const renderFooter = () => render(<MemoryRouter><Footer /></MemoryRouter>);
const footerText = () => document.querySelector("footer")?.textContent ?? "";

describe("F260q: the footer speaks the visitor's language", () => {
  it("every footer word goes through the dictionary, and its English is enPublic's, word for word", () => {
    expect(pairs.length).toBeGreaterThan(18);
    for (const [k, english] of pairs) expect(enPublic[k as keyof typeof enPublic], k).toBe(english);
  });

  it("first paint: the footer imports no i18n module (Spanish words and the switch are dynamic imports)", () => {
    expect(footerSrc).not.toMatch(/^import .*@\/lib\/i18n/m);
    expect(footerSrc).not.toMatch(/^import .*LanguageToggle/m);
    expect(blankComments(readFileSync("src/components/landing/useGuestSpanish.ts", "utf8"))).not.toMatch(/^import .*i18n/m);
  });

  it("English: unchanged", async () => {
    window.localStorage.setItem("helpr_lang", "en");
    renderFooter();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText("Explore")).toBeTruthy();
    expect(screen.getByText("Contact us")).toBeTruthy();
  });

  it("Spanish saved: every footer word is the Spanish one, and the switch is there", async () => {
    window.localStorage.setItem("helpr_lang", "es");
    renderFooter();
    await waitFor(() => expect(screen.getByText(esPublic["footer.explore"])).toBeTruthy());
    const text = footerText();
    // Visible words only (aria-labels and titles are checked by label below); a word the same in both ("Legal") is no miss.
    const ATTRS = new Set(["footer.appStore", "footer.appStoreTitle", "footer.facebook", "footer.facebookTitle", "footer.instagram", "footer.instagramTitle", "footer.love"]);
    const left = pairs.filter(([k, english]) => !ATTRS.has(k) && esPublic[k as keyof typeof esPublic] !== english && text.includes(english));
    expect(left).toEqual([]);
    expect(text).toContain("Términos");
    expect(text).toContain("Contáctenos");
    expect(screen.getByLabelText(esPublic["footer.facebook"])).toBeTruthy();
    expect(await screen.findByTestId("language-toggle")).toBeTruthy();
  });

  it("a switch made on the page turns the footer Spanish without a reload", async () => {
    window.localStorage.setItem("helpr_lang", "en");
    renderFooter();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText("Explore")).toBeTruthy();
    act(() => setLang("es"));
    await waitFor(() => expect(screen.getByText(esPublic["footer.explore"])).toBeTruthy());
  });
});

describe("F260q: /fees and /safety in Spanish", () => {
  it("every line is the Spanish one after the switch", async () => {
    setLang("es");
    await act(async () => { await ensureLangLoaded(); });
    const { container } = render(<MemoryRouter><Fees /><Safety /></MemoryRouter>);
    const fees = container.querySelector("[data-fees-body]")!.textContent!;
    expect(fees).toBe([esPublic["fees.postFree"], esPublic["fees.setupFee"], esPublic["fees.shownFirst"], esPublic["fees.helprsSeePay"]].join(""));
    const safety = [...container.querySelectorAll("[data-safety-body] li")].map((li) => li.textContent);
    expect(safety).toEqual([esPublic["safety.idChecked"], esPublic["safety.moneyHeld"], esPublic["safety.report"]]);
    expect(screen.getByRole("heading", { name: esPublic["fees.title"] })).toBeTruthy();
    expect(screen.getByRole("heading", { name: esPublic["safety.title"] })).toBeTruthy();
  });
});

describe("F260q: the landing hero follows a switch made on the page", () => {
  it("English, then the footer's Español: the hero turns Spanish without a reload", async () => {
    const { default: HeroSection } = await import("@/components/landing/HeroSection");
    const { es } = await import("@/lib/i18n/es");
    window.localStorage.setItem("helpr_lang", "en");
    render(<MemoryRouter><HeroSection /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Louisiana’s local partner.");
    act(() => setLang("es"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(`${es["hero.titleLead"]} ${es["hero.titleAccent"]}`));
  });
});

describe("F260q: /legal's tab names", () => {
  const draw = () => render(<Tabs value="terms"><LegalTabBar tab="terms" hideIconsOnPhone={false} /></Tabs>);
  it("English: exactly TAB_LABELS", async () => {
    draw();
    for (const k of VALID_TABS) {
      expect(enPublic[`legal.tab.${k}` as const]).toBe(TAB_LABELS[k]);
      expect(screen.getByRole("tab", { name: new RegExp(TAB_LABELS[k]) })).toBeTruthy();
    }
  });
  it("Spanish: Términos, Reglas, Privacidad", async () => {
    setLang("es");
    await act(async () => { await ensureLangLoaded(); });
    draw();
    for (const k of VALID_TABS) expect(screen.getByRole("tab", { name: new RegExp(esPublic[`legal.tab.${k}` as const]) })).toBeTruthy();
  });
});

describe("F260q: Profile > Legal's tab names follow the language", () => {
  it("LegalTab.tsx prints the legal.tab.* keys through t(), not TAB_LABELS", () => {
    const src = blankComments(readFileSync("src/components/profile/LegalTab.tsx", "utf8"));
    const hits = src.match(/tr\(`legal\.tab\.\$\{key\}` as const\)/g) ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/\{TAB_LABELS\[key\]\}/);
  });
});
