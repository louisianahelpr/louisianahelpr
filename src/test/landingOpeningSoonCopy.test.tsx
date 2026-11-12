/**
 * THE LANDING SAYS WHAT IS OPEN TODAY (owner answers 2026-10-21, via the lead):
 *   - the hero subhead is exactly "Hire help, find work, or buy and sell. One account, real
 *     neighbors." (owner pop-up 2026-11-09, 10:40 PM; before that 2026-10-23, when ID verification was turned
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
 * @mutate src/components/landing/HeroSection.tsx | Hire help, find work, or buy and sell. One account | Hire help or find work. Sell or find a deal. Shop local or open a shop. Find a place or list one. One account
 * @mutate src/components/landing/SectionsShowcase.tsx |           {badged && (\n            <span | {false && (\n            <span
 * @mutate src/components/landing/SectionsShowcase.tsx | ...(badged ? { opacity: 0.8 } : null) | ...(false ? { opacity: 0.8 } : null)
 * @mutate src/components/landing/SectionsShowcase.tsx |         {!soon && (\n          <Link |         {true && (\n          <Link
 * @mutate src/components/landing/SectionsShowcase.tsx | One free account for jobs and Declutter. | One free account. Jobs are open now.
 *
 * ONE WORD for a closed section (audit 2026-10-28 P5-4): the landing said
 * "Opening soon" while the rail and the Explore chips (SoonPill "rail" and
 * "caption") say "Coming soon". The landing badge uses the rail's word, read
 * from the rendered SoonPill so the two cannot drift apart.
 * @mutate src/components/landing/SectionsShowcase.tsx |               {w("landing.comingSoon", "Coming soon")}\n |               {w("landing.comingSoon", "Opening soon")}\n
 *
 * And everywhere else a member sees it (lead, 2026-10-28): SoonPill's "full"
 * pill (Create sheet, Settings, Customize), Settings' section line and /search's
 * closed-section row said "Opening soon". Every tracked source file under src/
 * (tests excepted, comments blanked) is scanned: the label "Opening soon" is
 * gone. The owner's sentence form ("Homes is opening soon", openingSoonLine,
 * youBoard18) is a sentence, not the label, and is not matched.
 * @mutate src/lib/i18n/enCore.ts |   "soon.full": "Coming soon", |   "soon.full": "Opening soon",
 * @mutate src/pages/search/SearchPage.tsx | ? "is" : "are"} coming soon.`; | ? "is" : "are"} Opening soon.`;
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
import { LANDING_CARD_KEYS, SectionsShowcase, onTheWayLine } from "@/components/landing/SectionsShowcase";
import { SECTIONS } from "@/components/sections/sectionsConfig";
import { SoonPill } from "@/components/sections/SoonPill";

const ROOT = resolve(__dirname, "..", "..");
const SUBHEAD = "Hire help, find work, or buy and sell. One account, real neighbors.";

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
  // Declutter card while the answer loaded, then jumped. While pending there is NO Coming soon badge; links still fail
  // closed (only Jobs, which has no switch).
  // D005 (landing design audit 11-10) + the owner's preview tweak 3: "Four ways" was 1,245px tall at 375, ~465px of it
  // two Coming soon cards. The cards are the open pair (LANDING_CARD_KEYS: Jobs, Declutter), and the sections still on
  // the way are ONE line: "Shops and Homes are on the way."
  // @mutate src/components/landing/SectionsShowcase.tsx |     const badged = soon && !pending; |     const badged = soon;
  // @mutate src/components/landing/SectionsShowcase.tsx |   const pending = open === null; |   const pending = false;
  // @mutate src/components/landing/SectionsShowcase.tsx | export const LANDING_CARD_KEYS: readonly SectionKey[] = ["jobs", "declutter"]; | export const LANDING_CARD_KEYS: readonly SectionKey[] = ["jobs", "declutter", "shops", "rentals"];
  // @mutate src/components/landing/SectionsShowcase.tsx |         {later.length > 0 && ( |         {false && (
  it("while pending: no Coming soon badge yet, no card dimmed, two cards in one row, only Jobs links (fails closed)", () => {
    const { container, unmount } = renderSections(null);
    const cards = [...container.querySelectorAll<HTMLElement>("[data-section]")];
    // Inventory floor: the open pair from sectionsConfig has a card each.
    expect(cards.map((c) => c.dataset.section)).toEqual([...LANDING_CARD_KEYS]);
    expect(cards.length).toBeGreaterThan(1);
    expect(screen.queryByText("Coming soon")).toBeNull();
    for (const c of cards) expect(c.style.opacity, c.dataset.section).toBe("");
    // Jobs keeps its link to the public board; no switched card has one until the answer is in.
    const jobs = container.querySelector('[data-section="jobs"]') as HTMLElement;
    expect(within(jobs).getByRole("link", { name: /Browse jobs/ }).getAttribute("href")).toBe("/browse");
    expect(container.querySelector('[data-section="declutter"] a')).toBeNull();
    // The rest are one line, never a card each.
    expect(screen.getByTestId("landing-sections-later").textContent).toBe("Shops and Homes are on the way.");
    unmount();
  });

  it("settled with nothing open: Declutter's card is badged and dimmed with no link; Shops and Homes are the one line", () => {
    const { container, unmount } = renderSections(new Set());
    const cards = [...container.querySelectorAll<HTMLElement>("[data-section]")];
    expect(cards.map((c) => c.dataset.section)).toEqual([...LANDING_CARD_KEYS]);
    const declutter = container.querySelector('[data-section="declutter"]') as HTMLElement;
    expect(declutter.dataset.soon).toBe("true");
    expect(within(declutter).getAllByText("Coming soon")).toHaveLength(1);
    expect(declutter.style.opacity).toBe("0.8");
    expect(within(declutter).queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
    for (const s of SECTIONS.filter((x) => !LANDING_CARD_KEYS.includes(x.key))) {
      expect(container.querySelector(`[data-section="${s.key}"]`), s.key).toBeNull();
    }
    expect(screen.getByTestId("landing-sections-later").textContent).toBe("Shops and Homes are on the way.");
    unmount();
  });

  it("a section that opens loses its badge and gains its link; an opened Shops leaves the line", () => {
    const { container, unmount } = renderSections(new Set(["declutter"]));
    const declutter = container.querySelector('[data-section="declutter"]') as HTMLElement;
    expect(within(declutter).queryByText("Coming soon")).toBeNull();
    expect(declutter.style.opacity).toBe("");
    expect(declutter.querySelector("a")).not.toBeNull();
    expect(screen.queryByText("Coming soon")).toBeNull();
    unmount();
    const r = renderSections(new Set(["declutter", "shops"]));
    expect(screen.getByTestId("landing-sections-later").textContent).toBe("Homes is on the way.");
    r.unmount();
    const all = renderSections(new Set(["declutter", "shops", "rentals"]));
    expect(screen.queryByTestId("landing-sections-later")).toBeNull();
    all.unmount();
    expect(onTheWayLine(["Shops", "Homes"])).toBe("Shops and Homes are on the way.");
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
    expect(screen.getByTestId("landing-soon-declutter").textContent).toBe(railWord);
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
    // F260q: the English sits in w("landing.joinSub", ...); Spanish comes from the dictionary.
    expect(src).toMatch(/>\{w\("landing\.joinSub", "One free account for jobs and Declutter\."\)\}<\/p>/);
    expect(src).not.toMatch(/Jobs are open now/);
  });
});
