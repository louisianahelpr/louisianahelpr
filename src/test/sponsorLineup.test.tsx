// @mutate src/content/sponsorPage.ts |       { day: 4, partners: [{ brand: "K18 Hair", prize: "FutureIQ + Molecular Repair Hair Mask" }] }, |       { day: 4, partners: [] },
// @mutate src/content/sponsorPage.ts |     winners: "{n} winners", |     winners: "",
// @mutate src/components/sponsor/Sections.tsx |               {d.partners.length > 1 ? ( |               {d.partners.length > 9 ? (
// @mutate src/components/sponsor/ClaimSection.tsx |   return Math.max(state.dayCounts[day] ?? 0, lineupCount(day)); |   return state.dayCounts[day] ?? 0;
// @mutate src/content/sponsorPage.ts | Brands share days, and every partner is featured and tagged on our socials. | More than one brand can share a day, and every sponsor gets their own spotlight post.
// @mutate src/pages/sponsor/SponsorPage.tsx |           <Lineup /> |           {null}
/**
 * 25 Days of Louisiana Giveaways: the final lineup (owner 2026-11-16, "update the page ... you'll need to
 * change like each person will have their own day"; Dec 14 gained The Sculpt Society the same day; 2026-11-15, "We can't really do their own day anymore,
 * so remove that").
 *  - the page shows every December day with its brand or brands, exactly the owner's final lineup
 *    (her 25 Days Sponsor Tracker, const S and D), and a shared day says how many winners it has;
 *  - no visitor-facing copy promises a brand its own day or its own spotlight post;
 *  - the lineup carries brand names and prizes only, never an email or phone number;
 *  - a day the lineup lists never reads "Open" on the sign-up calendar.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { About, BrandGets, Faq, FinalCta, Hero, HowItWorks, Lineup, PreviewCard, WhatWeAsk, lineupWeekday } from "@/components/sponsor/Sections";
import { ClaimSection, tileCount } from "@/components/sponsor/ClaimSection";
import type { SponsorPublicState } from "@/lib/sponsor/types";
import { blankComments } from "./helpers/blankNonCode";

/** The owner's final lineup, day -> brands, as she gave it on 2026-11-16. */
const FINAL: Record<number, string[]> = {
  1: ["homerunPET"], 2: ["Boston Mints"], 3: ["Tevin Lewis, District 2 Alderman"], 4: ["K18 Hair"], 5: ["Oyu Botanica"],
  6: ["IOKA Skin+Science"], 7: ["Whimsies from Within"], 8: ["Candle Bloom Confections"], 9: ["Peigneur Property Rentals"],
  10: ["GentleStyle Brush"], 11: ["Boston Mints"], 12: ["Oyu Botanica"], 13: ["SRI Labs"], 14: ["Aeva Beauty", "The Sculpt Society"],
  15: ["Berkana Crystal"], 16: ["SRI Labs"], 17: ["Cajun Belle Studio", "RYSE", "LMNT"], 18: ["Boston Mints", "RYSE"],
  19: ["Ty's Boutique Shop"], 20: ["Pass the Everything"], 21: ["The Soft Life Collective"], 22: ["RYSE", "LMNT"],
  23: ["Tiffany Morton Cosmetic Tattooing"], 24: ["RYSE", "LMNT", "Hilma"], 25: ["Louisiana Helpr"],
};

const NO_DB: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };

describe("the final lineup", () => {
  it("lists every day 1-25 with exactly the owner's brands, in order (inventory floor)", () => {
    const days = sponsorPage.lineup.days;
    expect(days.length).toBeGreaterThan(24);
    expect(days.map((d) => d.day)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const got = Object.fromEntries(days.map((d) => [d.day, d.partners.map((p) => p.brand)]));
    expect(got).toEqual(FINAL);
    for (const d of days) for (const p of d.partners) expect(p.prize.trim().length, `Dec ${d.day} ${p.brand} prize`).toBeGreaterThan(2);
  });

  it("renders each day's brands and prizes; a shared day says how many winners", () => {
    render(<MemoryRouter><Lineup /></MemoryRouter>);
    for (const [day, brands] of Object.entries(FINAL)) {
      const card = screen.getByTestId(`lineup-day-${day}`);
      const text = card.textContent ?? "";
      expect(text).toContain(`Dec ${day}`);
      for (const b of brands) expect(text).toContain(b);
      if (brands.length > 1) expect(within(card).getByText(`${brands.length} winners`)).toBeTruthy();
      else expect(text).not.toMatch(/winners/);
    }
    // Dec 1 2026 is a Tuesday, Dec 25 a Friday.
    expect(lineupWeekday(1)).toBe("Tue");
    expect(lineupWeekday(25)).toBe("Fri");
  });

  it("the page mounts the lineup", () => {
    const src = blankComments(fs.readFileSync(path.resolve(__dirname, "../pages/sponsor/SponsorPage.tsx"), "utf8"));
    expect(src).toMatch(/<Lineup \/>/);
  });

  it("carries brand names and prizes only: no email address or phone number", () => {
    const text = JSON.stringify(sponsorPage.lineup);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
  });

  it("a day the lineup lists never reads Open on the sign-up calendar, even with no sign-up row", () => {
    expect(tileCount(NO_DB, 4)).toBe(1);
    expect(tileCount(NO_DB, 24)).toBe(3);
    expect(tileCount(NO_DB, 14)).toBe(2);
    expect(tileCount({ dayCounts: { 2: 5 } }, 2)).toBe(5);
    render(<ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} nowMs={Date.UTC(2026, 10, 16)} />);
    const day4 = screen.getByRole("button", { name: /^December 4,/ });
    expect(day4.textContent).toContain("1 brand joined");
    expect(screen.getByRole("button", { name: /^December 17,/ }).textContent).toContain("3 brands joined");
  });
});

describe("no copy promises a brand its own day or its own spotlight (owner 2026-11-15)", () => {
  const PROMISE = /own (spotlight|day)|spotlight post|your spotlight|claim (your|my) day|sponsor a day/i;

  it("the rendered page sections", () => {
    const { container } = render(
      <MemoryRouter>
        <Hero greetingBrand={null} />
        <About />
        <HowItWorks />
        <Lineup />
        <BrandGets />
        <WhatWeAsk />
        <PreviewCard />
        <ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} nowMs={Date.UTC(2026, 10, 16)} />
        <Faq />
        <FinalCta />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(2000);
    expect(text).not.toMatch(PROMISE);
    // The shared-day FAQ is open about it.
    expect(text).toContain("each brand's prize has its own winner");
  });

  it("every string in the content file and the link previews", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(sponsorPage);
    walk([NOINDEX_PAGE_META["/sponsor"], NOINDEX_PAGE_META["/25days"]]);
    expect(strings.length).toBeGreaterThan(150);
    expect(strings.filter((s) => PROMISE.test(s))).toEqual([]);
  });
});
