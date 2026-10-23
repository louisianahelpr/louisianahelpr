/**
 * THE LANDING SAYS WHAT IS OPEN TODAY (owner answers 2026-10-21, via the lead):
 *   - the hero subhead is exactly "Hire help or find work. One account, real
 *     neighbors." (owner pop-up 2026-10-23, when ID verification was turned
 *     off; it changes again as the other sections open),
 *     and CLAUDE.md's locked-copy rule quotes the same words;
 *   - ONE "Opening soon" line sits above the unopened section cards, never a
 *     pill on each card; the Jobs card keeps its "Browse jobs" link;
 *   - the closing line is exactly "One free account. Jobs are open now."
 *
 * The open/soon answer is fed through useSectionsOpen (the real fail-closed
 * sectionIsComingSoon decides each card), so no Supabase is involved.
 *
 * @mutate src/components/landing/HeroSection.tsx | Hire help or find work. One account | Hire help or find work. Sell or find a deal. Shop local or open a shop. Find a place or list one. One account
 * @mutate src/components/landing/SectionsShowcase.tsx | <h3 className="text-ds-20 font-bold tracking-tight mt-2">{s.navLabel}</h3> | <h3 className="text-ds-20 font-bold tracking-tight mt-2">{s.navLabel}</h3>{soon && <span>Opening soon</span>}
 * @mutate src/components/landing/SectionsShowcase.tsx |   const soonCards = cards.filter((c) => c.soon); |   const soonCards = cards.filter(() => false);
 * @mutate src/components/landing/SectionsShowcase.tsx | One free account. Jobs are open now. | One free account for Jobs, Declutter, Shops and Homes.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({ open: null as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: state.open }) };
});

import HeroSection from "@/components/landing/HeroSection";
import { SectionsShowcase } from "@/components/landing/SectionsShowcase";
import { SECTIONS } from "@/components/sections/sectionsConfig";

const ROOT = resolve(__dirname, "..", "..");
const SUBHEAD = "Hire help or find work. One account, real neighbors.";

function renderSections(open: ReadonlySet<string> | null) {
  state.open = open;
  return render(<MemoryRouter><SectionsShowcase /></MemoryRouter>);
}

describe("the landing says what is open today", () => {
  it("the hero subhead is the owner's words, and CLAUDE.md locks the same words", () => {
    render(<MemoryRouter><HeroSection /></MemoryRouter>);
    expect(screen.getByText(SUBHEAD)).toBeTruthy();
    const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
    expect(claude).toContain(`subhead "${SUBHEAD}"`);
    // The H1 is untouched (locked).
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Louisiana’s local partner.");
  });

  it("while pending (fails closed): ONE Opening soon line above the three unopened cards, no pill on any card", () => {
    const { container, unmount } = renderSections(null);
    const cards = [...container.querySelectorAll("[data-section]")];
    // Inventory floor: every section in sectionsConfig has a card.
    expect(cards.length).toBe(SECTIONS.length);
    expect(cards.length).toBeGreaterThan(3);
    expect(screen.getAllByText("Opening soon")).toHaveLength(1);
    for (const c of cards) expect(c.textContent, c.getAttribute("data-section")!).not.toMatch(/Opening soon/);

    const line = screen.getByTestId("landing-sections-soon");
    const soonList = screen.getByRole("list", { name: "Opening soon" });
    const soon = [...soonList.querySelectorAll("[data-section]")].map((c) => c.getAttribute("data-section"));
    expect(soon).toEqual(SECTIONS.filter((s) => s.feature !== null).map((s) => s.key));
    // The line comes before the cards it names.
    expect(line.compareDocumentPosition(soonList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Jobs keeps its link to the public board; no unopened card has one.
    const jobs = container.querySelector('[data-section="jobs"]') as HTMLElement;
    expect(within(jobs).getByRole("link", { name: /Browse jobs/ }).getAttribute("href")).toBe("/browse");
    expect(within(soonList).queryAllByRole("link")).toHaveLength(0);
    unmount();
  });

  it("a section that opens leaves the Opening soon group; the line stays one", () => {
    const { container, unmount } = renderSections(new Set(["declutter"]));
    expect(screen.getAllByText("Opening soon")).toHaveLength(1);
    const soonList = screen.getByRole("list", { name: "Opening soon" });
    expect(soonList.querySelector('[data-section="declutter"]')).toBeNull();
    expect(container.querySelector('[data-section="declutter"] a')).not.toBeNull();
    unmount();
  });

  it("every section open: no Opening soon line at all", () => {
    const features: string[] = [];
    for (const s of SECTIONS) if (s.feature) features.push(s.feature);
    expect(features.length).toBeGreaterThan(2);
    const { unmount } = renderSections(new Set(features));
    expect(screen.queryByText("Opening soon")).toBeNull();
    unmount();
  });

  it("the closing line is the owner's words", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/landing/SectionsShowcase.tsx"), "utf8"));
    expect(src).toMatch(/>One free account\. Jobs are open now\.<\/p>/);
    expect(src).not.toMatch(/One free account for Jobs, Declutter, Shops and Homes/);
  });
});
