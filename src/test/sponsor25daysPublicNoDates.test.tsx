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
 * @mutate src/content/sponsorPage.ts |         body: "Enter as described in the official giveaway post on the Louisiana Helpr Facebook page. Limit one entry per person. Entries from more than one account or profile by the same person are void, and so are automated or bulk entries.", |         body: "Like the post. Limit one entry per person per day.",
 * @mutate src/content/sponsorPage.ts | may only be claimed by a winner who is 21 years of age or older, who must show valid photo ID | may be claimed by any winner
 * @mutate src/content/sponsorPage.ts |         body: "Apple is not a sponsor of this giveaway and is not involved in any way.", |         body: "Questions about the app go to Apple.",
 * @mutate src/content/sponsorPage.ts | To claim a prize, a winner must message the Louisiana Helpr Facebook page within 48 hours of the winner post | Winners are messaged on Facebook and must reply within 48 hours
 * @mutate src/content/sponsorPage.ts | The odds of winning depend on the number of eligible entries received. | Everyone has a great chance.
 * @mutate src/components/sponsor/Sections.tsx |       const prize = withAlcoholNote(prizeWithoutBrand(p.brand, p.prize)); |       const prize = prizeWithoutBrand(p.brand, p.prize);
 * @mutate src/content/sponsorPage.ts |           { brand: "David Rabalais", prize: "Toy Magnalite pot" }, |           { brand: "Mary Kay · Crystal Fakier", prize: "Toy Magnalite pot" },
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { About, BrandGets, BusinessAsk, EntrantHero, EntrantInfo, Faq, FinalCta, Hero, HowItWorks, Lineup, PreviewCard, WhatWeAsk, withAlcoholNote } from "@/components/sponsor/Sections";
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
 * Official rules: "Legal name: Louisiana Helpr"; "They can win once".
 *
 * @mutate src/pages/sponsor/SponsorPage.tsx |             <BusinessAsk />\n |             <BusinessAsk />\n            <ClaimSection state={state} greetingBrand={null} refCode={refCode} onSubmit={(p, logo) => backend.submit(p, logo)} />\n
 * @mutate src/content/sponsorPage.ts | One win per person across the whole giveaway: once you win a prize, you are not eligible to win another. | Winners may win more than once.
 * @mutate src/content/sponsorPage.ts | message the Louisiana Helpr Facebook page within 48 hours of the winner post | message the Louisiana Helpr Facebook page within 7 days of the winner post
 * @mutate src/content/sponsorPage.ts |     approved: true, |     approved: false,
 * @mutate src/content/sponsorPage.ts | run by Louisiana Helpr, Delcambre, Louisiana. | run by Louisiana Helpr, 314 Lynn Street, Delcambre, Louisiana.
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
    // Holiday audit D H1 (11-20): alcohol prizes are 21+ with ID, on the entrant page and on the prize line itself.
    expect(text).toContain("Prizes with alcohol go to winners 21 and older, with ID.");
    expect(text).toMatch(/2 free cocktails \(alcohol 21\+ with ID\)/);
    expect(container.querySelector("[data-testid='business-ask'] a")?.getAttribute("href")).toBe("/sponsor");
    expect(container.querySelector("[data-testid='giveaway-enter']")?.getAttribute("href")).toBe("https://www.facebook.com/louisianahelpr");
    // The full sponsor list (owner 2026-11-19): every brand on the tracker's calendar, once.
    expect(container.querySelectorAll("[data-testid='lineup-partner']").length).toBeGreaterThan(100);
  });

  it("an alcohol prize line says 21+ with ID; other prizes are untouched", () => {
    expect(withAlcoholNote("Bottle of wine")).toBe("Bottle of wine (alcohol 21+ with ID)");
    expect(withAlcoholNote("2 show tickets + 2 free cocktails")).toMatch(/\(alcohol 21\+ with ID\)$/);
    expect(withAlcoholNote("Gin tasting for two")).toMatch(/21\+/);
    for (const plain of ["Ginger body scrub", "Rummage box", "$50 gift card (plants only)"]) expect(withAlcoholNote(plain)).toBe(plain);
    expect(withAlcoholNote("Bourbon flight (21+ with ID)")).toBe("Bourbon flight (21+ with ID)");
  });

  it("the official rules: Louisiana Helpr, Louisiana 18+, one entry for all 25 days, one win per person, 48 hours, no placeholder", () => {
    const R = sponsorPage.rules;
    expect(R.approved).toBe(true);
    expect(R.sections.length).toBeGreaterThan(8);
    const all = R.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
    expect(all).not.toMatch(/\[[^\]]*\]/);
    for (const must of [
      "NO PURCHASE NECESSARY",
      "run by Louisiana Helpr, Delcambre, Louisiana.",
      "legal residents of Louisiana who are 18 years of age or older",
      "One entry covers all 25 days",
      "One win per person",
      "within 48 hours",
      "an alternate winner is drawn",
      // 25 Days readiness audit (11-20): Facebook only lets the Page message recent commenters, so winners are tagged
      // in a winner post and message the Page to claim; Apple is named as not involved.
      "tagged",
      "must message the Louisiana Helpr Facebook page within 48 hours of the winner post",
      "Apple is not a sponsor of this giveaway and is not involved in any way.",
      "described in that day's giveaway post",
      "Prizes are provided by the participating businesses",
      "in no way sponsored, endorsed or administered by, or associated with, Facebook or Meta",
      "Void where prohibited",
      "as described in the official giveaway post on the Louisiana Helpr Facebook page",
      // Holiday audit D H1 + M3 (11-20): alcohol 21+ with ID, one entry per person, odds, prize values, winners list.
      "may only be claimed by a winner who is 21 years of age or older, who must show valid photo ID",
      "receives the part of the prize without the alcohol, or, if the prize cannot be split, an alternate winner is drawn",
      "Limit one entry per person.",
      "more than one account or profile by the same person are void",
      "The odds of winning depend on the number of eligible entries received.",
      "approximate retail value",
      "A list of winners is available by emailing",
      "never ask a winner for payment, card details or a fee",
    ]) expect(all, must).toContain(must);
    expect(all).not.toMatch(ENTRY_STEPS);
    // Privacy (lead 2026-11-19): no street address in the public rules.
    expect(all).not.toMatch(/Lynn St|\b\d{3,5} [A-Z][a-z]+ (St|Street|Ave|Avenue|Rd|Road)\b|\b70528\b/);
    // The rules page links back to the entrant page, not the brand page.
    const page = fs.readFileSync(path.join(ROOT, "src/pages/sponsor/SponsorRulesPage.tsx"), "utf8");
    expect(page).toContain('<Link className="lh25-back" to="/25days">');
  });
});
