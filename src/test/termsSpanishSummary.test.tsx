/**
 * F260r (owner 11-11 ~2:10 PM, OWNER-DECISIONS.md "Spanish everything"): the Terms tab carries a Spanish summary,
 * marked as a courtesy translation ("La versión en inglés de los Términos es la que rige"); the English Terms stay the
 * legal text. The summary follows the same live inputs as "The short version" (ID switch, setup fee, Declutter buyer's
 * fee from checkout's numbers), opens when Spanish is chosen, and has as many points as the English short version.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx |     <TermsSummaryEs open={lang === "es"} | <TermsSummaryEs open={false}
 * @mutate src/pages/info/legal/TermsSummaryEs.tsx |         {COURTESY_NOTE_ES} |         Resumen
 * @mutate src/pages/info/legal/TermsSummaryEs.tsx | ${feeLabel ? `: ${feeLabel}` : ""}, una sola vez | , una sola vez
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ open: new Set<string>(["identity_check"]) as Set<string> | null, fee: 200 as number | null }));
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: state.open, settled: state.open !== null, failed: false }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useOnboardingFee")>()),
  useOnboardingFeeCents: () => state.fee,
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

import { TermsContent } from "@/pages/info/legal/TermsSection";
import { COURTESY_NOTE_ES } from "@/pages/info/legal/TermsSummaryEs";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

const renderTerms = () => render(<MemoryRouter><TermsContent /></MemoryRouter>);
const summary = () => document.querySelector("[data-terms-summary-es]") as HTMLDetailsElement | null;

beforeEach(() => {
  __resetLangForTests();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
  state.open = new Set(["identity_check"]);
  state.fee = 200;
});

describe("F260r: the Terms carry a Spanish courtesy summary", () => {
  it("is on the Terms tab for everyone, marked as a courtesy translation, in Spanish", () => {
    renderTerms();
    const s = summary();
    expect(s).not.toBeNull();
    expect(s!.getAttribute("lang")).toBe("es");
    expect(s!.textContent).toContain("La versión en inglés de los Términos es la que rige");
    expect(COURTESY_NOTE_ES).toContain("Traducción de cortesía");
    // English reader: present but closed.
    expect(s!.open).toBe(false);
  });

  it("has one point for each point of the English short version", () => {
    renderTerms();
    const english = screen.getByText("The short version").closest("div.rounded-\\[20px\\]") as HTMLElement;
    const enItems = english.querySelectorAll("li").length;
    const esItems = summary()!.querySelectorAll("li").length;
    expect(enItems).toBeGreaterThan(5);
    expect(esItems).toBe(enItems);
  });

  it("names the live setup fee and the Declutter buyer's fee, and the ID rule only while it is on", () => {
    renderTerms();
    const text = summary()!.textContent ?? "";
    expect(text).toContain("Cargo único de configuración de la cuenta: $2");
    expect(text).toMatch(/\d+% del precio del artículo más \d+ centavos/);
    // The ID sentence is there exactly when the English short version says it (the same idOn).
    const english = screen.getByText("The short version").closest("div.rounded-\\[20px\\]") as HTMLElement;
    const enSaysId = (english.querySelector("li")?.textContent ?? "").includes("You also verify");
    expect(enSaysId).toBe(true);
    expect(text.includes("identificación con foto")).toBe(enSaysId);
  });

  it("opens by itself when Spanish is chosen", async () => {
    setLang("es");
    await act(async () => { await ensureLangLoaded(); });
    renderTerms();
    expect(summary()!.open).toBe(true);
  });
});
