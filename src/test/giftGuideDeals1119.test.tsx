/**
 * The deals page, /gift-guides/black-friday-cyber-monday (owner 2026-11-19: "You can build the rest of the Black Friday
 * and Cyber Monday guides asap"; owner 2026-11-21: "we still need to do the black friday section, small business
 * saturday, and cyber monday deals", "Codes and deals shouldn't randomly show in sections"):
 *   - ONE page, three day sections in calendar order: Black Friday (Nov 27), Small Business Saturday (Nov 28, the
 *     confirmed Louisiana 25 Days sponsors), Cyber Monday (Nov 30); each its heading, one line with its day, its cards;
 *   - before, on and after each day the line reads for that time; a passed day's section moves below the ones ahead;
 *   - a deal hides itself after its end day; an announced deal shows "Starts <day>" until it starts;
 *   - the data: every deal checked (source, day, words seen), our affiliate links only, Amazon with our tag, never a
 *     price, at most 2 per brand, each section by our commission;
 *   - deals never show inside Her, Him or Kids (no deals file or deal card on a guide page);
 *   - the landing slot Nov 23 through Dec 1; "Holiday Deals" after Dec 1.
 *
 * @mutate src/content/giftGuideDeals.mjs |   return !(deal.ends && deal.ends < today); |   return !(deal.ends && deal.ends < "2000-01-01");
 * @mutate src/content/giftGuideDeals.mjs |   return deal.status === "announced" && !!deal.starts && deal.starts > today; |   return false;
 * @mutate src/content/giftGuideDeals.mjs |   return [...open, ...past]; |   return DEAL_EVENTS.slice();
 * @mutate src/content/giftGuideDeals.mjs |   return today >= FEATURE_FROM && today <= FEATURE_TO; |   return today <= FEATURE_TO;
 * @mutate src/content/giftGuideDeals.mjs |   return today > RETITLE_AFTER ? DEALS_WORDS.laterTitle : DEALS_WORDS.title; |   return DEALS_WORDS.title;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |   const shown = deals ? liveDeals(deals, today) : []; |   const shown = deals ?? [];
 * @mutate scripts/gift-guide-deals.mjs |     if (n > DEALS_PER_BRAND) throw | if (false) throw
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DEALS from "@/content/giftGuideDeals.json";
import SMALL_BIZ from "@/content/giftGuideSmallBiz.json";
import {
  DEAL_EVENTS, DEALS_PER_BRAND, DEALS_SLUG, DEALS_WORDS, dealShows, dealStartsLater, dealsFeatured, dealsTitle, eventOrder, eventPhase, louisianaDay, type Deal,
} from "@/content/giftGuideDeals.mjs";
import { dealsPageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { buildDeals, type SourceDeal } from "../../scripts/gift-guide-deals.mjs";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import { DealsFeature, GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";

const deals = DEALS as Deal[];
const SOURCE = JSON.parse(readFileSync("scripts/gift-guide-deals-1121.json", "utf8")) as { deals: SourceDeal[] };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Noon in Louisiana on a YYYY-MM-DD day (18:00Z in CST). */
const noon = (ymd: string) => new Date(`${ymd}T18:00:00Z`);

const renderDeals = async (ymd: string) => {
  const view = render(
    <MemoryRouter>
      <GiftGuideDeals now={noon(ymd)} />
    </MemoryRouter>,
  );
  await screen.findAllByText(DEALS_WORDS.shop(deals[0].brand));
  // The sponsors' grid loads its own file.
  await screen.findAllByText((SMALL_BIZ as { name: string }[])[0].name);
  return view.container;
};
const sectionIds = (c: HTMLElement) => [...c.querySelectorAll("[data-gift-deal-section]")].map((s) => s.getAttribute("data-gift-deal-section"));
const brandsIn = (c: HTMLElement, id: string) => [...c.querySelectorAll(`[data-gift-deal-section="${id}"] [data-gift-deal]`)].map((li) => li.getAttribute("data-gift-deal"));

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
    expect(dealShows({ ends: "2026-11-28" }, "2026-11-28")).toBe(true);
    expect(dealShows({ ends: "2026-11-28" }, "2026-11-29")).toBe(false);
    expect(dealShows({}, "2027-01-01")).toBe(true);
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

describe("deals page: the page", () => {
  it("today (Nov 21): three sections in order, each with its day line, then its cards; no price", async () => {
    const c = await renderDeals("2026-11-21");
    expect(sectionIds(c)).toEqual(["black-friday", "small-business-saturday", "cyber-monday"]);
    const lines = [...c.querySelectorAll("[data-gift-deal-day]")].map((p) => p.textContent);
    expect(lines).toEqual(DEAL_EVENTS.map((e) => e.before));
    expect(lines[0]).toContain("Nov 27");
    expect(lines[1]).toContain("Nov 28");
    expect(lines[2]).toContain("Nov 30");
    // The jump links name each day and point at its section.
    expect([...c.querySelectorAll("[data-gift-deals-jump] a")].map((a) => a.getAttribute("href"))).toEqual(["#black-friday", "#small-business-saturday", "#cyber-monday"]);
    // Every deal card is in its own event's section, and every deal shows (none ended on Nov 21).
    for (const id of ["black-friday", "cyber-monday"]) expect(brandsIn(c, id), id).toEqual(deals.filter((d) => d.event === id).map((d) => d.brand));
    // Small Business Saturday holds the sponsors, never a deal card.
    const sbs = c.querySelector('[data-gift-deal-section="small-business-saturday"]')!;
    expect(sbs.querySelectorAll("[data-gift-deal]").length).toBe(0);
    expect(sbs.querySelectorAll("[data-gift-sb]").length).toBe((SMALL_BIZ as unknown[]).length);
    for (const a of c.querySelectorAll("[data-gift-deal] a")) expect(a.getAttribute("rel")).toBe("sponsored noopener");
    expect(c.querySelector("[data-gift-price], .gg-price")).toBeNull();
    // Owner 2026-11-21 ("remove this"): no intro paragraph, "#ad" line or helper line on the deals page.
    // @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       <DealsAndCodes open /> |       <p data-gift-deals-ad="">#ad</p><DealsAndCodes open />
    expect(c.querySelector("[data-gift-deals-ad], [data-gift-deals-help], .gg-deals-intro")).toBeNull();
    expect(c.textContent).not.toMatch(/big sales are here|#ad|Codes copy with a tap/);
  });

  it("each card: the code chip, Starts before an announced deal begins, Ends otherwise", async () => {
    const c = await renderDeals("2026-11-21");
    const madewell = c.querySelector('[data-gift-deal="Madewell"]')!;
    expect(madewell.querySelector("[data-gift-deal-code] code")!.textContent).toBe("LETSGO");
    const stanley = c.querySelector('[data-gift-deal="Stanley"]')!;
    expect(stanley.querySelector("[data-gift-deal-dates]")!.textContent).toBe("Ends Nov 30");
    expect(stanley.querySelector("[data-gift-deal-code]")).toBeNull();
    const rare = c.querySelector('[data-gift-deal="Rare Beauty"]')!;
    expect(rare.querySelector("[data-gift-deal-dates]")!.textContent).toBe("Starts Nov 26");
    cleanup();
    const later = await renderDeals("2026-11-26");
    expect(later.querySelector('[data-gift-deal="Rare Beauty"] [data-gift-deal-dates]')!.textContent).toBe("Ends Dec 1");
  });

  it("on and after each day: its line changes, a passed day moves down, an ended deal leaves", async () => {
    const c = await renderDeals("2026-11-28");
    expect(sectionIds(c)).toEqual(["small-business-saturday", "cyber-monday", "black-friday"]);
    const line = (id: string) => c.querySelector(`[data-gift-deal-section="${id}"] [data-gift-deal-day]`)!.textContent;
    expect(line("small-business-saturday")).toBe(DEAL_EVENTS[1].on);
    expect(line("black-friday")).toBe(DEAL_EVENTS[0].after);
    expect(line("cyber-monday")).toBe(DEAL_EVENTS[2].before);
    cleanup();
    // Dec 1: Stanley (ends Nov 30) is gone; Rare Beauty (through Dec 1) still shows.
    const dec1 = await renderDeals("2026-12-01");
    expect(brandsIn(dec1, "black-friday")).not.toContain("Stanley");
    expect(brandsIn(dec1, "cyber-monday")).toContain("Rare Beauty");
    cleanup();
    const dec2 = await renderDeals("2026-12-02");
    expect(brandsIn(dec2, "cyber-monday")).not.toContain("Rare Beauty");
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
    expect(feature(noon("2026-11-23"))!.getAttribute("href")).toBe(`/gift-guides/${DEALS_SLUG}`);
    expect(feature(noon("2026-12-01"))).not.toBeNull();
    expect(feature(noon("2026-12-02"))).toBeNull();
  });

  it("is Black Friday & Cyber Monday Deals through Dec 1, then Holiday Deals (page, slot, head)", () => {
    expect(dealsTitle("2026-11-19")).toBe("Black Friday & Cyber Monday Deals");
    expect(dealsTitle("2026-12-01")).toBe("Black Friday & Cyber Monday Deals");
    expect(dealsTitle("2026-12-02")).toBe("Holiday Deals");
    expect(feature(noon("2026-12-01"))!.textContent).toContain("Black Friday & Cyber Monday Deals");
    expect(dealsPageMeta(noon("2026-11-24")).title).toBe("Black Friday & Cyber Monday Deals — Helpr");
    expect(dealsPageMeta(noon("2026-12-02")).title).toBe("Holiday Deals — Helpr");
  });
});
