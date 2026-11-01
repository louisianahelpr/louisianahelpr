/**
 * The landing hero in Spanish (UX-8 phase 1; Auditor 3 A3-3, 11-01): a visitor whose saved language is Spanish reads
 * the hero's faithful translation (hero.* in es.ts, lead 2026-10-29); English stays the LOCKED copy, unchanged
 * (CLAUDE.md). The hero imports nothing from the i18n modules on first paint (useHeroWords.ts fetches the Spanish
 * words only when the language is Spanish), so guest first paint does not grow.
 *
 * @mutate src/components/landing/HeroSection.tsx |   const es = useHeroWords(); |   const es = null as ReturnType<typeof useHeroWords>; void useHeroWords;
 * @mutate src/components/landing/useHeroWords.ts |   if (saved === "en" \|\| saved === "es") return saved === "es"; |   if (saved === "en" \|\| saved === "es") return false;
 * @mutate src/components/landing/HeroSection.tsx | <span className="hidden sm:inline">{es ? es.searchButton : "Search"}</span> | <span className="hidden sm:inline">Search</span>
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { es } from "@/lib/i18n/es";
import { enScreens } from "@/lib/i18n/enScreens";
import HeroSection from "@/components/landing/HeroSection";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/landing/LandingProof", () => ({ LandingProof: () => null }));

const renderHero = () => render(<MemoryRouter><HeroSection /></MemoryRouter>);

describe("the landing hero speaks the visitor's language", () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem("helpr_lang");
  });

  it("Spanish: the title, subhead and search are the es words", async () => {
    localStorage.setItem("helpr_lang", "es");
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1 });
    await waitFor(() => expect(h1.textContent).toBe(`${es["hero.titleLead"]} ${es["hero.titleAccent"]}`));
    expect(screen.getByText(es["hero.subhead"])).toBeTruthy();
    expect(screen.getByPlaceholderText(es["hero.searchLabel"])).toBeTruthy();
    expect(screen.getByText(es["hero.searchButton"])).toBeTruthy();
  });

  it("English: the locked copy, word for word", async () => {
    localStorage.setItem("helpr_lang", "en");
    renderHero();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Louisiana’s local partner.");
    expect(screen.getByText("Hire help or find work. One account, real neighbors.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search local jobs")).toBeTruthy();
    // The locked English and the en dictionary agree, so the two can never drift apart.
    expect(`${enScreens["hero.titleLead"]} ${enScreens["hero.titleAccent"]}`).toBe("Louisiana’s local partner.");
    expect(enScreens["hero.subhead"]).toBe("Hire help or find work. One account, real neighbors.");
  });

  it("first paint: the hero imports no i18n module (the Spanish words are a dynamic import)", () => {
    const hero = blankComments(readFileSync("src/components/landing/HeroSection.tsx", "utf8"));
    const words = blankComments(readFileSync("src/components/landing/useHeroWords.ts", "utf8"));
    expect(hero).not.toMatch(/from "@\/lib\/i18n/);
    expect(words).not.toMatch(/^import .*i18n/m);
    expect(words).toContain(`import("@/lib/i18n/es")`);
  });
});
