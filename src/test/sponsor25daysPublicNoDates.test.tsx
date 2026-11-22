/**
 * 25 Days of Louisiana Giveaways, public pages (/25days, /sponsor), owner rules applied 2026-11-19:
 *  - "don't tell sponsors their day until it's final" (2026-11-17): no sponsor's giveaway day is shown anywhere
 *    public; the lineup is an undated list and lineup.days stays internal data (sign-up tile counts only);
 *  - "don't say exactly what the plan is": no public copy spells out how to enter (share/tag/like steps, one entry
 *    per day);
 *  - removed or declined sponsors never show, and the lineup carries business names only, never a person's name,
 *    except the three sponsors the owner chose to show by name (2026-11-19, NAMED_SPONSORS).
 *
 * @mutate src/components/sponsor/Sections.tsx |             {p.prizes.map((prize) => <span key={prize} className="lh25-lineup-prize">{prize}</span>)} |             <span className="lh25-lineup-date">Dec {lineupCount(1)}</span>{p.prizes.map((prize) => <span key={prize} className="lh25-lineup-prize">{prize}</span>)}
 * @mutate src/content/sponsorPage.ts | a Louisiana favorite. Entry details coming soon on our Facebook page. | a Louisiana favorite. To enter: share this post and tag 2 friends.
 * @mutate src/content/sponsorPage.ts |     rulesOnFacebook: "How to enter and the official rules are on our Facebook post.", |     rulesOnFacebook: "Like the post. Limit one entry per person per day.",
 * @mutate src/content/sponsorPage.ts |           { brand: "David Rabalais", prize: "Toy Magnalite pot" }, |           { brand: "Mary Kay · Crystal Fakier", prize: "Toy Magnalite pot" },
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { About, BrandGets, BusinessAsk, EntrantHero, Faq, FinalCta, Hero, HowItWorks, Lineup, PreviewCard, WhatWeAsk } from "@/components/sponsor/Sections";
import { blankComments } from "./helpers/blankNonCode";

function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

const ENTRY_STEPS = /share this post|tag (2|two) friends|tag 2\b|one entry per (day|person per day)|like and follow|to enter:/i;
const REMOVED = ["Peigneur", "Victoria Nicole", "GlassWorks", "Minky", "Alice Lane", "Floral Cottage", "Blackstone"];
/** People behind sponsor businesses (the tracker's contact names that once reached the page, or could). */
const PEOPLE = ["Holli", "Crystal Fakier", "Brandi", "Lexi"];
/** Owner 2026-11-19: the only sponsors shown by a person's name (exact card names; scripts/check-25days-lineup.mjs PUBLIC_NAMES). */
const NAMED_SPONSORS = ["David Rabalais", "Tevin Lewis, District 2 Alderman", "Haylie Rudisill · Custom wreath sashes"];

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
    // The three owner-named sponsors show exactly as chosen; Tevin's name links to his own page (owner 2026-11-19).
    const brands = new Set<string>(sponsorPage.lineup.days.flatMap((d) => d.partners.map((p): string => p.brand)));
    expect(NAMED_SPONSORS.filter((n) => !brands.has(n))).toEqual([]);
    expect((sponsorPage.lineup.links as Record<string, string>)["Tevin Lewis, District 2 Alderman"]).toBe("https://www.facebook.com/profile.php?id=61562244154656");
    for (const b of brands) expect(b, b).not.toMatch(/Rabalais \(|Rudisill \(|^District 2 Alderman$|^The Fois$|^Custom wreath sashes$/);
  });
});

/**
 * Owner 2026-11-19: "Show the full sponsor list on the website. You can keep the page but most people will see it from
 * Facebook traffic." /25days is for people entering; the brand pitch, sign-up form and sign-up deadline are /sponsor's.
 * Owner 2026-11-21: "All the rules will be on Facebook not our website." The official rules (and their old pins here:
 * Louisiana Helpr, 18+, "One entry covers all 25 days", one win, 48 hours) left the site; /25days says in one line that
 * they are on our Facebook post (src/test/twentyFiveDaysRulesOnFacebook.test.tsx).
 *
 * @mutate src/pages/sponsor/SponsorPage.tsx |             <BusinessAsk />\n |             <BusinessAsk />\n            <ClaimSection state={state} greetingBrand={null} refCode={refCode} onSubmit={(p, logo) => backend.submit(p, logo)} />\n
 */
describe("/25days is the page for people entering; the rules are on Facebook", () => {
  const ROOT = path.resolve(__dirname, "../..");

  it("the /25days branch renders only entrant sections: no brand pitch, sign-up form, deadline or rules", () => {
    const src = blankComments(fs.readFileSync(path.join(ROOT, "src/pages/sponsor/SponsorPage.tsx"), "utf8"));
    const start = src.indexOf('if (pathname === "/25days") {');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, src.indexOf("\n  }\n", start));
    for (const want of ["<EntrantHero enterUrl={enterUrl} />", "<Lineup />", "<BusinessAsk />", "<Head25days />"]) expect(block, want).toContain(want);
    for (const brandOnly of ["<ClaimSection", "<Hero ", "<BrandGets", "<HowItWorks", "<WhatWeAsk", "<PreviewCard", "<Reach", "<Faq", "<FinalCta", "<TrustStrip"]) {
      expect(block, brandOnly).not.toContain(brandOnly);
    }
    const { container } = render(
      <MemoryRouter>
        <EntrantHero enterUrl="https://www.facebook.com/louisianahelpr" />
        <Lineup />
        <BusinessAsk />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(1000);
    expect(text).not.toMatch(/sign up by|nov(ember)? 22/i);
    expect(text).not.toMatch(ENTRY_STEPS);
    expect(text).toContain("How to enter and the official rules are on our Facebook post.");
    expect(text).not.toContain("Each person can win once.");
    expect(container.querySelector("[data-testid='business-ask'] a")?.getAttribute("href")).toBe("/sponsor");
    expect(container.querySelector("[data-testid='giveaway-enter']")?.getAttribute("href")).toBe("https://www.facebook.com/louisianahelpr");
    // The full sponsor list (owner 2026-11-19): every brand on the tracker's calendar, once.
    expect(container.querySelectorAll("[data-testid='lineup-partner']").length).toBeGreaterThan(100);
  });
});
