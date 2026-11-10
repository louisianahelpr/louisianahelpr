/**
 * THE LANDING SAYS WHAT IS OPEN TODAY (owner answers 2026-10-21, via the lead):
 *   - the hero subhead is exactly "Hire help, find work, or buy and sell. One account, real
 *     neighbors." (owner pop-up 2026-11-09, 10:40 PM; before that 2026-10-23, when ID verification was turned
 *     off; it changes again as the other sections open),
 *     and CLAUDE.md's locked-copy rule quotes the same words;
 *   - (until Direction A, owner 11-10, removed the section cards) each unopened section card carried its own small "Coming soon" badge and
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
 * @mutate src/components/landing/SectionsShowcase.tsx | One free account for jobs and Declutter. | One free account. Jobs are open now.
 *
 * ONE WORD for a closed section (audit 2026-10-28 P5-4): the landing said
 * "Opening soon" while the rail and the Explore chips (SoonPill "rail" and
 * "caption") say "Coming soon". The landing badge uses the rail's word, read
 * from the rendered SoonPill so the two cannot drift apart.
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
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";


import HeroSection from "@/components/landing/HeroSection";
import { SoonPill } from "@/components/sections/SoonPill";

const ROOT = resolve(__dirname, "..", "..");
const SUBHEAD = "Hire help, find work, or buy and sell. One account, real neighbors.";

describe("the landing says what is open today", () => {
  it("the hero subhead is the owner's words, and CLAUDE.md locks the same words", () => {
    render(<MemoryRouter><HeroSection /></MemoryRouter>);
    expect(screen.getByText(SUBHEAD)).toBeTruthy();
    const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
    expect(claude).toContain(`subhead "${SUBHEAD}"`);
    // The H1 is untouched (locked).
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Louisiana’s local partner.");
  });

  // The section cards and their Coming soon badges (F009, F002/F013, D005) left with Direction A (owner 11-10): the
  // sections still on the way are one sentence under "Near you this week", from the same fail-closed rule
  // (src/test/landingDirectionA1110.test.tsx). The rail's word stays the app's one word for a closed section:
  it("the rail's soon word, and the phone chip's short form (P5-4)", () => {
    const rail = render(<SoonPill variant="rail" />);
    expect(rail.container.textContent).toBe("Coming soon");
    rail.unmount();
    // The phone's Explore chip says "Soon" at 11px (owner 2026-10-29, A2-L11); its accessible name still says "coming soon".
    const chip = render(<SoonPill variant="caption" />);
    expect(chip.container.textContent).toBe("Soon");
    chip.unmount();
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
    // SoonPill (3 variants), Settings, /search at least.
    expect(coming).toBeGreaterThan(4);
  });

  it("the closing line is the owner's words", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/landing/SectionsShowcase.tsx"), "utf8"));
    expect(src).toMatch(/>One free account for jobs and Declutter\.<\/p>/);
    expect(src).not.toMatch(/Jobs are open now/);
  });
});
