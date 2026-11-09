/**
 * THE LANDING SAYS WHAT IS OPEN TODAY (owner answers 2026-10-21, via the lead):
 *   - the hero subhead is exactly "Hire help or find work. One account, real
 *     neighbors." (owner pop-up 2026-10-23, when ID verification was turned
 *     off; it changes again as the other sections open),
 *     and CLAUDE.md's locked-copy rule quotes the same words;
 *   - each unopened section card carries its own small "Coming soon" badge and
 *     is slightly dimmed (owner pop-up 2026-11-09, UI audit F002/F013; this
 *     REPLACES the 10-21 rule of ONE line above the unopened cards, which
 *     floated above the Shops card only and sat flush to the phone's edge);
 *     the Jobs card keeps its "Browse jobs" link;
 *   - the closing line is exactly "One free account for jobs and Declutter." (owner's UI audit 11-09, F001: the old
 *     "Jobs are open now." sat on the same page as "No open jobs right now.")
 *
 * The open/soon answer is fed through useSectionsOpen (the real fail-closed
 * sectionIsComingSoon decides each card), so no Supabase is involved.
 *
 * @mutate src/components/landing/HeroSection.tsx | Hire help or find work. One account | Hire help or find work. Sell or find a deal. Shop local or open a shop. Find a place or list one. One account
 * @mutate src/components/landing/SectionsShowcase.tsx |           {badged && (\n            <span | {false && (\n            <span
 * @mutate src/components/landing/SectionsShowcase.tsx | ...(badged ? { opacity: 0.8 } : null) | ...(false ? { opacity: 0.8 } : null)
 * @mutate src/components/landing/SectionsShowcase.tsx |         {!soon && (\n          <Link |         {true && (\n          <Link
 * @mutate src/components/landing/SectionsShowcase.tsx | One free account for jobs and Declutter. | One free account. Jobs are open now.
 *
 * ONE WORD for a closed section (audit 2026-10-28 P5-4): the landing said
 * "Opening soon" while the rail and the Explore chips (SoonPill "rail" and
 * "caption") say "Coming soon". The landing badge uses the rail's word, read
 * from the rendered SoonPill so the two cannot drift apart.
 * @mutate src/components/landing/SectionsShowcase.tsx |               Coming soon\n |               Opening soon\n
 *
 * And everywhere else a member sees it (lead, 2026-10-28): SoonPill's "full"
 * pill (Create sheet, Settings, Customize), Settings' section line and /search's
 * closed-section row said "Opening soon". Every tracked source file under src/
 * (tests excepted, comments blanked) is scanned: the label "Opening soon" is
 * gone. The owner's sentence form ("Homes is opening soon", openingSoonLine,
 * youBoard18) is a sentence, not the label, and is not matched.
 * @mutate src/lib/i18n/enCore.ts |   "soon.full": "Coming soon", |   "soon.full": "Opening soon",
 * @mutate src/pages/search/SearchPage.tsx |         Coming soon\n |         Opening soon\n
 * @mutate src/components/profile/SettingsTab.tsx | sub={on ? SECTION_BLURB[s.key] : "Coming soon"} | sub={on ? SECTION_BLURB[s.key] : "Opening soon"}
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

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

  // F009 (owner UI audit 11-09, High; Builder 6's guard, 795062614d, on the badge rule): "Coming soon" sat over the live
  // Declutter card while the answer loaded, then jumped. While pending there is NO Coming soon; links still fail closed
  // (only Jobs, which has no switch).
  // @mutate src/components/landing/SectionsShowcase.tsx |     const badged = soon && !pending; |     const badged = soon;
  // @mutate src/components/landing/SectionsShowcase.tsx |   const pending = open === null; |   const pending = false;
  it("while pending: no Coming soon yet, no card dimmed, every card in one row, only Jobs links (fails closed)", () => {
    const { container, unmount } = renderSections(null);
    const cards = [...container.querySelectorAll<HTMLElement>("[data-section]")];
    // Inventory floor: every section in sectionsConfig has a card.
    expect(cards.length).toBe(SECTIONS.length);
    expect(cards.length).toBeGreaterThan(3);
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.queryByTestId("landing-sections-soon")).toBeNull();
    for (const c of cards) expect(c.style.opacity, c.dataset.section).toBe("");
    // One list, in sectionsConfig order.
    const row = screen.getByRole("list", { name: "Sections" });
    expect([...row.querySelectorAll("[data-section]")].map((c) => c.getAttribute("data-section"))).toEqual(SECTIONS.map((s) => s.key));

    // Jobs keeps its link to the public board; no switched card has one until the answer is in.
    const jobs = container.querySelector('[data-section="jobs"]') as HTMLElement;
    expect(within(jobs).getByRole("link", { name: /Browse jobs/ }).getAttribute("href")).toBe("/browse");
    for (const s of SECTIONS.filter((x) => x.feature !== null)) {
      expect(container.querySelector(`[data-section="${s.key}"] a`), s.key).toBeNull();
    }
    unmount();
  });

  it("settled with nothing open (a failed read settles empty): a Coming soon badge inside each unopened card, each dimmed, no link; no line outside the cards", () => {
    const { container, unmount } = renderSections(new Set());
    const cards = [...container.querySelectorAll<HTMLElement>("[data-section]")];
    expect(cards.length).toBe(SECTIONS.length);
    const switched: string[] = SECTIONS.filter((s) => s.feature !== null).map((s) => s.key);
    expect(switched.length).toBeGreaterThan(2);
    // One badge per unopened card, each INSIDE its card; nothing outside the cards says it.
    expect(screen.getAllByText("Coming soon")).toHaveLength(switched.length);
    for (const c of cards) {
      const key = c.dataset.section!;
      const soon = switched.includes(key);
      expect(c.dataset.soon, key).toBe(soon ? "true" : "false");
      expect(within(c).queryAllByText("Coming soon"), key).toHaveLength(soon ? 1 : 0);
      expect(c.style.opacity, key).toBe(soon ? "0.8" : "");
      if (soon) expect(within(c).queryAllByRole("link"), key).toHaveLength(0);
    }
    expect(screen.queryByTestId("landing-sections-soon")).toBeNull();
    // The cards keep sectionsConfig's order whatever the answer (no card moves when it comes in).
    expect(cards.map((c) => c.dataset.section)).toEqual(SECTIONS.map((s) => s.key));
    const jobs = container.querySelector('[data-section="jobs"]') as HTMLElement;
    expect(within(jobs).getByRole("link", { name: /Browse jobs/ }).getAttribute("href")).toBe("/browse");
    unmount();
  });

  it("a section that opens loses its badge and dimming and gains its link; the others keep theirs", () => {
    const { container, unmount } = renderSections(new Set(["declutter"]));
    const declutter = container.querySelector('[data-section="declutter"]') as HTMLElement;
    expect(within(declutter).queryByText("Coming soon")).toBeNull();
    expect(declutter.style.opacity).toBe("");
    expect(declutter.querySelector("a")).not.toBeNull();
    const stillSoon = SECTIONS.filter((s) => s.feature !== null && s.feature !== "declutter");
    expect(stillSoon.length).toBeGreaterThan(1);
    expect(screen.getAllByText("Coming soon")).toHaveLength(stillSoon.length);
    expect(container.querySelectorAll("[data-section]")[0].getAttribute("data-section")).toBe(SECTIONS[0].key);
    unmount();
  });

  it("every section open: no Coming soon badge at all", () => {
    const features: string[] = [];
    for (const s of SECTIONS) if (s.feature) features.push(s.feature);
    expect(features.length).toBeGreaterThan(2);
    const { unmount } = renderSections(new Set(features));
    expect(screen.queryByText("Coming soon")).toBeNull();
    unmount();
  });

  it("the landing's soon badge uses the same word as the rail (P5-4)", () => {
    const rail = render(<SoonPill variant="rail" />);
    const railWord = rail.container.textContent;
    rail.unmount();
    // The phone's Explore chip says "Soon" at 11px (owner 2026-10-29, A2-L11);
    // its accessible name still says "coming soon".
    const chip = render(<SoonPill variant="caption" />);
    expect(chip.container.textContent).toBe("Soon");
    chip.unmount();
    const { unmount } = renderSections(new Set());
    expect(screen.getByTestId("landing-soon-shops").textContent).toBe(railWord);
    unmount();
  });

  it("no member-facing 'Opening soon' label anywhere in src/ (one word: Coming soon)", () => {
    const files = trackedFiles("src").filter((f) => /\.(tsx?|mjs)$/.test(f) && !/\.(test|spec)\.|^src\/test\//.test(f));
    expect(files.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    let coming = 0;
    for (const f of files) {
      const code = blankComments(readFileSync(join(ROOT, f), "utf8"));
      if (/Opening soon/.test(code)) offenders.push(f);
      coming += (code.match(/Coming soon/g) ?? []).length;
    }
    expect(offenders).toEqual([]);
    // SoonPill (3 variants), Settings, /search, the landing at least.
    expect(coming).toBeGreaterThan(5);
  });

  it("the closing line is the owner's words", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/landing/SectionsShowcase.tsx"), "utf8"));
    expect(src).toMatch(/>One free account for jobs and Declutter\.<\/p>/);
    expect(src).not.toMatch(/Jobs are open now/);
  });
});
