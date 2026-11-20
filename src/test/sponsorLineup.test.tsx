// @mutate src/components/sponsor/Sections.tsx |   if (p.toLowerCase() === b.toLowerCase()) return ""; |   if (false) return "";
// @mutate src/components/sponsor/Sections.tsx |   if (p.toLowerCase().startsWith(`${b.toLowerCase()} `)) { |   if (false) {
// @mutate src/components/sponsor/Sections.tsx |   const [all, setAll] = useState(false); |   const [all, setAll] = useState(true);
// @mutate src/pages/sponsor/sponsor.css |   .lh25-lineup-day.lh25-lineup-later { display: none; } |   .lh25-lineup-day.lh25-lineup-later { }
// @mutate src/content/sponsorPage.ts |     websiteButton: "Explore the site", |     websiteButton: "Explore louisianahelpr.com",
// @mutate src/content/sponsorPage.ts |     title: "How it works", |     title: "How It Works",
// @mutate src/components/sponsor/ClaimSection.tsx |           <span>{F.agree}</span> |           <span>{F.agree} <span className="lh25-req" aria-hidden="true">*</span></span>
// @mutate src/pages/sponsor/SponsorRulesPage.tsx |           {i < parts.length - 1 ? <a href={`mailto:${email}`}>{email}</a> : null} |           {i < parts.length - 1 ? email : null}
// @mutate src/content/sponsorPage.ts |           { brand: "Megan Benoit's Closet", prize: "$30 gift card" }, |           { brand: "Megan Benoit's Closet REMOVED", prize: "$30 gift card" },
// @mutate src/components/sponsor/ClaimSection.tsx |   return Math.max(state.dayCounts[day] ?? 0, lineupCount(day)); |   return state.dayCounts[day] ?? 0;
// @mutate src/content/sponsorPage.ts | Brands share days, and every partner is featured and tagged on our socials. | More than one brand can share a day, and every sponsor gets their own spotlight post.
// @mutate src/components/sponsor/ClaimSection.tsx | {C.claim.daysNote} | {null}
// @mutate src/pages/sponsor/SponsorPage.tsx | <HowItWorks />\n          <Lineup /> | <HowItWorks />\n          {null}
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
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { NOINDEX_PAGE_META, PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { About, BrandGets, Faq, FinalCta, Hero, HowItWorks, Lineup, PreviewCard, WhatWeAsk, prizeWithoutBrand, publicPartners } from "@/components/sponsor/Sections";
import { WithEmailLink } from "@/pages/sponsor/SponsorRulesPage";
import { ClaimSection, tileCount } from "@/components/sponsor/ClaimSection";
import type { SponsorPublicState } from "@/lib/sponsor/types";
import { blankComments } from "./helpers/blankNonCode";

/**
 * The owner's lineup, day -> brands, exactly her 25 Days Sponsor Tracker's calendar (const D) as of 2026-11-17
 * 11:20 PM: 109 giveaways (owner rule 2026-11-18: nothing stale anywhere). Drift check against the tracker
 * itself: `node scripts/check-25days-lineup.mjs` (manual; the tracker lives on the owner's Desktop, not in CI).
 */
const FINAL: Record<number, string[]> = {
  1: ["homerunPET", "RYSE", "CMI Entertainment: A Christmas Carol", "Oil Center (Lafayette Festival of Lights)", "Faith & Fire BBQ", "FELCO North America", "Le Petit Theatre (New Orleans)"],
  2: ["Boston Mints", "RYSE", "World Ballet Company: The Nutcracker", "David Rabalais", "Cher Bebe Embroidery", "Wicks NOLA Candle Company"],
  3: ["Tevin Lewis, District 2 Alderman", "RYSE", "Crabtrap Functional Fitness", "RoseMae Eimear Creations", "Everyday Dose", "Forgiven Hearts", "Suzi Marques Photography"],
  4: ["K18 Hair", "RYSE", "Megan Benoit's Closet", "Kate McLeod", "Britt Creates", "Tays Sweet Shop", "Jessica Lanham Photography"],
  5: ["Oyu Botanica", "RYSE", "R&R Wedding Co.", "Breads and Sweets by Babs", "Olivia Grace Photography", "Celebration Station (Baton Rouge)", "Jessica Lanham Photography"],
  6: ["IOKA Skin+Science", "RYSE", "Mystic Forests Nursery", "Rusty's Seasoning", "Faulk's Game Call Co.", "Paddlewheeler Creole Queen (New Orleans)", "Jessica Lanham Photography", "Hair Fashion and Spa (Opelousas)"],
  7: ["Whimsies from Within", "RYSE", "Rock Bottom Golf", "Wicks NOLA Candle Company", "Mind the Skin Labs", "Suzi Marques Photography"],
  8: ["RYSE", "Written on the River", "Timeless Skin Care", "David Rabalais", "Tays Sweet Shop", "Candle Bloom Confections", "Active Beauty"],
  9: ["RYSE", "Let's Create LLC", "David Rabalais", "Botanical Nail and Skin Studio", "City Sightseeing New Orleans", "Suzi Marques Photography"],
  10: ["GentleStyle Brush (CLM Creations)", "RYSE", "Handmade By Hayli", "Bake & Brush", "Criquet Shirts", "Everyday Dose", "Suzi Marques Photography"],
  11: ["Boston Mints", "RYSE", "IDRA Wellness", "aosu", "Beaver's Abundance", "AllWays Lounge & Cabaret (New Orleans)", "Ripley's Crawfish", "Suzi Marques Photography"],
  12: ["Oyu Botanica", "RYSE", "Summar T. Photography", "RoseMae Eimear Creations", "Rip Van Winkle Gardens", "Tays Sweet Shop", "Wicks NOLA Candle Company", "Suzi Marques Photography"],
  13: ["SRI Labs", "RYSE", "Hello Darlin'", "Kee's Pretty Little Things", "The Crab Man Plus", "Manta Sleep"],
  14: ["The Sculpt Society", "Crew Dog", "Aeva Beauty", "The Humble Home Decor & Candles", "Deming Delights", "Everyday Dose", "God's Country RV Resort"],
  15: ["RYSE", "Britt Creates", "Zydeco Chop Chop", "Proof & Pour Wax Co.", "Sky & Sol", "Cat Lady / CatLadyBox"],
  16: ["SRI Labs", "RYSE", "3 Redneck Tenors", "Haylie Rudisill · Custom wreath sashes", "Tays Sweet Shop", "Phyllis Guy Dance Center"],
  17: ["Cajun Belle Studio", "LMNT", "Bayou Grace Outfitters", "Dolly's Boutique", "Wicks NOLA Candle Company", "Mind the Skin Labs", "Jessica Lanham Photography"],
  18: ["Boston Mints", "RYSE", "HOTWORX Baton Rouge (Millerville)", "Basic Bee", "Saranoni", "Monarch Books (Baton Rouge)"],
  19: ["Ty's Boutique Shop", "RYSE", "Hannahbelle Photography", "Tushbaby", "aosu", "Everyday Dose", "Bully Made 3D Prints & More"],
  20: ["RYSE", "Cher Bebe Embroidery", "Dupuy's Abbeville", "Salty Cat", "Rip Van Winkle Gardens", "Tays Sweet Shop", "Ripley's Crawfish", "Sprinkle in Time Too (Sulphur)", "Cat 5 Fishing Charters (Lake Charles)"],
  21: ["The Soft Life Collective", "RYSE", "Bourque's Cajun Country Seasoning", "Rusty's Seasoning", "HOTWORX Denham Springs"],
  22: ["LMNT", "RYSE", "Krazy Bull Kreations", "Bashi", "Handmade By Hayli", "Wicks NOLA Candle Company", "Barclell Photography", "Arey", "Ripley's Crawfish"],
  23: ["Tiffany Morton Cosmetic Tattooing", "Faith & Fire BBQ", "Bashi", "Mary Kay", "IDRA Wellness"],
  24: ["LMNT", "Hilma", "Playtopia Lafayette", "Bashi", "K18 Hair", "Tays Sweet Shop", "Ripley's Crawfish", "Tufted Artworks"],
  25: ["Louisiana Helpr", "Grand Kyiv Ballet: Swan Lake (Symphony of Lights)", "Proof & Pour Wax Co.", "Bashi", "Mind the Skin Labs"],
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
    // 176 giveaways (owner 2026-11-19: show the full sponsor list; the tracker's calendar as of 2026-11-20 6:45 PM), and no brand twice on one day (each partner's row is keyed by its brand).
    expect(days.reduce((n, d) => n + d.partners.length, 0)).toBe(176);
    for (const d of days) expect(new Set(d.partners.map((p) => p.brand)).size, `Dec ${d.day}`).toBe(d.partners.length);
  });

  it("renders every brand once, A to Z, with its prizes and no day (owner rule 2026-11-17)", () => {
    render(<MemoryRouter><Lineup /></MemoryRouter>);
    const cards = screen.getAllByTestId("lineup-partner");
    const brands = [...new Set(Object.values(FINAL).flat())];
    expect(cards.length).toBeGreaterThan(50);
    expect(cards.length).toBe(brands.length);
    const shown = cards.map((c) => c.querySelector(".lh25-lineup-brand")?.textContent ?? "");
    expect([...shown].sort()).toEqual([...brands].sort());
    expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(screen.queryByText(/^\d+ winners$/)).toBeNull();
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
    expect(tileCount(NO_DB, 4)).toBe(7);
    expect(tileCount(NO_DB, 25)).toBe(5);
    expect(tileCount(NO_DB, 24)).toBe(8);
    expect(tileCount(NO_DB, 14)).toBe(7);
    expect(tileCount(NO_DB, 8)).toBe(7);
    expect(tileCount(NO_DB, 12)).toBe(8);
    expect(tileCount(NO_DB, 1)).toBe(7);
    expect(tileCount(NO_DB, 3)).toBe(7);
    expect(tileCount(NO_DB, 5)).toBe(7);
    expect(tileCount(NO_DB, 10)).toBe(7);
    expect(tileCount({ dayCounts: { 2: 7 } }, 2)).toBe(7);
    render(<ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    const day4 = screen.getByRole("button", { name: /^December 4,/ });
    expect(day4.textContent).toContain("7 brands joined");
    expect(screen.getByRole("button", { name: /^December 17,/ }).textContent).toContain("7 brands joined");
  });
});

describe("owner 2026-11-17: entry rules and the days-may-change note", () => {
  const NOTE = "Days may still change as the calendar fills up. We'll confirm each brand's final day before December 1.";

  it("the sample post says no entry method (owner 2026-11-19: don't say exactly what the plan is)", () => {
    render(<MemoryRouter><PreviewCard /></MemoryRouter>);
    expect(document.body.textContent).toContain("Entry details coming soon on our Facebook page.");
    expect(document.body.textContent).not.toMatch(/to enter:|share this post|tag 2/i);
    expect(document.body.textContent).not.toMatch(/favorite holiday tradition/);
  });

  it("the note shows by the day picker and in the days FAQ (the public lineup is undated)", () => {
    render(
      <MemoryRouter>
        <Lineup />
        <ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />
        <Faq />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("lineup-days-note")).toBeNull();
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
        <ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />
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
    walk([NOINDEX_PAGE_META["/sponsor"], PUBLIC_PAGE_META["/25days"]]);
    expect(strings.length).toBeGreaterThan(150);
    expect(strings.filter((s) => PROMISE.test(s))).toEqual([]);
  });
});

describe("lineup polish (design audit r2 #18, #19; display only, the owner's data is untouched)", () => {
  const CSS = fs.readFileSync(path.resolve(__dirname, "../pages/sponsor/sponsor.css"), "utf8");

  it("a brand on several days is one card listing each distinct prize once", () => {
    const days = [1, 2, 3].map((day) => ({ day, partners: [{ brand: "B", prize: day < 3 ? "Mug" : "Hat" }, { brand: "a", prize: "Pen" }] }));
    expect(publicPartners(days as unknown as typeof sponsorPage.lineup.days)).toEqual([
      { brand: "a", prizes: ["Pen"], page: null },
      { brand: "B", prizes: ["Mug", "Hat"], page: null },
    ]);
  });

  it("a prize never repeats its brand: a leading brand name is dropped, a prize that is only the brand is hidden", () => {
    expect(prizeWithoutBrand("GentleStyle", "GentleStyle Brush")).toBe("Brush");
    expect(prizeWithoutBrand("GentleStyle Brush", "GentleStyle Brush")).toBe("");
    expect(prizeWithoutBrand("Bashi", "Bashi - gift set")).toBe("Gift set");
    expect(prizeWithoutBrand("RYSE", "A 12-pack of RYSE Fuel ($30)")).toBe("A 12-pack of RYSE Fuel ($30)");
    render(<MemoryRouter><Lineup /></MemoryRouter>);
    let checked = 0;
    for (const li of screen.getAllByTestId("lineup-partner")) {
      const brand = li.querySelector(".lh25-lineup-brand")?.textContent ?? "";
      for (const el of li.querySelectorAll(".lh25-lineup-prize")) {
        const prize = el.textContent ?? "";
        expect(prize.toLowerCase().startsWith(`${brand.toLowerCase()} `), brand).toBe(false);
        expect(prize.toLowerCase() === brand.toLowerCase(), brand).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("on a phone only the first 12 partners show at first; one button shows the rest", () => {
    render(<MemoryRouter><Lineup /></MemoryRouter>);
    const cards = () => screen.getAllByTestId("lineup-partner");
    const later = () => cards().filter((c) => c.classList.contains("lh25-lineup-later")).length;
    expect(cards().length).toBeGreaterThan(12);
    expect(later()).toBe(cards().length - 12);
    fireEvent.click(screen.getByRole("button", { name: `Show all ${cards().length} partners` }));
    expect(later()).toBe(0);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
    // The hiding is phone-only CSS: under 640px a later card is hidden; from 640px the button is.
    expect(CSS).toMatch(/@media \(max-width: 639\.98px\) \{\s*\.lh25-lineup-day\.lh25-lineup-later \{ display: none; \}/);
    expect(CSS).toMatch(/@media \(min-width: 640px\) \{(?:[^{}]*\{[^{}]*\})*?\s*\.lh25-lineup-more-row \{ display: none; \}/);
  });

  it("each business name links to its Facebook Page in a new tab; no contact details", () => {
    render(<MemoryRouter><Lineup /></MemoryRouter>);
    const links = screen.getAllByTestId("lineup-partner").map((c) => c.querySelector("a.lh25-lineup-brand")).filter((a): a is HTMLAnchorElement => !!a);
    expect(links.length).toBeGreaterThan(30);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^https:\/\/(www\.)?facebook\.com\//);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
    // Every link key is a brand that is on the page (no stale link).
    const brands = new Set(Object.values(FINAL).flat());
    expect(Object.keys(sponsorPage.lineup.links).filter((b) => !brands.has(b))).toEqual([]);
  });
});

describe("25 Days copy polish (design audit r2 #25, #26; area 01 #4, #14)", () => {
  it("the site button says Explore the site", () => {
    expect(sponsorPage.about.websiteButton).toBe("Explore the site");
    render(<MemoryRouter><About /></MemoryRouter>);
    expect(screen.getByText("Explore the site")).toBeTruthy();
  });

  it("section headings are sentence case (only the first word and proper names capitalised)", () => {
    const C = sponsorPage;
    const headings = [C.howItWorks.title, C.brandGets.title, C.whatWeAsk.title, C.reach.title, C.preview.title, C.lineup.title, C.testimonials.title, C.claim.title, C.faq.title, C.rules.title, C.hero.headlineLead];
    expect(headings.length).toBeGreaterThan(10);
    const PROPER = new Set(["Louisiana", "Helpr", "I'm", "Lexi!"]);
    for (const h of headings) {
      const words = h.replace(/^[^A-Za-z]+/, "").split(/\s+/).slice(1);
      for (const w of words) {
        const after = h.includes("? ") && h.split("? ")[1].startsWith(w);
        if (PROPER.has(w) || after || !/^[A-Z]/.test(w)) continue;
        throw new Error(`"${h}": "${w}" should be lower case`);
      }
    }
  });

  it("the agree box has no lone required star", () => {
    const NO_DB2: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };
    const { container } = render(<ClaimSection state={NO_DB2} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    const agree = container.querySelector("#lh25-agree")?.closest("label");
    expect(agree).not.toBeNull();
    expect(agree?.textContent).not.toContain("*");
  });

  it("the rules page's contact email is a mailto: link", () => {
    const { container } = render(<WithEmailLink text={sponsorPage.rules.pendingNote} />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe(`mailto:${sponsorPage.links.email}`);
    expect(container.textContent).toBe(sponsorPage.rules.pendingNote);
  });
});
