// @mutate src/content/sponsorPage.ts |           { brand: "Megan Benoit's Closet", prize: "$30 gift card" }, |           { brand: "Megan Benoit's Closet REMOVED", prize: "$30 gift card" },
// @mutate src/content/sponsorPage.ts |     winners: "{n} winners", |     winners: "",
// @mutate src/components/sponsor/Sections.tsx |               {d.partners.length > 1 ? ( |               {d.partners.length > 9 ? (
// @mutate src/components/sponsor/ClaimSection.tsx |   return Math.max(state.dayCounts[day] ?? 0, lineupCount(day)); |   return state.dayCounts[day] ?? 0;
// @mutate src/content/sponsorPage.ts | Brands share days, and every partner is featured and tagged on our socials. | More than one brand can share a day, and every sponsor gets their own spotlight post.
// @mutate src/content/sponsorPage.ts | like and follow Louisiana Helpr | like this post
// @mutate src/components/sponsor/ClaimSection.tsx | {C.claim.daysNote} | {null}
// @mutate src/components/sponsor/Sections.tsx | {C.lineup.daysNote} | {null}
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

/**
 * The owner's lineup, day -> brands, exactly her 25 Days Sponsor Tracker's calendar (const D) as of 2026-11-17
 * 11:20 PM: 109 giveaways (owner rule 2026-11-18: nothing stale anywhere). Drift check against the tracker
 * itself: `node scripts/check-25days-lineup.mjs` (manual; the tracker lives on the owner's Desktop, not in CI).
 */
const FINAL: Record<number, string[]> = {
  1: ["homerunPET", "RYSE", "CMI Entertainment: A Christmas Carol", "Oil Center (Lafayette Festival of Lights)", "Faith & Fire BBQ"],
  2: ["Boston Mints", "RYSE", "World Ballet Company: The Nutcracker", "David Rabalais (The Fois)", "Cher Bebe Embroidery"],
  3: ["Tevin Lewis, District 2 Alderman", "RYSE", "Manta Sleep", "Crabtrap Functional Fitness", "RoseMae Eimear Creations"],
  4: ["K18 Hair", "RYSE", "Megan Benoit's Closet", "Kate McLeod", "Britt Creates"],
  5: ["Oyu Botanica", "RYSE", "R&R Wedding Co.", "Breads and Sweets by Babs"],
  6: ["IOKA Skin+Science", "RYSE", "Mystic Forests Nursery", "Rusty's Seasoning"],
  7: ["Whimsies from Within", "RYSE", "Rock Bottom Golf", "Ripley's Crawfish"],
  8: ["RYSE", "Written on the River", "Timeless Skin Care", "David Rabalais (The Fois)"],
  9: ["Peigneur Property Rentals", "RYSE", "Let's Create LLC", "David Rabalais (The Fois)"],
  10: ["GentleStyle Brush (CLM Creations)", "RYSE", "Handmade By Hayli", "Bake & Brush"],
  11: ["Boston Mints", "RYSE", "IDRA Wellness", "Victoria Nicole Fine Art Portraits"],
  12: ["Oyu Botanica", "RYSE", "Summar T. Photography", "RoseMae Eimear Creations", "Rip Van Winkle Gardens"],
  13: ["SRI Labs", "RYSE", "Hello Darlin'", "Kee's Pretty Little Things"],
  14: ["The Sculpt Society", "Crew Dog", "Aeva Beauty", "The Humble Home Decor & Candles"],
  15: ["RYSE", "Britt Creates", "Zydeco Chop Chop", "Proof & Pour Wax Co."],
  16: ["SRI Labs", "RYSE", "3 Redneck Tenors", "Haylie Rudisill (custom wreath sashes)"],
  17: ["Cajun Belle Studio", "LMNT", "Bayou Grace Outfitters", "Dolly's Boutique"],
  18: ["Boston Mints", "RYSE", "HOTWORX Baton Rouge (Millerville)", "Basic Bee"],
  19: ["Ty's Boutique Shop", "RYSE", "Hannahbelle Photography", "Tushbaby"],
  20: ["RYSE", "Cher Bebe Embroidery", "Dupuy's Abbeville", "Salty Cat", "Rip Van Winkle Gardens"],
  21: ["The Soft Life Collective", "RYSE", "Bourque's Cajun Country Seasoning", "Rusty's Seasoning"],
  22: ["LMNT", "RYSE", "Krazy Bull Kreations", "Bashi", "Handmade By Hayli"],
  23: ["Tiffany Morton Cosmetic Tattooing", "Faith & Fire BBQ", "Bashi", "Mary Kay", "IDRA Wellness"],
  24: ["LMNT", "Hilma", "Playtopia Lafayette", "Bashi", "K18 Hair"],
  25: ["Louisiana Helpr", "Grand Kyiv Ballet: Swan Lake (Symphony of Lights)", "Proof & Pour Wax Co.", "Bashi"],
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
    // 109 giveaways, and no brand twice on one day (each partner's row is keyed by its brand).
    expect(days.reduce((n, d) => n + d.partners.length, 0)).toBe(109);
    for (const d of days) expect(new Set(d.partners.map((p) => p.brand)).size, `Dec ${d.day}`).toBe(d.partners.length);
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
    expect(tileCount(NO_DB, 4)).toBe(5);
    expect(tileCount(NO_DB, 25)).toBe(4);
    expect(tileCount(NO_DB, 24)).toBe(5);
    expect(tileCount(NO_DB, 14)).toBe(4);
    expect(tileCount(NO_DB, 8)).toBe(4);
    expect(tileCount(NO_DB, 12)).toBe(5);
    expect(tileCount(NO_DB, 1)).toBe(5);
    expect(tileCount(NO_DB, 3)).toBe(5);
    expect(tileCount(NO_DB, 5)).toBe(4);
    expect(tileCount(NO_DB, 10)).toBe(4);
    expect(tileCount({ dayCounts: { 2: 7 } }, 2)).toBe(7);
    render(<ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} nowMs={Date.UTC(2026, 10, 16)} />);
    const day4 = screen.getByRole("button", { name: /^December 4,/ });
    expect(day4.textContent).toContain("5 brands joined");
    expect(screen.getByRole("button", { name: /^December 17,/ }).textContent).toContain("4 brands joined");
  });
});

describe("owner 2026-11-17: entry rules and the days-may-change note", () => {
  const NOTE = "Days may still change as the calendar fills up. We'll confirm each brand's final day before December 1.";

  it("the sample post's entry rules are the owner's", () => {
    render(<MemoryRouter><PreviewCard /></MemoryRouter>);
    expect(document.body.textContent).toContain(
      "To enter: share this post, like and follow Louisiana Helpr and today's sponsor pages, and tag 2 friends in the comments.",
    );
    expect(document.body.textContent).not.toMatch(/favorite holiday tradition/);
  });

  it("the note shows under the lineup intro, by the day picker, and in the days FAQ", () => {
    render(
      <MemoryRouter>
        <Lineup />
        <ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} nowMs={Date.UTC(2026, 10, 16)} />
        <Faq />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("lineup-days-note").textContent).toBe(NOTE);
    expect(screen.getByTestId("claim-days-note").textContent).toBe(NOTE);
    expect(sponsorPage.faq.items.find((i) => i.q === "Can I sponsor more than one day?")?.a).toContain(NOTE);
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
