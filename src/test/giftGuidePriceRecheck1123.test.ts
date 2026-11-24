/**
 * The daily price re-check (scripts/giftGuidePriceRecheck.mjs, price-refresh-1123). The owner wants every Her, Him and
 * Kids price shown with its as-of day (owner 2026-11-21, "each item also needs a price"), and the page hides a price 30
 * days after its check (src/lib/pickPriceShown.mjs), so the daily job re-reads each pick's product page. When the price
 * it reads equals the one shown, the link goes in PRICE_RECHECKS with the check day, and the builders apply it last.
 * Nothing is regenerated, so hand edits stay. This guard keeps a re-check honest:
 *  - every entry is a real pick on Her, Him or Kids at EXACTLY the entry's price (a re-check never changes a price);
 *  - the committed page shows the entry's day on every pick with that link, and so does what the builders build;
 *  - a re-check at a different price, or an older day, never moves a date.
 * @mutate scripts/giftGuidePriceRecheck.mjs | "https://go.shopmy.us/p-109205223": { price: 148, | "https://go.shopmy.us/p-109205223": { price: 149,
 * @mutate scripts/giftGuideHimKids1121.mjs | : recheckedPriceAt(r.href, shown, r.priceAt ?? HIM_KIDS_PRICE_AT) }); | : r.priceAt ?? HIM_KIDS_PRICE_AT });
 * @mutate scripts/giftGuidePriceRecheck.mjs | if (!r \|\| r.price !== price \|\| | if (!r \|\|
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICE_RECHECKS, recheckedPriceAt } from "../../scripts/giftGuidePriceRecheck.mjs";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";

type Pick = { name: string; href: string; price?: number; priceAt?: string };
const LISTS = ["her", "him", "kids"] as const;
const page = (slug: string): Pick[] => JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")).picks;
const built: Record<string, Pick[]> = { her: her1121Picks(), him: him1121Picks(), kids: kids1121Picks() };
const entries = Object.entries(PRICE_RECHECKS);

describe("daily price re-checks (price-refresh-1123)", () => {
  it("every re-check is a real Her/Him/Kids pick at exactly its price, never an Amazon link", () => {
    expect(entries.length).toBeGreaterThan(50); // inventory floor: 73 links re-read on 2026-11-23
    for (const [href, r] of entries) {
      expect(r.priceAt, href).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(href, href).not.toMatch(/amazon\.com|amzn\.|a\.co\//);
      const hits = LISTS.flatMap((slug) => page(slug).filter((p) => p.href === href));
      expect(hits.length, `${href} is on no owner list`).toBeGreaterThan(0);
      for (const p of hits) expect(p.price, `${p.name}: the re-check read ${r.price}`).toBe(r.price);
    }
  });

  it("the committed page and the builders both show the re-check day on every pick with that link", () => {
    let moved = 0;
    for (const slug of LISTS) {
      for (const list of [page(slug), built[slug]]) {
        for (const p of list) {
          const r = PRICE_RECHECKS[p.href];
          if (!r) continue;
          expect(p.priceAt, `${slug}: ${p.name}`).toBe(r.priceAt);
          moved++;
        }
      }
    }
    expect(moved).toBeGreaterThan(100); // 74 picks x (page + build) on 2026-11-23
  });

  it("only a same-price, newer re-check moves a day", () => {
    const [href, r] = entries[0]!;
    expect(recheckedPriceAt(href, r.price, "2026-11-01")).toBe(r.priceAt);
    expect(recheckedPriceAt(href, r.price + 1, "2026-11-01")).toBe("2026-11-01");
    expect(recheckedPriceAt(href, r.price, "2099-01-01")).toBe("2099-01-01");
    expect(recheckedPriceAt("https://example.com/not-a-pick", 10, "2026-11-01")).toBe("2026-11-01");
  });
});
