/**
 * Owner 2026-10-30, on their own listing: "Don't show the next possible drops ... I put it should never drop"; "I would
 * also rather my listing be on the high end"; the four statements "only need to be 1 check box".
 *
 * The class, not just the screen:
 *   - a listing whose lowest price is its price is saved as drops off (buyers read drop_pct, never the lowest price);
 *   - what the form says before Post is what it saves;
 *   - "Never" under make-it-free says it is about free only;
 *   - every sell form takes the four statements through the ONE shared box (inventory: every source file naming them);
 *   - the suggested price asks for the high end of fair, and the sold-price range only bounds it.
 *
 * @mutate src/components/declutter/sellForm.ts | return { floorCents: floor, dropPct: floor === price ? 0 : f.dropPct }; | return { floorCents: floor, dropPct: f.dropPct };
 * @mutate src/lib/declutter/priceDrop.ts |   return state.drops_stopped \|\| state.floor_price_cents >= currentCents; |   return state.drops_stopped;
 * @mutate src/lib/declutter/autoFree.ts | if (days === null) return "It won't become free on its own. This has nothing to do with price drops."; | if (days === null) return "It stays at your price until it sells or you change it.";
 * @mutate supabase/functions/declutter-ai-draft/index.ts | so pick the HIGH end of the fair range for this exact item, not the middle. | so pick a fair price for a quick local sale.
 * @mutate src/components/declutter/useSavedPickup.ts |     .filter((p) => p.address.trim() && p.area.trim() && Number.isFinite(p.lat) && Number.isFinite(p.lng)); |     .filter((p) => p.address.trim() && p.area.trim());
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { dropsOutcomeLine, DROPS_SWITCH_LABEL, priceChoiceToSave } from "@/components/declutter/sellForm";
import { pickupFromPlaces } from "@/components/declutter/useSavedPickup";
import { TAX_STATEMENTS, TAX_TICK_LABEL } from "@/components/declutter/declutterUi";
import { sellerStateStopsDrops } from "@/lib/declutter/priceDrop";
import { AUTO_FREE_OPTIONS, autoFreeExplainer, autoFreeOutcomeLine } from "@/lib/declutter/autoFree";
import { groundPrice, sanitizeDraft } from "../../supabase/functions/declutter-ai-draft/sanitize";

const form = (over: Partial<Parameters<typeof priceChoiceToSave>[0]>) => ({ free: false, price: "45", floor: "35", drops: true, dropPct: 5, ...over });
const code = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));

describe("a listing that can't drop says nothing about drops", () => {
  it("a lowest price at the price is saved as off, whatever the switch says", () => {
    expect(priceChoiceToSave(form({ floor: "45" }))).toEqual({ floorCents: 4500, dropPct: 0 });
    expect(priceChoiceToSave(form({ drops: false }))).toEqual({ floorCents: 4500, dropPct: 0 });
    expect(priceChoiceToSave(form({}))).toEqual({ floorCents: 3500, dropPct: 5 });
  });

  it("the seller's own read: stopped, or at the lowest price, can't drop", () => {
    expect(sellerStateStopsDrops({ floor_price_cents: 4500, drops_stopped: false }, 4500)).toBe(true);
    expect(sellerStateStopsDrops({ floor_price_cents: 3500, drops_stopped: true }, 4500)).toBe(true);
    expect(sellerStateStopsDrops({ floor_price_cents: 3500, drops_stopped: false }, 4500)).toBe(false);
  });
});

describe("the form can't be misread as never-drop", () => {
  it("names the switch plainly and says what will be saved", () => {
    expect(DROPS_SWITCH_LABEL).toBe("Lower the price over time");
    expect(dropsOutcomeLine(form({}))).toBe("Price drops: on, 5% each evening, never below $35.");
    expect(dropsOutcomeLine(form({ drops: false }))).toBe("Price drops: off. It stays at $45 until you change it.");
    expect(dropsOutcomeLine(form({ floor: "45" }))).toBe("Price drops: off. It stays at $45 until you change it.");
    expect(dropsOutcomeLine(form({ price: "1", floor: "" }))).toMatch(/^Price drops: off/);
    expect(dropsOutcomeLine(form({ free: true }))).toBeNull();
  });

  it("Never under make-it-free is about free, never about the price", () => {
    expect(AUTO_FREE_OPTIONS[0].label).toBe("Never make it free");
    // The owner's listing: this line said "It stays at your price" while its drops were on.
    expect(autoFreeExplainer(null)).not.toMatch(/stays at your price/i);
    expect(autoFreeExplainer(null)).toMatch(/price drops/);
    expect(autoFreeOutcomeLine(null)).toMatch(/^Make it free: never/);
    expect(autoFreeOutcomeLine(14)).toMatch(/^Make it free: after 14 days/);
  });
});

describe("the four statements, one box, on every sell form", () => {
  const dir = "src/components/declutter";
  const files = readdirSync(join(process.cwd(), dir)).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

  it("no form lists them with a box each: only the shared component reads the statements", () => {
    const readers = files.filter((f) => /\bTAX_STATEMENTS\b/.test(code(`${dir}/${f}`)));
    expect(readers).toEqual(["declutterUi.tsx"]);
  });

  it("every sell form uses the shared box", () => {
    const users = files.filter((f) => /<TaxStatementsCheck\b/.test(code(`${dir}/${f}`))).sort();
    expect(users.length).toBeGreaterThan(3);
    expect(users).toEqual(["BunchDraftsSection.tsx", "DeclutterBunchListStep.tsx", "DeclutterEditListing.tsx", "ListedForYouCard.tsx", "SellFormParts.tsx"]);
  });

  it("all four statements stay, word for word, above one tick", () => {
    expect(TAX_STATEMENTS).toEqual([
      "I bought this item for my own personal or household use.",
      "I'm not in the business of selling items like this.",
      "I don't sell things often. This is an occasional sale.",
      "I'll keep the item until I hand it over to the buyer.",
    ]);
    expect(TAX_TICK_LABEL).toBe("All of this is true for what I'm listing");
  });
});

describe("saved pickup places", () => {
  const place = (over: object) => ({ id: "a", position: 1, label: "Home", address: "1 Main St", area: "Mid-City", lat: 30.45123, lng: -91.15456, weekdays: [6], ...over });

  it("uses the first in the seller's order, with its exact point, and says which", () => {
    const p = pickupFromPlaces([place({ id: "b", position: 2, label: "Mom's", address: "2 Oak St" }), place({})]);
    expect(p).toEqual({ areaLabel: "Mid-City", address: "1 Main St", lat: 30.45123, lng: -91.15456, line: "Pickup at Home, Mom's. Buyers pick one." });
    expect(pickupFromPlaces([place({})])?.line).toBe("Pickup at Home");
  });

  it("a place with no real point is never used: no approximate points", () => {
    expect(pickupFromPlaces([place({ lat: Number.NaN })])).toBeNull();
    expect(pickupFromPlaces([])).toBeNull();
  });
});

describe("the suggested price is the high end of fair", () => {
  const edge = readFileSync(join(process.cwd(), "supabase/functions/declutter-ai-draft/index.ts"), "utf8");
  const rule = /const PRICE_RULE = `([^`]*)`/.exec(edge)?.[1] ?? "";

  it("the prompt asks for the high end, honestly, not a quick sale; one item and a bunch share it", () => {
    expect(rule).toMatch(/HIGH end of the fair range/);
    expect(rule).toMatch(/never above what a similar used item/);
    expect(rule).not.toMatch(/quick local sale|sell fast/);
    // The bunch's prompt is built on the single item's.
    expect(edge).toMatch(/const systemPrompt = `\$\{ITEM_SYSTEM_PROMPT\}/);
  });

  it("our sold range only bounds it: a high figure inside the range stays, one above is held to the top, never the middle", () => {
    const d = sanitizeDraft(JSON.parse(JSON.stringify({ title: "Oak dresser", description: "Six drawers.", category: "furniture", delivery_size: "large", condition_stars: 4, possibly_banned: false, price_dollars: 70 })))!;
    const hint = { low_cents: 4000, high_cents: 7500, sales: 20 };
    expect(groundPrice(d, hint).priceDollars).toBe(70);
    expect(groundPrice({ ...d, priceDollars: 500 }, hint).priceDollars).toBe(75);
    expect(groundPrice({ ...d, priceDollars: 75 }, hint).priceDollars).toBe(75);
  });
});
