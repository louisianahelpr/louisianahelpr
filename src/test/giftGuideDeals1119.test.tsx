/**
 * The Black Friday & Cyber Monday deals guide (owner 2026-11-19: "You can build the rest of the Black Friday and Cyber
 * Monday guides asap"; live by Mon Nov 23), /gift-guides/black-friday-cyber-monday:
 *   - a deal hides itself after its end day, and an "announced" deal shows only from its start day (the page at view
 *     time, src/content/giftGuideDeals.mjs dealShows; the generator drops ended ones too);
 *   - the landing features the guide at its very top Nov 23 through Dec 1 in Louisiana, never before or after;
 *   - after Dec 1 the guide is "Holiday Deals" (page, landing slot and head);
 *   - the data holds only READY deals (an affiliate link that reaches the brand's sale), never a price, each section
 *     sorted by our commission and at most 25.
 *
 * @mutate src/content/giftGuideDeals.mjs |   if (deal.ends && deal.ends < today) return false; |   if (deal.ends && deal.ends < "2000-01-01") return false;
 * @mutate src/content/giftGuideDeals.mjs |   if (deal.status === "announced" && deal.starts && deal.starts > today) return false; |   if (deal.status === "announced" && deal.starts && deal.starts > "2099-01-01") return false;
 * @mutate src/content/giftGuideDeals.mjs |   return today >= FEATURE_FROM && today <= FEATURE_TO; |   return today <= FEATURE_TO;
 * @mutate src/content/giftGuideDeals.mjs |   return today > RETITLE_AFTER ? DEALS_WORDS.laterTitle : DEALS_WORDS.title; |   return DEALS_WORDS.title;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |   const sections = deals ? dealSections(liveDeals(deals, today)) : []; |   const sections = deals ? dealSections(deals) : [];
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       {!group && <DealsFeature />} |       {null}
 * @mutate api/share.ts |     if (slug === DEALS_SLUG) { |     if (slug === "no-such-guide") {
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DEALS from "@/content/giftGuideDeals.json";
import {
  DEAL_CATEGORIES, DEALS_PER_SECTION, DEALS_SLUG, DEALS_WORDS, dealShows, dealsFeatured, dealsTitle, louisianaDay, type Deal,
} from "@/content/giftGuideDeals.mjs";
import { dealsPageMeta, publicOrGiftGuidePageMetaFor } from "@/lib/giftGuidePageMeta.mjs";
import { buildDeals, type DealSources, type RawDeal } from "../../scripts/gift-guide-deals.mjs";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { DealsFeature, GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";

const deals = DEALS as Deal[];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Noon in Louisiana on a YYYY-MM-DD day (18:00Z in CST). */
const noon = (ymd: string) => new Date(`${ymd}T18:00:00Z`);

const renderDeals = (ymd: string) =>
  render(
    <MemoryRouter>
      <GiftGuideDeals now={noon(ymd)} />
    </MemoryRouter>,
  );
const shownBrands = async (ymd: string) => {
  const { container } = renderDeals(ymd);
  await screen.findAllByText(DEALS_WORDS.shop(deals[0].brand));
  return [...container.querySelectorAll("[data-gift-deal]")].map((li) => li.getAttribute("data-gift-deal"));
};

describe("deals guide: the data", () => {
  it("holds the ready deals only, in known sections, at most 25 each, never a price", () => {
    expect(deals.length).toBeGreaterThan(40);
    for (const d of deals) {
      expect(DEAL_CATEGORIES, d.brand).toContain(d.category);
      expect(d, d.brand).not.toHaveProperty("price");
      expect(d.deal.length, d.brand).toBeGreaterThan(5);
      expect(d.deal, d.brand).not.toMatch(/\bowner\b/i);
      expect(["live", "announced"]).toContain(d.status);
      for (const k of ["starts", "ends"] as const) if (d[k]) expect(d[k], `${d.brand} ${k}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const c of DEAL_CATEGORIES) expect(deals.filter((d) => d.category === c).length, c).toBeLessThanOrEqual(DEALS_PER_SECTION);
    // The 11 with no affiliate link and the 12 whose link reaches another store (lead 2026-11-19) are left out; follow-up
    // 1120 (_bfcm-deals-1120.json skipped_fixed) gave Aurate, Quip, Good American, Summer Fridays and Le Creuset their
    // own-store links, so they are in; Kendra Scott is blocked (owner 11-20) and the weak picks dropped.
    for (const brand of ["Stokke", "UGG", "Kendra Scott", "Hydro Flask", "Ariat", "Academy Sports + Outdoors", "GreenPan", "Oura", "Lovesac"]) {
      expect(deals.map((d) => d.brand), brand).not.toContain(brand);
    }
  });

  it("every link is an affiliate link we hold; every Amazon link carries our tag", () => {
    const hosts = new Set(["go.shopmy.us", "www.amazon.com", "www.anrdoezrs.net", "click.linksynergy.com"]);
    for (const d of deals) {
      const u = new URL(d.href);
      expect(u.protocol, d.brand).toBe("https:");
      expect(hosts.has(u.hostname), `${d.brand} ${u.hostname}`).toBe(true);
      if (u.hostname === "www.amazon.com") {
        expect(u.searchParams.get("tag"), d.brand).toBe("louisianahelpr-20");
        expect(d.store).toBe("Amazon");
      }
      if (d.image) expect(new URL(d.image).hostname, d.brand).not.toMatch(/^[a-z0-9-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/);
    }
  });

  it("the generator keeps ready deals, swaps in a brand's own-store link, drops ended ones, sorts by commission", () => {
    const raw = (brand: string, extra: Partial<RawDeal> = {}): RawDeal => ({ brand, deal_text: `${brand} 30% off sitewide`, href: `https://go.shopmy.us/p-${brand}`, status: "live", source: `https://${brand.toLowerCase()}.com`, ...extra });
    const src: DealSources = {
      deals: {
        categories: {
          Beauty: [
            raw("Low"), raw("High"), raw("NoLink", { needs_link: true, href: undefined }),
            raw("Elsewhere", { deal_works_on_our_link: false }), raw("Swapped", { deal_works_on_our_link: false }),
            raw("Ended", { ends: "2026-11-18" }), raw("LastDay", { ends: "2026-11-19" }), raw("Soon", { status: "announced", starts: "2026-11-26" }),
          ],
        },
      },
      brandLinks: {
        Low: [{ href: "https://go.shopmy.us/p-Low", commission_pct: "5%" }],
        High: [{ href: "https://go.shopmy.us/p-High", commission_pct: "20%" }],
        Swapped: [{ href: "https://go.shopmy.us/p-own", commission_pct: "12%", store: "swapped.com", name: "Own" }],
      },
      campaigns: [],
    };
    const { deals: out, skipped } = buildDeals(src, "2026-11-19");
    expect(out.map((d) => d.brand)).toEqual(["High", "Swapped", "Low", "LastDay", "Soon"]);
    expect(out.find((d) => d.brand === "Swapped")!.href).toBe("https://go.shopmy.us/p-own");
    expect(skipped).toEqual({ noLink: ["NoLink"], otherStore: ["Elsewhere"], ended: ["Ended"] });
  });
});

describe("deals guide: a deal hides itself", () => {
  it("dealShows: through its end day, never after; an announced deal only from its start day", () => {
    expect(dealShows({ ends: "2026-11-28", status: "live" }, "2026-11-28")).toBe(true);
    expect(dealShows({ ends: "2026-11-28", status: "live" }, "2026-11-29")).toBe(false);
    expect(dealShows({ starts: "2026-11-26", status: "announced" }, "2026-11-25")).toBe(false);
    expect(dealShows({ starts: "2026-11-26", status: "announced" }, "2026-11-26")).toBe(true);
    // A live deal (seen on the brand's site) shows before a stated start day.
    expect(dealShows({ starts: "2026-11-20", status: "live" }, "2026-11-19")).toBe(true);
  });

  it("the page drops a deal after its end day and shows an announced one only from its start day", async () => {
    const muck = deals.find((d) => d.brand === "Muck Boot")!;
    expect(muck.ends).toBe("2026-11-28");
    expect(await shownBrands("2026-11-28")).toContain("Muck Boot");
    cleanup();
    expect(await shownBrands("2026-11-29")).not.toContain("Muck Boot");
    cleanup();
    const rare = deals.find((d) => d.brand === "Rare Beauty")!;
    expect([rare.status, rare.starts]).toEqual(["announced", "2026-11-26"]);
    expect(await shownBrands("2026-11-25")).not.toContain("Rare Beauty");
    cleanup();
    expect(await shownBrands("2026-11-26")).toContain("Rare Beauty");
  });

  it("each card: brand, deal, a CODE chip when there is a code, its end day, a Shop link; no price", async () => {
    const { container } = renderDeals("2026-11-21");
    await screen.findAllByText(DEALS_WORDS.shop(deals[0].brand));
    const brooklinen = container.querySelector('[data-gift-deal="Brooklinen"]')!;
    expect(brooklinen.querySelector("[data-gift-deal-code] code")!.textContent).toBe("BFCM26");
    const stanley = container.querySelector('[data-gift-deal="Stanley"]')!;
    expect(stanley.querySelector("[data-gift-deal-dates]")!.textContent).toBe("Ends Nov 30");
    expect(stanley.querySelector("[data-gift-deal-code]")).toBeNull();
    for (const a of container.querySelectorAll("[data-gift-deal] a")) expect(a.getAttribute("rel")).toBe("sponsored noopener");
    // No price line or price element (the deal words may name a spend tier, "$85+", which is the brand's offer).
    expect(container.querySelector("[data-gift-price], .gg-price")).toBeNull();
    expect(container.querySelector("[data-gift-deals-ad]")!.textContent).toBe("#ad, some links earn us a small commission.");
    // Sections in the brief's order.
    const order = [...container.querySelectorAll("[data-gift-deal-section]")].map((s) => s.getAttribute("data-gift-deal-section"));
    expect(order).toEqual(DEAL_CATEGORIES.filter((c) => order.includes(c)));
    expect(order.slice(0, 3)).toEqual(["Beauty", "Home & Kitchen", "Fashion"]);
  });
});

describe("deals guide: the landing's featured slot and the retitle", () => {
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

  it("sits at the very top of the landing, above the quick picks, inside the window only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(noon("2026-11-24"));
    const { container } = render(
      <MemoryRouter initialEntries={["/gift-guides"]}>
        <Routes><Route path="/gift-guides" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    const slot = container.querySelector("[data-gift-deals-feature]")!;
    const quick = container.querySelector("[data-gift-quick-picks]")!;
    expect(slot).not.toBeNull();
    expect(slot.compareDocumentPosition(quick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.textContent).toContain(DEALS_WORDS.title);
    cleanup();
    vi.setSystemTime(noon("2026-11-20"));
    const later = render(
      <MemoryRouter initialEntries={["/gift-guides"]}>
        <Routes><Route path="/gift-guides" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    expect(later.container.querySelector("[data-gift-deals-feature]")).toBeNull();
  });

  it("is Black Friday & Cyber Monday Deals through Dec 1, then Holiday Deals (page, slot, head)", () => {
    expect(dealsTitle("2026-11-19")).toBe("Black Friday & Cyber Monday Deals");
    expect(dealsTitle("2026-12-01")).toBe("Black Friday & Cyber Monday Deals");
    expect(dealsTitle("2026-12-02")).toBe("Holiday Deals");
    expect(feature(noon("2026-12-01"))!.textContent).toContain("Black Friday & Cyber Monday Deals");
    expect(dealsPageMeta(noon("2026-11-24")).title).toBe("Black Friday & Cyber Monday Deals — Helpr");
    expect(dealsPageMeta(noon("2026-12-02")).title).toBe("Holiday Deals — Helpr");
  });

  it("the guide's page opens (never redirected to the landing) under the day's title; its head is indexed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(noon("2026-12-03"));
    const { container } = render(
      <MemoryRouter initialEntries={[`/gift-guides/${DEALS_SLUG}`]}>
        <Routes>
          <Route path="/gift-guides" element={<p data-landing="" />} />
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-landing]")).toBeNull();
    expect(container.querySelector("h1")!.textContent).toBe("Holiday Deals");
    expect(container.querySelector("[data-gift-deals-page]")).not.toBeNull();
    const head = publicOrGiftGuidePageMetaFor(`/gift-guides/${DEALS_SLUG}`, null)!;
    expect(head.canonical).toBe(`https://www.louisianahelpr.com/gift-guides/${DEALS_SLUG}`);
    expect(head).not.toHaveProperty("robots");
  });

  it("the pre-JS page (api/share.ts) answers 200 with the guide's name, body and its own share card, never a 404", async () => {
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
    const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=gift-guides/${DEALS_SLUG}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    const title = dealsTitle(louisianaDay(new Date()));
    expect(html).toContain(`<meta property="og:image" content="https://www.louisianahelpr.com/gift-guides/deals/${DEALS_SLUG}.jpg"`);
    expect(html).toContain(`<h1>${title.replace(/&/g, "&amp;")}</h1>`);
    expect(existsSync(`public/gift-guides/deals/${DEALS_SLUG}.jpg`)).toBe(true);
    expect(existsSync(`public/gift-guides/deals/${DEALS_SLUG}.webp`)).toBe(true);
  });
});
