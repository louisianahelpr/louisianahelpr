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
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { About, BrandGets, Faq, FinalCta, Hero, HowItWorks, Lineup, PreviewCard, WhatWeAsk } from "@/components/sponsor/Sections";

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
