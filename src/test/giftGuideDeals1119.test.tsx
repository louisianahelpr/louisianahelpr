/**
 * The deals days (owner 2026-11-19: "You can build the rest of the Black Friday and Cyber Monday guides asap"; owner
 * 2026-11-21: "we still need to do the black friday section, small business saturday, and cyber monday deals", "Codes
 * and deals shouldn't randomly show in sections"; later "remove small business stuff from black friday stuff. like each
 * day has its own section, no need to put them all in 1" and "[Deals & codes box] should open collapsed"):
 *   - each day its OWN page: /gift-guides/black-friday (Nov 27), /gift-guides/small-business-saturday (Nov 28, the
 *     confirmed Louisiana 25 Days sponsors only, and a link to /shop-small) and /gift-guides/cyber-monday (Nov 30);
 *     each only its own cards, its own collapsed codes box (the codes and sales that still work that day), no jump row;
 *   - the old /gift-guides/black-friday-cyber-monday opens Black Friday, its old #<day> anchors that day's page;
 *   - before, on and after each day the line reads for that time;
 *   - a deal hides itself after its end day; an announced deal shows "Starts <day>" until it starts;
 *   - the data: every deal checked (source, day, words seen), our affiliate links only, Amazon with our tag, never a
 *     price, at most 2 per brand, each section by our commission;
 *   - deals never show inside Her, Him or Kids (no deals file or deal card on a guide page);
 *   - the landing slot Nov 23 through Dec 1, opening the next day still ahead; "Holiday Deals" after Dec 1.
 *
 * @mutate src/content/giftGuideDeals.mjs |   return ends ? ends >= today : today <= RETITLE_AFTER; |   return ends ? ends >= "2000-01-01" : today <= RETITLE_AFTER;
 * @mutate src/content/giftGuideDeals.mjs |   return deal.status === "announced" && !!deal.starts && deal.starts > today; |   return false;
 * @mutate src/content/giftGuideDeals.mjs |   return [...open, ...past]; |   return DEAL_EVENTS.slice();
 * @mutate src/content/giftGuideDeals.mjs |   return today >= FEATURE_FROM && today <= FEATURE_TO; |   return today <= FEATURE_TO;
 * @mutate src/content/giftGuideDeals.mjs |   return today > RETITLE_AFTER ? DEALS_WORDS.laterTitle : DEALS_WORDS.title; |   return DEALS_WORDS.title;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |   const list = deals ? dealsIn(liveDeals(deals, today, STORE_CODES), day.id) : []; |   const list = deals ? liveDeals(deals, today, STORE_CODES) : [];
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |   const list = deals ? dealsIn(liveDeals(deals, today, STORE_CODES), day.id) : []; |   const list = deals ? dealsIn(deals, day.id) : [];
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |           <DealsAndCodes on={codesDay(day, today)} /> |           <DealsAndCodes />
 * @mutate src/content/giftGuideDeals.mjs |   return today > event.day ? today : event.day; |   return today;
 * @mutate src/content/giftGuideDeals.mjs |   return dealDay(String(hash ?? "").replace(/^#/, ""))?.id ?? DEAL_EVENTS[0].id; |   return DEAL_EVENTS[0].id;
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <details id="gift-codes" className="gg-deals" data-gift-deals-codes=""> | <details id="gift-codes" className="gg-deals" open data-gift-deals-codes="">
 * @mutate scripts/gift-guide-deals.mjs |     if (n > DEALS_PER_BRAND) throw | if (false) throw
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DEALS from "@/content/giftGuideDeals.json";
import SMALL_BIZ from "@/content/giftGuideSmallBiz.json";
import {
  DEAL_DAY_SLUGS, DEAL_EVENTS, DEALS_PER_BRAND, DEALS_SLUG, DEALS_WORDS, codesDay, dealDay, dealShows, dealStartsLater, dealsFeatured, dealsTitle, eventOrder, eventPhase, louisianaDay, oldDealsTarget, type Deal,
} from "@/content/giftGuideDeals.mjs";
import { dealDayPageMeta, giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { DEAL_CODES, SALES } from "@/content/giftGuidePicks";
import { activeCodes, discountCodes } from "@/content/giftGuides";
import { buildDeals, type SourceDeal } from "../../scripts/gift-guide-deals.mjs";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import { DealsFeature, GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { liveSales } from "@/pages/info/giftGuides/GiftGuidesSidebar";

const deals = DEALS as Deal[];
const SOURCE = JSON.parse(readFileSync("scripts/gift-guide-deals-1121.json", "utf8")) as { deals: SourceDeal[] };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Noon in Louisiana on a YYYY-MM-DD day (18:00Z in CST). */
const noon = (ymd: string) => new Date(`${ymd}T18:00:00Z`);

const BF = dealDay("black-friday")!;
const SBS = dealDay("small-business-saturday")!;
const CM = dealDay("cyber-monday")!;

/** One day's page on a Louisiana day; waits for its cards (or, Small Business Saturday, its sponsors). */
const renderDay = async (day: typeof BF, ymd: string) => {
  const view = render(
    <MemoryRouter>
      <GiftGuideDeals day={day} now={noon(ymd)} />
    </MemoryRouter>,
  );
  if (day.kind === "deals") {
    const first = deals.find((d) => d.event === day.id && dealShows(d, ymd));
    // Holiday audit 1121: the card link reads "Shop" (the brand is sr-only), so wait on the cards themselves.
    if (first) await waitFor(() => expect(document.querySelector(`[data-gift-deal="${first.brand}"]`)).not.toBeNull());
    else await screen.findByText(DEALS_WORDS.none, { exact: false });
  } else await screen.findAllByText((SMALL_BIZ as { name: string }[])[0].name);
  return view.container;
};
const brandsOn = (c: HTMLElement) => [...c.querySelectorAll("[data-gift-deal]")].map((li) => li.getAttribute("data-gift-deal"));

describe("deals page: the data", () => {
  it("every deal is checked and sits in a day section; never a price; at most 2 per brand", () => {
    expect(deals.length).toBeGreaterThan(20); // 28 measured 2026-11-21
    const events = DEAL_EVENTS.filter((e) => e.kind === "deals").map((e) => e.id);
    expect(events).toEqual(["black-friday", "cyber-monday"]);
    for (const e of events) expect(deals.filter((d) => d.event === e).length, e).toBeGreaterThan(5);
    const perBrand = new Map<string, number>();
    for (const d of deals) {
      expect(events, d.brand).toContain(d.event);
      expect(d, d.brand).not.toHaveProperty("price");
      expect(d, d.brand).not.toHaveProperty("commission");
      expect(d.deal.length, d.brand).toBeGreaterThan(5);
      expect(["live", "announced"]).toContain(d.status);
      for (const k of ["starts", "ends"] as const) if (d[k]) expect(d[k], `${d.brand} ${k}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      perBrand.set(d.brand, (perBrand.get(d.brand) ?? 0) + 1);
    }
    for (const [b, n] of perBrand) expect(n, b).toBeLessThanOrEqual(DEALS_PER_BRAND);
    // The source holds the proof for each one: where it was read, the day, and the words seen.
    expect(SOURCE.deals.length).toBe(deals.length);
    for (const r of SOURCE.deals) {
      expect(r.source, r.brand).toBeTruthy();
      expect(r.checked, r.brand).toMatch(/^2026-11-(19|2\d)$/);
      expect((r.seen ?? "").length, r.brand).toBeGreaterThan(10);
      // An Amazon deal is the brand's own Creator Connections campaign (Amazon's pages refuse automated reads).
      if (r.store === "Amazon") expect(r.source, r.brand).toMatch(/^Amazon Creator Connections campaign amzn1\.campaign\./);
      else expect(r.source, r.brand).toMatch(/^https:\/\//);
    }
    // The generated file is the generator's output from the source, byte for byte in content.
    const cutouts = JSON.parse(readFileSync("scripts/gift-guide-deals-cutouts.json", "utf8")).cutouts as Record<string, string>;
    expect(buildDeals(SOURCE.deals, cutouts)).toEqual(deals);
  });

  it("every link is an affiliate link we hold; every Amazon link carries our tag; Amazon photos unedited, others cut out or on white", () => {
    const hosts = new Set(["go.shopmy.us", "www.amazon.com", "www.anrdoezrs.net", "click.linksynergy.com"]);
    for (const d of deals) {
      const u = new URL(d.href);
      expect(u.protocol, d.brand).toBe("https:");
      expect(hosts.has(u.hostname), `${d.brand} ${u.hostname}`).toBe(true);
      if (u.hostname === "www.amazon.com") {
        expect(u.searchParams.get("tag"), d.brand).toBe("louisianahelpr-20");
        expect(d.store).toBe("Amazon");
        expect(d.image, d.brand).toMatch(/^https:\/\/m\.media-amazon\.com\//);
      }
      if (d.image?.startsWith("/")) expect(d.image, d.brand).toMatch(/^\/gift-guides\/deals\/cutouts\/[0-9a-f]{8}\.webp$/);
    }
    const manifest = JSON.parse(readFileSync("scripts/gift-guide-deals-cutouts.json", "utf8")) as { cutouts: Record<string, string>; skipped: Record<string, string> };
    for (const r of SOURCE.deals) {
      if (!r.image) continue;
      const verdict = manifest.cutouts[r.image] ? "cut out" : manifest.skipped[r.image];
      expect(["cut out", "already on white", "Amazon photo (never edited)"], `${r.brand}: ${verdict}`).toContain(verdict);
    }
  });

  it("the generator sorts each section by commission, and refuses a third deal from a brand, a price, a foreign link or an untagged Amazon link", () => {
    const row = (brand: string, event: string, commission: number, extra: Partial<SourceDeal> = {}): SourceDeal => ({
      event, brand, deal: `${brand} 30% off sitewide`, href: `https://go.shopmy.us/p-${brand}`, commission, source: `https://${brand}.com`, checked: "2026-11-21", seen: `${brand} 30% off sitewide`, ...extra,
    });
    const out = buildDeals([row("Low", "black-friday", 5), row("Cyber", "cyber-monday", 30), row("High", "black-friday", 20), row("Soon", "cyber-monday", 1, { status: "announced", starts: "2026-11-26" })]);
    expect(out.map((d) => d.brand)).toEqual(["High", "Low", "Cyber", "Soon"]);
    expect(out[3]).toMatchObject({ status: "announced", starts: "2026-11-26" });
    expect(() => buildDeals([row("A", "black-friday", 1), row("A", "cyber-monday", 1), row("A", "black-friday", 1)])).toThrow(/more than 2/);
    expect(() => buildDeals([row("A", "black-friday", 1, { price: 20 })])).toThrow(/price/);
    expect(() => buildDeals([row("A", "black-friday", 1, { href: "https://example.com/a" })])).toThrow(/affiliate/);
    expect(() => buildDeals([row("A", "black-friday", 1, { href: "https://www.amazon.com/dp/B000000000" })])).toThrow(/tag/);
    expect(() => buildDeals([row("A", "small-business-saturday", 1)])).toThrow(/unknown event/);
    expect(() => buildDeals([row("A", "black-friday", 1, { seen: "" })])).toThrow(/seen/);
  });
});

describe("deals page: dates", () => {
  it("dealShows: through its end day, never after; an announced deal says Starts until its start day", () => {
    expect(dealShows({ brand: "Any", ends: "2026-11-28" }, "2026-11-28")).toBe(true);
    expect(dealShows({ brand: "Any", ends: "2026-11-28" }, "2026-11-29")).toBe(false);
    // Holiday audit 1121 (High): a deal with no known end shows through Dec 1 (RETITLE_AFTER), never for good.
    expect(dealShows({ brand: "Any" }, "2026-12-01")).toBe(true);
    expect(dealShows({ brand: "Any" }, "2026-12-02")).toBe(false);
    expect(dealStartsLater({ starts: "2026-11-26", status: "announced" }, "2026-11-25")).toBe(true);
    expect(dealStartsLater({ starts: "2026-11-26", status: "announced" }, "2026-11-26")).toBe(false);
    expect(dealStartsLater({ starts: "2026-11-26", status: "live" }, "2026-11-25")).toBe(false);
  });

  it("sections run in calendar order, and a passed day moves below the days still ahead", () => {
    expect(eventOrder("2026-11-21").map((e) => e.id)).toEqual(["black-friday", "small-business-saturday", "cyber-monday"]);
    expect(eventOrder("2026-11-27").map((e) => e.id)).toEqual(["black-friday", "small-business-saturday", "cyber-monday"]);
    expect(eventOrder("2026-11-28").map((e) => e.id)).toEqual(["small-business-saturday", "cyber-monday", "black-friday"]);
    expect(eventOrder("2026-11-30").map((e) => e.id)).toEqual(["cyber-monday", "black-friday", "small-business-saturday"]);
    expect(eventOrder("2026-12-02").map((e) => e.id)).toEqual(["black-friday", "small-business-saturday", "cyber-monday"]);
    const bf = DEAL_EVENTS[0];
    expect([eventPhase(bf, "2026-11-26"), eventPhase(bf, "2026-11-27"), eventPhase(bf, "2026-11-28")]).toEqual(["before", "on", "after"]);
    expect(DEAL_EVENTS.map((e) => [e.title, e.day])).toEqual([["Black Friday", "2026-11-27"], ["Small Business Saturday", "2026-11-28"], ["Cyber Monday", "2026-11-30"]]);
  });
});

describe("deals days: one page per day (owner 11-21)", () => {
  it("three day pages, slugs and banner titles in calendar order; the old address and its anchors open the matching day", () => {
    expect([...DEAL_DAY_SLUGS]).toEqual(["black-friday", "small-business-saturday", "cyber-monday"]);
    expect(DEAL_EVENTS.map((e) => e.pageTitle)).toEqual(["Black Friday Deals", "Small Business Saturday", "Cyber Monday Deals"]);
    expect(dealDay(DEALS_SLUG)).toBeNull();
    expect(oldDealsTarget("")).toBe("black-friday");
    expect(oldDealsTarget("#black-friday")).toBe("black-friday");
    expect(oldDealsTarget("#small-business-saturday")).toBe("small-business-saturday");
    expect(oldDealsTarget("#cyber-monday")).toBe("cyber-monday");
    expect(oldDealsTarget("#nope")).toBe("black-friday");
    // Each day's head is its own: title, description and canonical.
    for (const e of DEAL_EVENTS) {
      const m = giftGuidePageMeta(e.id);
      expect(m).toEqual(dealDayPageMeta(e));
      expect(m.title).toBe(`${e.pageTitle} — Helpr`);
      expect(m.canonical).toBe(`https://www.louisianahelpr.com/gift-guides/${e.id}`);
      expect(m.description.length, e.id).toBeGreaterThan(60);
    }
  });

  it("Black Friday (today, Nov 21): only Black Friday's cards and its day line; no intro, #ad line, other day, jump row or price", async () => {
    const c = await renderDay(BF, "2026-11-21");
    expect(c.querySelector("[data-gift-deal-day-page]")!.getAttribute("data-gift-deal-day-page")).toBe("black-friday");
    expect(c.querySelector("[data-gift-deal-day]")!.textContent).toBe(BF.before);
    expect(brandsOn(c)).toEqual(deals.filter((d) => d.event === "black-friday").map((d) => d.brand));
    expect(brandsOn(c).length).toBeGreaterThan(5);
    // No Small Business Saturday or Cyber Monday on it, and no jump links between the days.
    expect(c.querySelectorAll("[data-gift-sb], [data-gift-sb-grid]").length).toBe(0);
    expect(c.querySelector("[data-gift-deals-jump], [data-gift-deal-section], a[href^='#']")).toBeNull();
    expect(c.textContent).not.toMatch(/Small Business Saturday|Cyber Monday/);
    for (const a of c.querySelectorAll("[data-gift-deal] a")) expect(a.getAttribute("rel")).toBe("sponsored noopener");
    expect(c.querySelector("[data-gift-price], .gg-price")).toBeNull();
    // Owner 2026-11-21 ("remove this"): no intro paragraph, "#ad" line or helper line on the deals page.
    // @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |           <DealsAndCodes on={codesDay(day, today)} /> |           <p data-gift-deals-ad="">#ad</p><DealsAndCodes on={codesDay(day, today)} />
    expect(c.querySelector("[data-gift-deals-ad], [data-gift-deals-help], .gg-deals-intro")).toBeNull();
    expect(c.textContent).not.toMatch(/big sales are here|#ad|Codes copy with a tap/);
  });

  it("Cyber Monday: only Cyber Monday's cards", async () => {
    const c = await renderDay(CM, "2026-11-21");
    expect(brandsOn(c)).toEqual(deals.filter((d) => d.event === "cyber-monday").map((d) => d.brand));
    expect(brandsOn(c).length).toBeGreaterThan(5);
    expect(c.querySelectorAll("[data-gift-sb]").length).toBe(0);
    expect(c.querySelector("[data-gift-deals-jump]")).toBeNull();
  });

  it("Small Business Saturday: the confirmed Louisiana sponsors only, a link to /shop-small, no deal card and no codes box", async () => {
    const c = await renderDay(SBS, "2026-11-21");
    expect(c.querySelectorAll("[data-gift-sb]").length).toBe((SMALL_BIZ as unknown[]).length);
    expect((SMALL_BIZ as unknown[]).length).toBeGreaterThan(20); // 37 measured 2026-11-21
    expect(c.querySelectorAll("[data-gift-deal]").length).toBe(0);
    expect(c.querySelector("[data-gift-deals-codes]")).toBeNull();
    expect(c.querySelector("[data-gift-deals-shop-small]")!.getAttribute("href")).toBe("/shop-small");
    expect(c.querySelector("[data-gift-deal-day]")!.textContent).toBe(SBS.before);
  });

  it("each deals day's codes box starts collapsed and holds only the codes and sales that still work on that day", async () => {
    const all = [...discountCodes, ...DEAL_CODES];
    const counts: number[] = [];
    for (const day of [BF, CM]) {
      const c = await renderDay(day, "2026-11-21");
      const box = c.querySelector<HTMLDetailsElement>("details[data-gift-deals-codes]")!;
      expect(box, day.id).not.toBeNull();
      expect(box.open, day.id).toBe(false);
      expect(box.hasAttribute("open"), day.id).toBe(false);
      // Its codes are exactly the ones that work on the day (each store's box lists them).
      const on = codesDay(day, "2026-11-21");
      expect(on).toBe(day.day);
      const want = activeCodes(all, on).map((x) => x.code).sort();
      box.open = true;
      const seeAll = box.querySelector<HTMLButtonElement>("[data-gift-all-codes]");
      if (seeAll) fireEvent.click(seeAll);
      const shown = [...box.querySelectorAll("[data-gift-code]")].map((x) => x.getAttribute("data-gift-code")).sort();
      expect(shown, day.id).toEqual(want);
      counts.push(shown.length);
      expect(box.querySelector("[data-gift-deals-count]")!.textContent, day.id).toContain(`${want.length} code`);
      expect(box.querySelector("[data-gift-deals-count]")!.textContent, day.id).toContain(`${liveSales(SALES, on).length} store sale`); // holiday audit 1121: store sales, not "deals"
      cleanup();
    }
    // The dated codes land on their own day only: Black Friday's TAKE25 and XT25, Cyber Monday's CYBER.
    const bf = activeCodes(all, BF.day).map((x) => x.code);
    const cm = activeCodes(all, CM.day).map((x) => x.code);
    expect(bf).toEqual(expect.arrayContaining(["TAKE25", "XT25"]));
    expect(bf).not.toContain("CYBER");
    expect(cm).toContain("CYBER");
    expect(cm).not.toContain("TAKE25");
    expect(cm).not.toContain("XT25");
    expect(counts.every((n) => n > 3)).toBe(true);
    // Once a day has passed, its codes are the ones still working today.
    expect(codesDay(BF, "2026-12-03")).toBe("2026-12-03");
  });

  it("each card: the code chip, Starts before an announced deal begins, Ends otherwise", async () => {
    const madewellDay = dealDay(deals.find((d) => d.brand === "Madewell")!.event)!;
    let c = await renderDay(madewellDay, "2026-11-21");
    expect(c.querySelector('[data-gift-deal="Madewell"] [data-gift-deal-code] code')!.textContent).toBe("LETSGO");
    cleanup();
    const stanleyDay = dealDay(deals.find((d) => d.brand === "Stanley")!.event)!;
    c = await renderDay(stanleyDay, "2026-11-21");
    const stanley = c.querySelector('[data-gift-deal="Stanley"]')!;
    expect(stanley.querySelector("[data-gift-deal-dates]")!.textContent).toBe("Ends Nov 30");
    expect(stanley.querySelector("[data-gift-deal-code]")).toBeNull();
    cleanup();
    const rareDay = dealDay(deals.find((d) => d.brand === "Rare Beauty")!.event)!;
    c = await renderDay(rareDay, "2026-11-21");
    expect(c.querySelector('[data-gift-deal="Rare Beauty"] [data-gift-deal-dates]')!.textContent).toBe("Starts Nov 26");
    cleanup();
    const later = await renderDay(rareDay, "2026-11-26");
    expect(later.querySelector('[data-gift-deal="Rare Beauty"] [data-gift-deal-dates]')!.textContent).toBe("Ends Dec 1");
  });

  it("on and after its day: the line changes, an ended deal leaves", async () => {
    let c = await renderDay(SBS, "2026-11-28");
    expect(c.querySelector("[data-gift-deal-day]")!.textContent).toBe(SBS.on);
    cleanup();
    c = await renderDay(BF, "2026-11-28");
    expect(c.querySelector("[data-gift-deal-day]")!.textContent).toBe(BF.after);
    cleanup();
    // Dec 1: Stanley (ends Nov 30) is gone; Rare Beauty (through Dec 1) still shows.
    const stanleyDay = dealDay(deals.find((d) => d.brand === "Stanley")!.event)!;
    c = await renderDay(stanleyDay, "2026-12-01");
    expect(brandsOn(c)).not.toContain("Stanley");
    cleanup();
    c = await renderDay(CM, "2026-12-01");
    expect(brandsOn(c)).toContain("Rare Beauty");
    cleanup();
    c = await renderDay(CM, "2026-12-02");
    expect(brandsOn(c)).not.toContain("Rare Beauty");
  });
});

describe("deals never show inside Her, Him or Kids (owner 11-21)", () => {
  it("no guide chunk holds a deal, a deal card or a code", () => {
    const brandsWithCodes = deals.filter((d) => d.code).map((d) => d.code!);
    expect(brandsWithCodes.length).toBeGreaterThan(3);
    for (const slug of ["her", "him", "kids"]) {
      const text = readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8");
      expect(text.length, slug).toBeGreaterThan(1000);
      for (const code of brandsWithCodes) expect(text, `${slug}: ${code}`).not.toContain(`"${code}"`);
      expect(text, slug).not.toMatch(/"(deal|event)":/);
    }
    // The guide page never imports the deals file or card.
    const view = readFileSync("src/pages/info/giftGuides/GiftGuideView.tsx", "utf8");
    expect(view).not.toMatch(/giftGuideDeals|GiftGuideDeals|DealCard/);
  });
});

describe("deals page: the landing's featured slot and the retitle", () => {
  const feature = (when: Date) => render(<MemoryRouter><DealsFeature now={when} /></MemoryRouter>).container.querySelector("[data-gift-deals-feature]");

  it("shows Nov 23 through Dec 1 in Louisiana, never before or after", () => {
    expect(dealsFeatured("2026-11-22")).toBe(false);
    expect(feature(noon("2026-11-22"))).toBeNull();
    // 11:00 PM Nov 22 in Louisiana is already Nov 23 in UTC: still hidden.
    expect(louisianaDay(new Date("2026-11-23T05:00:00Z"))).toBe("2026-11-22");
    expect(feature(new Date("2026-11-23T05:00:00Z"))).toBeNull();
    // It opens the next deals day still ahead (owner 11-21: each day its own page).
    expect(feature(noon("2026-11-23"))!.getAttribute("href")).toBe("/gift-guides/black-friday");
    expect(feature(noon("2026-11-28"))!.getAttribute("href")).toBe("/gift-guides/small-business-saturday");
    expect(feature(noon("2026-11-29"))!.getAttribute("href")).toBe("/gift-guides/cyber-monday");
    expect(feature(noon("2026-12-01"))).not.toBeNull();
    expect(feature(noon("2026-12-02"))).toBeNull();
  });

  it("the slot is Black Friday & Cyber Monday Deals through Dec 1, then Holiday Deals", () => {
    expect(dealsTitle("2026-11-19")).toBe("Black Friday & Cyber Monday Deals");
    expect(dealsTitle("2026-12-01")).toBe("Black Friday & Cyber Monday Deals");
    expect(dealsTitle("2026-12-02")).toBe("Holiday Deals");
    expect(feature(noon("2026-12-01"))!.textContent).toContain("Black Friday & Cyber Monday Deals");
    expect(feature(noon("2026-11-30"))!.textContent).toContain("Black Friday & Cyber Monday Deals");
  });
});
