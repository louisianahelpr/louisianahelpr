/**
 * The deals queue of 2026-11-23 on the Black Friday and Cyber Monday pages (owner 11-23 ~11:10 AM: "as Black Friday
 * deals or discounts sales come in they should also be updated. In the tracker and the page."). Each deal from
 * ~/.lh-shots/deals-queue-1123.md that has one of our own links went into src/content/giftGuides.ts discountCodes:
 * Zappos (early Black Friday sale, On 30% off, TAKE20) and Club Recess's Black Friday sale. Every added deal carries an
 * https link, its exact code (or "" for a no-code sale) and an end day the card shows; none shows after its end day;
 * Zappos's TAKE20 is embargoed (Zappos asked creators not to share it before Nov 27), so no page names it until Nov 27,
 * and then only Cyber Monday's.
 *
 * @mutate src/content/giftGuideCodes.json | "expires":"2026-11-30","embargo":true,"href":"https://go.shopmy.us/p-107283587" | "expires":"2026-11-30","href":"https://go.shopmy.us/p-107283587"
 * @mutate src/content/giftGuideCodes.json | "dates":"Nov 24 – 30","starts":"2026-11-24","expires":"2026-11-30","href":"https://clubrecess.com/collections/black-friday" | "dates":"Nov 24 – 30","starts":"2026-11-24","href":"https://clubrecess.com/collections/black-friday"
 * @mutate src/content/giftGuideCodes.json | "code":"TAKE20","offer":"Cyber Monday: up to 50% off eligible styles" | "code":"TAKE 20","offer":"Cyber Monday: up to 50% off eligible styles"
 * @mutate src/content/giftGuideCodes.json | "offer":"Free gifts with purchase at $67, $107 and $147","expires":"2026-11-27" | "offer":"Free gifts with purchase at $67, $107 and $147"
 * @mutate src/content/giftGuideCodes.json | "expires":"2026-12-04","href":"https://go.shopmy.us/p-109784016" | "expires":"2026-12-04","href":"https://go.shopmy.us/p-109784375"
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { discountCodes, type DiscountCode } from "@/content/giftGuides";
import { DEAL_EVENTS, DEALS_WORDS, codesDay } from "@/content/giftGuideDeals.mjs";
import { CodeCards, codesOn } from "@/pages/info/giftGuides/GiftGuideDealCards";

/** The deals this queue added: store, exact code, end day (and the link, when one was made for it; `on`: a day it shows). */
const ADDED: { store: string; code: string; offer: RegExp; expires: string; on?: string; href?: string }[] = [
  { store: "Zappos", code: "", offer: /^Early Black Friday sale: up to 50% off/, expires: "2026-11-30" },
  { store: "Zappos", code: "", offer: /^30% off On Cloudtilt and Cloudsurfer 2$/, expires: "2026-12-01" },
  { store: "Zappos", code: "TAKE20", offer: /^Cyber Monday: up to 50% off/, expires: "2026-11-30" },
  { store: "Club Recess", code: "", offer: /^Black Friday through Cyber Monday: .*LEXI5 stacks$/, expires: "2026-11-30" },
  // Second pass (lead 11-23: our ShopMy earning links made 1:46-2:12 PM, deals-queue-1123.md "LINKS MADE"); each
  // link is exactly the one made for that brand.
  { store: "Dream Pairs", code: "BLC521", offer: /^50% off plus free shipping$/, expires: "2026-12-10", href: "https://go.shopmy.us/p-109798166" },
  { store: "PatchMD", code: "BF50", offer: /^50% off sitewide$/, expires: "2026-12-04", href: "https://go.shopmy.us/p-109784016" },
  { store: "Perelel", code: "BF2026", offer: /^25% off sitewide/, expires: "2026-11-29", href: "https://go.shopmy.us/p-109782873" },
  { store: "Perk Energy", code: "", offer: /^Free gifts with purchase at \$67, \$107 and \$147$/, expires: "2026-11-27", on: "2026-11-24", href: "https://go.shopmy.us/p-109783345" },
];

const DEAL_DAYS = DEAL_EVENTS.filter((e) => e.kind === "deals");
const daysFrom = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
/** What each day page shows on `today`: its codes for the day they must work on (as GiftGuideDeals.tsx asks). */
const pageCodes = (today: string) => DEAL_DAYS.map((e) => ({ id: e.id, codes: codesOn(codesDay(e, today), today) }));
const find = (a: (typeof ADDED)[number]) => discountCodes.find((c) => c.store === a.store && c.code === a.code && a.offer.test(c.offer));

describe("deals queue 1123: the incoming Black Friday / Cyber Monday deals are on the deals pages", () => {
  it("each added deal is in the codes list with an https link, its exact code and an end day", () => {
    expect(ADDED.length).toBeGreaterThan(3);
    for (const a of ADDED) {
      const c = find(a);
      expect(c, `${a.store} ${a.code || a.offer}`).toBeDefined();
      expect(c!.href, a.store).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+\//);
      expect(c!.expires, `${a.store} ${c!.offer}`).toBe(a.expires);
      if (a.href) expect(c!.href, a.store).toBe(a.href);
    }
    // TAKE20 exactly as Zappos sent it.
    expect(discountCodes.filter((c) => c.store === "Zappos" && c.code).map((c) => c.code)).toEqual(["TAKE20"]);
  });

  it("the cards show each added deal with its end day in words", () => {
    // Nov 28: every added deal is on (TAKE20 from Nov 27, On's 30% from Nov 26, Club Recess's sale from Nov 24).
    // Perk Energy's gifts (to Nov 27) end first: checked on Nov 24 (Black Friday's page lists the codes working Nov 27).
    const textOn = (today: string) => pageCodes(today).map(({ codes }) => render(<MemoryRouter><CodeCards codes={codes} /></MemoryRouter>).container.textContent ?? "").join("\n");
    const days = new Map<string, string>();
    for (const a of ADDED) {
      const on = a.on ?? "2026-11-28";
      if (!days.has(on)) days.set(on, textOn(on));
      const text = days.get(on)!;
      const c = find(a)!;
      expect(text, `${a.store}: ${c.offer}`).toContain(c.offer);
      expect(text, `${a.store}: ${c.offer}`).toContain(DEALS_WORDS.runs(c.starts, c.expires));
    }
    expect(days.get("2026-11-28")).toContain("TAKE20");
    expect(DEALS_WORDS.runs("2026-11-27", "2026-11-30")).toBe("Nov 27 – Nov 30");
  });

  it("no deal shows on either deals page after its end day (Nov 23 through Dec 10)", () => {
    const days = daysFrom("2026-11-23", "2026-12-10");
    let checked = 0;
    for (const today of days) {
      for (const { id, codes } of pageCodes(today)) {
        for (const c of codes) {
          checked++;
          if (c.expires) expect(c.expires >= today, `${id} on ${today}: ${c.store} ${c.code} ended ${c.expires}`).toBe(true);
        }
        for (const a of ADDED) {
          const shown = codes.some((c) => c.store === a.store && c.code === a.code && a.offer.test(c.offer));
          if (today > a.expires) expect(shown, `${id} on ${today}: ${a.store} ${a.code || a.offer}`).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  // Once Black Friday has passed its page lists the codes that work today (codesDay), so from Nov 28 it may carry a
  // working TAKE20 too; before Nov 27 (2026-11-27) no page names it, and after Nov 30 (2026-11-30) none does.
  it("TAKE20 is on no page before Nov 27, is on Cyber Monday's Nov 27 to 30, and is gone after", () => {
    const isTake20 = (c: DiscountCode) => c.store === "Zappos" && c.code === "TAKE20";
    let before = 0;
    for (const today of daysFrom("2026-11-20", "2026-12-03")) {
      for (const { id, codes } of pageCodes(today)) {
        const shown = codes.some(isTake20);
        if (today < "2026-11-27" || today > "2026-11-30") {
          before++;
          expect(shown, `${id} on ${today}`).toBe(false);
        } else if (id === "cyber-monday") expect(shown, `${id} on ${today}`).toBe(true);
        else if (today === "2026-11-27") expect(shown, `${id} on its own day`).toBe(false);
      }
    }
    expect(before).toBeGreaterThan(15);
  });
});
