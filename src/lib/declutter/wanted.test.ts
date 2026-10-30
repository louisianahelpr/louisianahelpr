/**
 * Declutter wanted posts + fair-price hint, client side (src/lib/declutter/wanted.ts;
 * docs/specs/declutter-wanted-price-hint.md): the pure words and form rules. No
 * mocked Supabase (CLAUDE.md): the RPCs' own rules are proven against a real
 * Postgres in src/test/pglite/declutterWantedPriceHint.pglite.mjs.
 *
 * @mutate src/lib/declutter/priceHint.ts |   if (!h \|\| !Number.isInteger(h.sales) \|\| h.sales < 10 \|\| h.sales % 10 !== 0) return null; |   if (!h) return null;
 * @mutate src/lib/declutter/wanted.ts |   if (/[A-Za-z]\.[A-Za-z]/.test(what)) return "Leave out web addresses."; |   if (false) return "Leave out web addresses.";
 * @mutate src/lib/declutter/priceHint.ts |   const where = place === "near_you" ? "near you" : "in this area"; |   const where = "near you";
 */
import { describe, expect, it } from "vitest";

import { priceHintWords } from "./priceHint";
import {
  dollarsToCents,
  parseMatches,
  wantedFormProblem,
  type WantedForm,
} from "./wanted";

const form = (over: Partial<WantedForm> = {}): WantedForm => ({ what: "crib", category: "baby_kids", maxPrice: "80", radius: 10, ...over });

describe("dollarsToCents", () => {
  it("reads whole dollars, cents and a leading $", () => {
    expect(dollarsToCents("80")).toBe(8000);
    expect(dollarsToCents("79.5")).toBe(7950);
    expect(dollarsToCents("$12.34")).toBe(1234);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "abc", "1.234", "-5", "10000", "1e3"]) expect(dollarsToCents(bad)).toBeNull();
  });
});

describe("wantedFormProblem (W8, mirrors declutter_create_wanted)", () => {
  it("accepts a plain post", () => {
    expect(wantedFormProblem(form())).toBeNull();
    expect(wantedFormProblem(form({ what: "Oak dresser, 6-drawer" }))).toBeNull();
    expect(wantedFormProblem(form({ what: "Crib", maxPrice: "1000", radius: 50 }))).toBeNull();
  });
  it("refuses too short, too long, symbols and web addresses", () => {
    expect(wantedFormProblem(form({ what: "ab" }))).toMatch(/3 to 60/);
    expect(wantedFormProblem(form({ what: "x".repeat(61) }))).toMatch(/3 to 60/);
    expect(wantedFormProblem(form({ what: "crib @ me!" }))).toMatch(/letters and numbers/);
    expect(wantedFormProblem(form({ what: "crib see shop.com" }))).toMatch(/web addresses/);
    expect(wantedFormProblem(form({ what: "crib ｃａｓｈ" }))).toMatch(/letters and numbers/);
  });
  it("refuses phone numbers in digits or words", () => {
    expect(wantedFormProblem(form({ what: "crib 5 0 4 5 5 5 1" }))).toMatch(/phone/);
    expect(wantedFormProblem(form({ what: "crib five zero four five" }))).toMatch(/phone/);
    expect(wantedFormProblem(form({ what: "2 cribs for 3 kids" }))).toBeNull();
  });
  it("needs a category, a price from $1 to $1,000 and a listed distance", () => {
    expect(wantedFormProblem(form({ category: "" }))).toMatch(/category/);
    expect(wantedFormProblem(form({ maxPrice: "0.50" }))).toMatch(/whole dollars/);
    expect(wantedFormProblem(form({ maxPrice: "1000.01" }))).toMatch(/whole dollars/);
    expect(wantedFormProblem(form({ maxPrice: "79.50" }))).toMatch(/whole dollars/);
    expect(wantedFormProblem(form({ radius: 7 as unknown as 10 }))).toMatch(/how far/);
  });
});

describe("priceHintWords (W10, W11: never a number the server did not give)", () => {
  it("says the range, where, and what it is based on", () => {
    expect(priceHintWords({ low_cents: 4000, high_cents: 7000, sales: 10 }, "this_area")).toEqual({
      headline: "Most items like this sold for $40–$70 in this area",
      basis: "Based on 10+ Declutter sales of items in the same category and condition, within about 25 miles, in the last year.",
    });
    expect(priceHintWords({ low_cents: 4000, high_cents: 7000, sales: 20 }, "near_you")?.headline).toBe(
      "Most items like this sold for $40–$70 near you",
    );
  });
  it("says one price when both ends are the same", () => {
    expect(priceHintWords({ low_cents: 5000, high_cents: 5000, sales: 10 }, "near_you")?.headline).toBe("Most items like this sold for $50 near you");
  });
  it("says nothing without an answer, under 10, off the tens, or for a malformed row", () => {
    expect(priceHintWords(null, "near_you")).toBeNull();
    expect(priceHintWords(undefined, "near_you")).toBeNull();
    expect(priceHintWords({ low_cents: 4000, high_cents: 7000, sales: 5 }, "near_you")).toBeNull();
    expect(priceHintWords({ low_cents: 4000, high_cents: 7000, sales: 11 }, "near_you")).toBeNull();
    expect(priceHintWords({ low_cents: 7000, high_cents: 4000, sales: 10 }, "near_you")).toBeNull();
    expect(priceHintWords({ low_cents: 0, high_cents: 4000, sales: 10 }, "near_you")).toBeNull();
    expect(priceHintWords({ low_cents: Number.NaN, high_cents: 4000, sales: 10 }, "near_you")).toBeNull();
  });
});

describe("parseMatches", () => {
  it("keeps well-formed matches and drops anything else", () => {
    const good = { id: "i-1", title: "Crib", price_cents: 4500 };
    expect(parseMatches([good, { id: 2 }, null, "x", { id: "i-2", title: "T", price_cents: 1.5 }])).toEqual([good]);
    expect(parseMatches(null)).toEqual([]);
    expect(parseMatches({ id: "i-1" })).toEqual([]);
  });
});
