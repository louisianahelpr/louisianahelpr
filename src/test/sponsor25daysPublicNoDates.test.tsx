/**
 * 25 Days of Louisiana Giveaways, public pages (/25days, /sponsor), owner rules applied 2026-11-19:
 *  - "don't tell sponsors their day until it's final" (2026-11-17): no sponsor's giveaway day is shown anywhere
 *    public; the lineup is an undated list and lineup.days stays internal data (sign-up tile counts only);
 *  - "don't say exactly what the plan is": no public copy spells out how to enter (share/tag/like steps, one entry
 *    per day);
 *  - removed or declined sponsors never show, and the lineup carries business names only, never a person's name.
 *
 * @mutate src/components/sponsor/Sections.tsx |             {p.prizes.map((prize) => <span key={prize} className="lh25-lineup-prize">{prize}</span>)} |             <span className="lh25-lineup-date">Dec {lineupCount(1)}</span>{p.prizes.map((prize) => <span key={prize} className="lh25-lineup-prize">{prize}</span>)}
 * @mutate src/content/sponsorPage.ts | a Louisiana favorite. Entry details coming soon on our Facebook page. | a Louisiana favorite. To enter: share this post and tag 2 friends.
 * @mutate src/content/sponsorPage.ts |         body: "Follow the steps in the official entry post on the Louisiana Helpr Facebook page. Automated or bulk entries are void.", |         body: "Like the post. Limit one entry per person per day.",
 * @mutate src/content/sponsorPage.ts |           { brand: "The Fois", prize: "Toy Magnalite pot" }, |           { brand: "David Rabalais (The Fois)", prize: "Toy Magnalite pot" },
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { About, BrandGets, BusinessAsk, EntrantHero, EntrantInfo, Faq, FinalCta, Hero, HowItWorks, Lineup, PreviewCard, WhatWeAsk } from "@/components/sponsor/Sections";
import { blankComments } from "./helpers/blankNonCode";

function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

const ENTRY_STEPS = /share this post|tag (2|two) friends|tag 2\b|one entry per (day|person per day)|like and follow|to enter:/i;
const REMOVED = ["Peigneur", "Victoria Nicole", "GlassWorks", "Minky", "Alice Lane", "Floral Cottage", "Blackstone"];
/** People behind sponsor businesses (the tracker's contact names that once reached the page). */
const PEOPLE = ["David Rabalais", "Tevin Lewis", "Haylie Rudisill", "Holli", "Crystal Fakier", "Lexi"];

describe("25 Days public pages: no sponsor day, no entry steps, no removed sponsor, no person's name", () => {
  it("the lineup shows no date or weekday for any sponsor", () => {
    const { container } = render(<MemoryRouter><Lineup /></MemoryRouter>);
    const cards = [...container.querySelectorAll("[data-testid='lineup-partner']")];
    expect(cards.length).toBeGreaterThan(50);
    expect(container.querySelector(".lh25-lineup-date")).toBeNull();
    // Each card's text minus its prizes (a prize may name an event date, e.g. a show on Dec 6) is the brand only.
    for (const card of cards) {
      const brand = card.querySelector(".lh25-lineup-brand")?.textContent ?? "";
      const prizes = [...card.querySelectorAll(".lh25-lineup-prize")].map((p) => p.textContent ?? "").join("");
      expect(card.textContent, brand).toBe(brand + prizes);
    }
    // Outside the cards, nothing names a December day or a weekday.
    const outside = (container.textContent ?? "").replace(cards.map((c) => c.textContent).join(""), "");
    expect(outside).not.toMatch(/\bDec(ember)?\.?\s+\d|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
    for (const c of cards) expect(c.textContent).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*·/);
  });

  it("no public string or rendered section spells out how to enter", () => {
    const strings = allStrings(sponsorPage);
    expect(strings.length).toBeGreaterThan(150);
    expect(strings.filter((s) => ENTRY_STEPS.test(s))).toEqual([]);
    const { container } = render(
      <MemoryRouter>
        <Hero greetingBrand={null} />
        <About />
        <HowItWorks />
        <Lineup />
        <BrandGets />
        <WhatWeAsk />
        <PreviewCard />
        <Faq />
        <FinalCta />
      </MemoryRouter>,
    );
    expect((container.textContent ?? "").length).toBeGreaterThan(2000);
    expect(container.textContent).not.toMatch(ENTRY_STEPS);
  });

  it("removed and declined sponsors never appear, and the lineup names businesses, not people", () => {
    const text = JSON.stringify(sponsorPage.lineup);
    expect(REMOVED.filter((n) => text.includes(n))).toEqual([]);
    expect(PEOPLE.filter((n) => text.includes(n))).toEqual([]);
  });
});

/**
 * Owner 2026-11-19: "Show the full sponsor list on the website. You can keep the page but most people will see it from
 * Facebook traffic." /25days is for people entering; the brand pitch, sign-up form and sign-up deadline are /sponsor's.
 * Official rules: "Legal name: Louisiana Helpr"; "They can win once".
 *
 * @mutate src/pages/sponsor/SponsorPage.tsx |             <BusinessAsk />\n |             <BusinessAsk />\n            <ClaimSection state={state} greetingBrand={null} refCode={refCode} onSubmit={(p, logo) => backend.submit(p, logo)} />\n
 * @mutate src/content/sponsorPage.ts | One win per person across the whole giveaway: once you win a prize, you are not eligible to win another. | Winners may win more than once.
 * @mutate src/content/sponsorPage.ts | A winner must claim the prize within 48 hours of notification | A winner must claim the prize within 7 days of notification
 * @mutate src/content/sponsorPage.ts |     approved: true, |     approved: false,
 */
describe("/25days is the page for people entering; the official rules are final", () => {
  const ROOT = path.resolve(__dirname, "../..");

  it("the /25days branch renders only entrant sections: no brand pitch, sign-up form or deadline", () => {
    const src = blankComments(fs.readFileSync(path.join(ROOT, "src/pages/sponsor/SponsorPage.tsx"), "utf8"));
    const start = src.indexOf('if (pathname === "/25days") {');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, src.indexOf("\n  }\n", start));
    for (const want of ["<EntrantHero enterUrl={enterUrl} />", "<EntrantInfo />", "<Lineup />", "<BusinessAsk />", "<Head25days />"]) expect(block, want).toContain(want);
    for (const brandOnly of ["<ClaimSection", "<Hero ", "<BrandGets", "<HowItWorks", "<WhatWeAsk", "<PreviewCard", "<Reach", "<Faq", "<FinalCta", "<TrustStrip"]) {
      expect(block, brandOnly).not.toContain(brandOnly);
    }
    const { container } = render(
      <MemoryRouter>
        <EntrantHero enterUrl="https://www.facebook.com/louisianahelpr" />
        <EntrantInfo />
        <Lineup />
        <BusinessAsk />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(1000);
    expect(text).not.toMatch(/sign up by|nov(ember)? 22/i);
    expect(text).not.toMatch(ENTRY_STEPS);
    expect(text).toContain("Each person can win once.");
    expect(container.querySelector("[data-testid='business-ask'] a")?.getAttribute("href")).toBe("/sponsor");
    expect(container.querySelector("[data-testid='giveaway-enter']")?.getAttribute("href")).toBe("https://www.facebook.com/louisianahelpr");
    // The full sponsor list (owner 2026-11-19): every brand on the tracker's calendar, once.
    expect(container.querySelectorAll("[data-testid='lineup-partner']").length).toBeGreaterThan(100);
  });

  it("the official rules: Louisiana Helpr, Louisiana 18+, one entry for all 25 days, one win per person, 48 hours, no placeholder", () => {
    const R = sponsorPage.rules;
    expect(R.approved).toBe(true);
    expect(R.sections.length).toBeGreaterThan(8);
    const all = R.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
    expect(all).not.toMatch(/\[[^\]]*\]/);
    for (const must of [
      "NO PURCHASE NECESSARY",
      "run by Louisiana Helpr",
      "legal residents of Louisiana who are 18 years of age or older",
      "One entry covers all 25 days",
      "One win per person",
      "within 48 hours",
      "a new winner is drawn",
      "Prizes are provided by the participating businesses",
      "in no way sponsored, endorsed or administered by, or associated with, Facebook or Meta",
      "Void where prohibited",
      "as described in the official giveaway post on the Louisiana Helpr Facebook page",
    ]) expect(all, must).toContain(must);
    expect(all).not.toMatch(ENTRY_STEPS);
    // The rules page links back to the entrant page, not the brand page.
    const page = fs.readFileSync(path.join(ROOT, "src/pages/sponsor/SponsorRulesPage.tsx"), "utf8");
    expect(page).toContain('<Link className="lh25-back" to="/25days">');
  });
});
