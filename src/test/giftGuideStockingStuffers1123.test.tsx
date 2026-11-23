/**
 * Owner 2026-11-23 (pop-up "Under 10"): Her, Him and Kids each open with a first section "Stocking stuffers under $10"
 * holding every pick in that guide whose card reads under $10 (new and existing), cheapest first; the price sections
 * follow as before, and every section opens expanded. ONE rule (src/lib/pickPriceShown.mjs STOCKING_SECTION_ID, first
 * in PRICE_SECTIONS) shared by the page (GiftGuideView.tsx priceSections) and the Q&A counts (src/lib/guideQa.mjs).
 * Also: the owner's 11-23 Amazon keeps (14 For Him, 16 For Kids) are on their guides with the tagged link.
 *
 * @mutate src/lib/pickPriceShown.mjs |   { id: "stocking-stuffers", max: 10 }, |   { id: "stocking-stuffers", max: 0 },
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const grouped = [...stocking, ...order.filter((id) => id !== STOCKING_SECTION_ID) |   const grouped = [...order.filter((id) => id !== STOCKING_SECTION_ID)
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const stocking = sortByPrice(priced.filter((p) => priceSectionOf(p) === STOCKING_SECTION_ID), "low"); | const stocking = sortByPrice(priced.filter((p) => priceSectionOf(p) === STOCKING_SECTION_ID), "high");
 * @mutate src/lib/guideQa.mjs |   const stocking = band("stocking-stuffers"); |   const stocking = band("under-25");
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/content/giftGuideEarnRank.json", () => ({ default: { ranks: {} } }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { guideBySlug, loadGuidePicks } from "@/content/giftGuideCatalog";
import { catalogGuideQa, toQaPick } from "@/lib/guideQa.mjs";
import { PRICE_SECTIONS, pickPriceShown, priceSectionId } from "@/lib/pickPriceShown.mjs";
import { pickAnchor } from "@/content/giftGuidePickAnchor";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";

const TODAY = "2026-11-23";
const GUIDES = ["her", "him", "kids"] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T18:00:00Z`));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The page's arithmetic written out: a card reads rounded dollars, at least $1; under $10 is stocking. */
const dollars = (p: number) => Math.max(1, Math.round(p));
async function expectedStocking(slug: string) {
  await loadGuidePicks(slug);
  const picks = guideBySlug(slug)!.picks.filter((p) => p.name && pickPriceShown(p.price, p.priceAt, TODAY));
  return picks
    .filter((p) => dollars(p.price!) < 10)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.price! - b.p.price! || a.i - b.i)
    .map(({ p }) => p);
}

describe("the shared rule", () => {
  it("stocking stuffers come first and hold cards that read under $10", () => {
    expect(PRICE_SECTIONS[0]).toEqual({ id: "stocking-stuffers", max: 10 });
    expect(priceSectionId(9.4)).toBe("stocking-stuffers");
    expect(priceSectionId(9.56)).toBe("under-25"); // reads "~$10"
    expect(priceSectionId(12)).toBe("under-25");
  });
});

describe("Her, Him and Kids open with Stocking stuffers under $10", () => {
  for (const slug of GUIDES) {
    it(`${slug}: the first section is the stocking stuffers, exactly the picks under $10, cheapest first, open`, async () => {
      const want = await expectedStocking(slug);
      expect(want.length, slug).toBeGreaterThan(4); // her 6, him 14, kids 5 on 2026-11-23
      const { container } = render(
        <MemoryRouter initialEntries={[`/gift-guides/${slug}`]}>
          <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(container.querySelector("section.gg-sec")).not.toBeNull(), { timeout: 8000 });
      const first = container.querySelector("section.gg-sec")!;
      expect(first.id).toBe("gg-sec-stocking-stuffers");
      expect(first.textContent).toContain("Stocking stuffers under $10");
      expect(first.textContent).toContain(`(${want.length})`);
      expect(first.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
      const rows = [...first.querySelectorAll("li[data-gift-pick]")].map((li) => li.id);
      expect(rows).toEqual(want.map((p) => pickAnchor(p.name)));
      // Nothing under $10 is left in a later section, and the section after it is Under $25.
      const later = [...container.querySelectorAll("section.gg-sec")].slice(1);
      expect(later[0].id).toBe("gg-sec-under-25");
      const laterIds = new Set(later.flatMap((s) => [...s.querySelectorAll("li[data-gift-pick]")].map((li) => li.id)));
      for (const p of want) expect(laterIds.has(pickAnchor(p.name)), p.name).toBe(false);
    }, 20000);
  }

  it("the Q&A's stocking-stuffer count equals the section's", async () => {
    for (const slug of GUIDES) {
      const want = await expectedStocking(slug);
      const qa = catalogGuideQa(slug, guideBySlug(slug)!.picks.filter((p) => p.name).map(toQaPick), TODAY);
      expect(qa.find((x) => /stocking stuffers .* under \$10\?$/.test(x.q))!.a, slug).toContain(`This guide opens with ${want.length} stocking stuffers under $10.`);
    }
  });
});

describe("the owner's 11-23 Amazon keeps are on their guides", () => {
  const HIM = ["B0HDDLPQV5", "B002ZK45IQ", "B003IWI66W", "B0070XAL0E", "B000O8OTNC", "B01HRCU3SW", "B009IH0ICG", "B001E5FLT0", "B0G4XRP464", "B0CXGXT6W8", "B0C6XK77HJ", "B0G6GTRHCJ", "B07JCQ8GQJ", "B0DHT5XZR1"];
  const KIDS = ["B0DSCL9N58", "B083XNCRS3", "B0CBT2N7N1", "B078WM314M", "B0831R88S6", "B0HHL1768V", "B0CSYGLWN5", "B083QZLSXS", "B0G441FJ3G", "B0B4YWYGXG", "B082PZND3V", "B07ZYCKR15", "B001Q3KU9Q", "B0BRTCTT6X", "B0CRC73JTS", "B0CSP7M219"];
  for (const [name, list, asins] of [["him", him.picks, HIM], ["kids", kids.picks, KIDS]] as const) {
    it(`${name}: each keep once, with the tagged Amazon link, a price and today's check`, () => {
      expect(asins.length).toBeGreaterThan(13);
      for (const a of asins) {
        const rows = (list as { href: string; price: number; priceAt: string; image: string }[]).filter((p) => p.href.includes(`/dp/${a}`));
        expect(rows.length, a).toBe(1);
        expect(rows[0].href).toBe(`https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`);
        expect(rows[0].price).toBeGreaterThan(0);
        expect(rows[0].priceAt).toBe("2026-11-23");
        expect(rows[0].image).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\/[^/]+\._SL500_\.jpg$/);
      }
    });
  }
});
