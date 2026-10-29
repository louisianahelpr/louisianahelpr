/**
 * THE LANDING SAYS WHAT IS OPEN TODAY (owner answers 2026-10-21, via the lead):
 *   - the hero subhead is exactly "Hire help or find work. One account, real
 *     neighbors." (owner pop-up 2026-10-23, when ID verification was turned
 *     off; it changes again as the other sections open),
 *     and CLAUDE.md's locked-copy rule quotes the same words;
 *   - ONE "Coming soon" line sits above the unopened section cards, never a
 *     pill on each card; the Jobs card keeps its "Browse jobs" link;
 *   - the closing line is exactly "One free account. Jobs are open now."
 *
 * The open/soon answer is fed through useSectionsOpen (the real fail-closed
 * sectionIsComingSoon decides each card), so no Supabase is involved.
 *
 * @mutate src/components/landing/HeroSection.tsx | Hire help or find work. One account | Hire help or find work. Sell or find a deal. Shop local or open a shop. Find a place or list one. One account
 * @mutate src/components/landing/SectionsShowcase.tsx | <h3 className="text-ds-20 font-bold tracking-tight mt-2">{s.navLabel}</h3> | <h3 className="text-ds-20 font-bold tracking-tight mt-2">{s.navLabel}</h3>{soon && <span>Coming soon</span>}
 * @mutate src/components/landing/SectionsShowcase.tsx |   const soonCards = cards.filter((c) => c.soon); |   const soonCards = cards.filter(() => false);
 * @mutate src/components/landing/SectionsShowcase.tsx | One free account. Jobs are open now. | One free account for Jobs, Declutter, Shops and Homes.
 *
 * ONE WORD for a closed section (audit 2026-10-28 P5-4): the landing said
 * "Opening soon" while the rail and the Explore chips (SoonPill "rail" and
 * "caption") say "Coming soon". The landing line now uses the rail's word, read
 * from the rendered SoonPill so the two cannot drift apart.
 * @mutate src/components/landing/SectionsShowcase.tsx |                 Coming soon\n |                 Opening soon\n
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
import { SoonPill } from "@/components/sections/SoonPill";

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

  it("while pending (fails closed): ONE Coming soon line above the three unopened cards, no pill on any card", () => {
    const { container, unmount } = renderSections(null);
    const cards = [...container.querySelectorAll("[data-section]")];
    // Inventory floor: every section in sectionsConfig has a card.
    expect(cards.length).toBe(SECTIONS.length);
    expect(cards.length).toBeGreaterThan(3);
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
    for (const c of cards) expect(c.textContent, c.getAttribute("data-section")!).not.toMatch(/Coming soon/);

    const line = screen.getByTestId("landing-sections-soon");
    const soonList = screen.getByRole("list", { name: "Coming soon" });
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

  it("a section that opens leaves the Coming soon group; the line stays one", () => {
    const { container, unmount } = renderSections(new Set(["declutter"]));
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
    const soonList = screen.getByRole("list", { name: "Coming soon" });
    expect(soonList.querySelector('[data-section="declutter"]')).toBeNull();
    expect(container.querySelector('[data-section="declutter"] a')).not.toBeNull();
    unmount();
  });

  it("every section open: no Coming soon line at all", () => {
    const features: string[] = [];
    for (const s of SECTIONS) if (s.feature) features.push(s.feature);
    expect(features.length).toBeGreaterThan(2);
    const { unmount } = renderSections(new Set(features));
    expect(screen.queryByText("Coming soon")).toBeNull();
    unmount();
  });

  it("the landing's soon line uses the same word as the rail and the Explore chips (P5-4)", () => {
    const rail = render(<SoonPill variant="rail" />);
    const railWord = rail.container.textContent;
    rail.unmount();
    const chip = render(<SoonPill variant="caption" />);
    expect(chip.container.textContent).toBe(railWord);
    chip.unmount();
    const { unmount } = renderSections(null);
    expect(screen.getByTestId("landing-sections-soon").textContent).toBe(railWord);
    unmount();
  });

  it("the closing line is the owner's words", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/landing/SectionsShowcase.tsx"), "utf8"));
    expect(src).toMatch(/>One free account\. Jobs are open now\.<\/p>/);
    expect(src).not.toMatch(/One free account for Jobs, Declutter, Shops and Homes/);
  });
});
