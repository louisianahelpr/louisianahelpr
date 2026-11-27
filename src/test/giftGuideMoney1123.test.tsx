// @mutate src/content/giftGuideCodes.json | "code":"","offer":"25% off sitewide, no code needed | "code":"GREEN20","offer":"25% off sitewide, no code needed
// @mutate src/content/giftGuideCodes.json | "dates":"From Dec 2","starts":"2026-12-02", | "dates":"From Dec 2",
// @mutate src/content/giftGuideCodes.json | "dates":"Nov 20 – Dec 6","starts":"2026-11-20","expires":"2026-12-06", | "dates":"Nov 20 – Dec 6",
// @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | {best.code && <CodeChip code={best.code} />} | <CodeChip code={best.code} />
// @mutate src/content/giftGuideDeals.json | "deal":"30% off sitewide; 20% off custom gifts" | "deal":"20% off custom gifts"
// @mutate src/content/giftGuideDeals.json | "code":"LETSGO","ends":"2026-12-02" | "code":"LETSGO"
/**
 * Money audit 2026-11-23 (~/Desktop/Louisiana Helpr Work/Gift guides and affiliate/Audit-affiliate-links-1123.md, skeptic-
 * confirmed in ~/.lh-shots/night-audits-1123-result.json), the deals pages' code and deal data:
 *   - Bruno Marc (F4 + inbox watch): 25% off sitewide with NO code, Nov 23 - Dec 1 (CJ member mail, Commission-offers-log
 *     Nov 23). The card shows the sale with its dates and no copy chip; GREEN20 (likely won't stack) steps aside for the
 *     window and comes back Dec 2. Before: the card showed GREEN20 "20% off sitewide" with no dates.
 *   - Durango TAKE30 (F8): Nov 20 - Dec 6 (Affiliate-approvals-1117.md). Before: no dates, so it never hid.
 *   - BaubleBar deal card (F7): 30% off sitewide plus 20% off custom gifts, Nov 23 - Dec 1 (baublebar.com banner read
 *     2026-11-23; dates from ShopMy Latest). Before: "Beat Black Friday: 20% off custom gifts", no end.
 *   - Madewell LETSGO (F10): ends Dec 2 (ShopMy Latest, ShopMy-codes-1121-night.md). Before: no end date.
 * Inventory floor: the codes list and the deals file each hold more than 10 rows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { activeCodes, discountCodes } from "@/content/giftGuides";
import { CodeCards } from "@/pages/info/giftGuides/GiftGuideDealCards";

type Deal = { brand: string; deal: string; code?: string; starts?: string; ends?: string };
const DEALS = (JSON.parse(readFileSync("src/content/giftGuideDeals.json", "utf8")) as { deals?: Deal[] } & Record<string, unknown>);
const dealRows = (): Deal[] => (Array.isArray(DEALS) ? DEALS : Object.values(DEALS).find(Array.isArray)) as Deal[];
const on = (store: string, day: string) => activeCodes(discountCodes, day).filter((c) => c.store === store);

describe("money audit 1123: deals codes and cards", () => {
  it("inventory floor", () => {
    expect(discountCodes.length).toBeGreaterThan(10);
    expect(dealRows().length).toBeGreaterThan(10);
  });

  it("Bruno Marc: the no-code 25% sale Nov 23 - Dec 1, GREEN20 back from Dec 2", () => {
    for (const day of ["2026-11-23", "2026-11-27", "2026-12-01"]) {
      const list = on("Bruno Marc", day);
      expect(list.map((c) => c.code), day).toEqual([""]);
      expect(list[0].offer, day).toMatch(/25% off sitewide, no code needed/);
    }
    expect(on("Bruno Marc", "2026-12-02").map((c) => c.code)).toEqual(["GREEN20"]);
  });

  it("Bruno Marc's sale card shows the sale and its end day, with nothing to copy", () => {
    const { container } = render(<MemoryRouter><CodeCards codes={on("Bruno Marc", "2026-11-25")} /></MemoryRouter>);
    const card = container.querySelector('[data-gift-code-store="Bruno Marc"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toMatch(/25% off sitewide, no code needed/);
    expect(card!.textContent).toMatch(/Dec 1/);
    expect(card!.querySelector("code")).toBeNull();
    expect(card!.textContent).not.toMatch(/GREEN20/);
  });

  it("Durango TAKE30 shows Nov 20 - Dec 6 only", () => {
    expect(on("Durango Boots", "2026-11-20").map((c) => c.code)).toEqual(["TAKE30"]);
    expect(on("Durango Boots", "2026-12-06").map((c) => c.code)).toEqual(["TAKE30"]);
    expect(on("Durango Boots", "2026-12-07")).toEqual([]);
    expect(on("Durango Boots", "2026-11-19")).toEqual([]);
  });

  it("BaubleBar's card names the 30% sitewide event through Dec 1; Madewell's LETSGO ends Dec 2", () => {
    const bauble = dealRows().find((d) => d.brand === "BaubleBar")!;
    // Polish audit 1127 #18: the offer only (the page names the day, the date line says Dec 1).
    expect(bauble.deal).toBe("30% off sitewide; 20% off custom gifts");
    expect(bauble.ends).toBe("2026-12-01");
    const madewell = dealRows().find((d) => d.brand === "Madewell" && d.code === "LETSGO")!;
    expect(madewell.ends).toBe("2026-12-02");
  });
});
