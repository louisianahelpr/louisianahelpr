/**
 * Owner 2026-11-22 (her screenshot of /gift-guides/25-days-sponsors at 375, the "Also sponsoring" names running off the
 * screen): "Find images from their Facebook or use there logo so all are included". Every sponsor that line named is a
 * real row on the sponsors guide, like the others:
 *   - THE PASS (scripts/giftGuideHolidayB1120.mjs): a lineup sponsor with no gift card gets a logo card (its logo from
 *     the sponsor logo row, the gift it gives, its site or page) instead of a name-only line;
 *   - THE CHUNK: the sponsors guide names nobody; each logo card says its gift with no dollar amount and no giveaway day
 *     (the days are not final), carries no price (only a captured price shows), links https on an allowed host, and
 *     shows a small local logo file (lazy, 160 px) or its name tile; no removed sponsor shows;
 *   - THE ROW: the gift sits under the name where a price would be; no "Also sponsoring" line is drawn on that page.
 * @mutate scripts/giftGuideHolidayB1120.mjs | pick ??= logoCard(brand); | pick ??= undefined;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {pick.gift && !showsPrice(pick) ? | {false ?
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-nm .gg-nm-gift{grid-column:1/-1;grid-row:2; | .gg-list .gg-nm .gg-nm-gift{grid-column:2;grid-row:1;
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { applyHolidayB1120 } from "../../scripts/giftGuideHolidayB1120.mjs";
import { NATIONAL_SPONSOR_SITES, SPONSOR_SITES } from "@/content/giftGuides";
import { guideBySlug, loadGuidePicks } from "@/content/giftGuideCatalog";
import GiftGuides from "@/pages/info/GiftGuides";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

type Card = { name: string; brand?: string; line?: string; href: string; image?: string; gift?: string; price?: number; priceAt?: string; store?: string };
const CHUNK = JSON.parse(readFileSync("src/content/giftGuidePicks/25-days-sponsors.json", "utf8")) as { picks: Card[] };
const MOD = readFileSync("src/content/giftGuidePicks.ts", "utf8");
const NAME_ONLY = JSON.parse(/NAME_ONLY_SPONSORS: Record<string, string\[\]> = (\{.*?\});/.exec(MOD)![1]) as Record<string, string[]>;
const SPEC = JSON.parse(readFileSync("scripts/gift-guide-holiday-b-1120.json", "utf8")) as { sponsorLogoCards: Record<string, { gift: string; href?: string; image?: string }> };
const logoCards = CHUNK.picks.filter((p) => p.gift);

describe("25 Days sponsors guide: every sponsor is a row (owner 11-22)", () => {
  it("the pass turns a sponsor with no gift card into a logo card, never a name-only line", () => {
    const pageList: Record<string, Card[]> = { "25-days-sponsors": [{ name: "Gift Set", brand: "Shop A", line: "A gift.", href: "https://shopa.com/x", image: "https://x.test/a.webp" }] };
    const nameOnly: { guide: string; brand: string }[] = [];
    const spec = {
      sponsorGroups: { "Louisiana Shops & Makers": { id: "louisiana-shops", brands: [] } },
      sponsorDefaultGroup: "Louisiana Shops & Makers",
      sponsorLogoCards: { "Shop B": { gift: "Gift card" }, "Shop C": { gift: "Candle", href: "https://shopc.test/" } },
    };
    const ctx = {
      sponsorsGuide: "25-days-sponsors", nameOnly, lineup: ["Shop A", "Shop B", "Shop C", "Shop D"],
      sponsorLogos: [{ name: "Shop B", logo: "https://www.louisianahelpr.com/gift-guides/sponsors/shop-b.webp", href: "https://www.facebook.com/shopb", external: true }, { name: "Shop C", href: "/gift-guides/25-days-sponsors" }],
      readJson: () => null, sales: [], dealCodes: [], storePages: [], thinFold: false, merges: [], anchors: {}, sortFixed: new Set<string>(), aliases: {},
    };
    const t = applyHolidayB1120(pageList, {}, spec, ctx);
    const rows = pageList["25-days-sponsors"].map((p) => [p.name, p.gift ?? null, p.image ?? null, p.href, p.price ?? null]);
    expect(rows).toEqual([
      ["Gift Set", null, "https://x.test/a.webp", "https://shopa.com/x", null],
      ["Shop B", "Gift card", "https://www.louisianahelpr.com/gift-guides/sponsors/shop-b.webp", "https://www.facebook.com/shopb", null],
      ["Shop C", "Candle", null, "https://shopc.test/", null],
    ]);
    // A sponsor with no logo card rule is still named (never silently dropped).
    expect(nameOnly).toEqual([{ guide: "25-days-sponsors", brand: "Shop D" }]);
    expect(t.counts.logoCards).toBe(2);
  });

  it("the sponsors guide names nobody; every rule became a card with its gift, link and logo", () => {
    expect(NAME_ONLY["25-days-sponsors"]).toBeUndefined();
    // 64 names on the old "Also sponsoring" line, measured 2026-11-22.
    expect(logoCards.length).toBeGreaterThan(60);
    expect(logoCards.length).toBe(Object.keys(SPEC.sponsorLogoCards).length);
    const hosts = new Set<string>([...SPONSOR_SITES, ...NATIONAL_SPONSOR_SITES]);
    for (const p of logoCards) {
      expect(p.gift!.length, p.name).toBeGreaterThan(2);
      // No dollar amount (only a captured price is a price) and no giveaway day (the days are not final).
      expect(`${p.name} ${p.gift} ${p.line}`, p.name).not.toMatch(/\$\s?\d/);
      expect(`${p.name} ${p.gift} ${p.line}`, p.name).not.toMatch(/\b(dec(ember)?|nov(ember)?|jan(uary)?)\.?\s*\d|\bday \d|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i);
      expect(p.price, p.name).toBeUndefined();
      expect(p.priceAt, p.name).toBeUndefined();
      expect(p.store, p.name).toBe("sponsor");
      const u = new URL(p.href);
      expect(u.protocol, p.name).toBe("https:");
      expect(hosts.has(u.hostname), `${p.name}: ${p.href}`).toBe(true);
      if (!p.image) continue;
      expect(p.image, p.name).toMatch(/^https:\/\/www\.louisianahelpr\.com\/gift-guides\/(sponsors|sponsor-picks)\/[a-z0-9-]+\.webp$/);
      const file = resolve("public", new URL(p.image).pathname.slice(1));
      expect(existsSync(file), p.name).toBe(true);
      // A 160 px logo stays small (1-6 KB measured 2026-11-22).
      expect(statSync(file).size, p.name).toBeLessThan(12_000);
    }
  });

  it("no removed or unconfirmed sponsor shows on the sponsors guide", () => {
    const text = JSON.stringify(CHUNK);
    for (const gone of [/Bourque/i, /Kee's/i, /Humble Home/i, /Rusty's/i, /HOTWORX Baton Rouge/i, /Bully Made/i, /Oil Center/i, /R&R Wedding/i]) expect(text, String(gone)).not.toMatch(gone);
  });

  it("the row says the gift under the name, and no names-only line is drawn", async () => {
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-nm .gg-nm-gift{grid-column:1/-1;grid-row:2;");
    await loadGuidePicks("25-days-sponsors");
    const n = guideBySlug("25-days-sponsors")!.picks.filter((p) => p.gift).length;
    expect(n).toBe(logoCards.length);
    const { container } = render(
      <MemoryRouter initialEntries={["/gift-guides/25-days-sponsors"]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    const gifts = [...container.querySelectorAll("[data-gift-sponsor-gift]")];
    expect(gifts.length).toBe(n);
    expect(container.querySelector("[data-gift-also-sponsoring]")).toBeNull();
    const birdwell = container.querySelector<HTMLAnchorElement>('a[href^="https://www.shopbirdwells.com"]')!;
    expect(birdwell.querySelector("[data-gift-sponsor-gift]")?.textContent).toBe("Gift card");
    expect(birdwell.querySelector("[data-gift-price]")).toBeNull();
    expect(birdwell.querySelector("img")?.getAttribute("loading")).toBe("lazy");
  });
});
