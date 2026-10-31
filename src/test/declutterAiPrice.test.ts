/**
 * Owner 2026-10-29: "ai should always be doing most of the work for declutter
 * listing". declutter-ai-draft also suggests the starting price (whole
 * dollars, $1-$1,000, the sell form's range) with a one-line reason, and:
 *   - never a retail claim: a reason naming a store, retail, MSRP, an
 *     original/new price or a marketplace is dropped (the price stays);
 *   - grounded in OUR sold prices: when declutter_price_hint has a real range
 *     (the app's own validity rule), the price is clamped into it and the
 *     reason says so; the hint runs AS THE CALLER (its switch applies).
 *
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   if (n < PRICE_MIN_DOLLARS) return null; |   if (n < -5) return null;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   return Math.min(PRICE_MAX_DOLLARS, n); |   return n;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts | priceReasonRaw.length >= 3 && !UNBACKED_PRICE_CLAIM.test(priceReasonRaw) ? | priceReasonRaw.length >= 3 ?
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   const price = Math.min(high, Math.max(low, draft.priceDollars)); |   const price = draft.priceDollars;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |     && hint.low_cents >= 100 && hint.high_cents >= hint.low_cents; |     && hint.low_cents >= 0;
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   const { data, error } = await anon.rpc("declutter_price_hint", { |   const { data, error } = await admin.rpc("declutter_price_hint", {
 * @mutate supabase/functions/declutter-ai-draft/index.ts | 502);\n  return json(draftAnswer(await groundWithOurSales(anon, await priceDraftFromLookup(ANTHROPIC_API_KEY, draft), body))); | 502);\n  return json(draftAnswer(await priceDraftFromLookup(ANTHROPIC_API_KEY, draft)));
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     }\n\n    return json(draftAnswer(await groundWithOurSales(anon, await priceDraftFromLookup(ANTHROPIC_API_KEY, draft), body))); |     }\n\n    return json(draftAnswer(await priceDraftFromLookup(ANTHROPIC_API_KEY, draft)));
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { groundPrice, hintPointFromBody, PRICE_MAX_DOLLARS, PRICE_MIN_DOLLARS, sanitizeDraft } from "../../supabase/functions/declutter-ai-draft/sanitize";
import { moveRowProblem } from "@/lib/declutter/moves";

const base = { title: "Oak dresser", description: "Six drawers.", category: "furniture", delivery_size: "large", condition_stars: 4, possibly_banned: false };
// Parsed from text, as the model's answer arrives.
const answer = (extra: Record<string, unknown>) => sanitizeDraft(JSON.parse(JSON.stringify({ ...base, ...extra })))!;
const EDGE = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));

describe("Claude's suggested price", () => {
  it("keeps a whole-dollar price in the form's range, with its reason", () => {
    const d = answer({ price_dollars: 45.4, price_reason: "Solid wood with light wear,\nso it should sell fast." });
    expect(d.priceDollars).toBe(45);
    expect(d.priceReason).toBe("Solid wood with light wear, so it should sell fast.");
  });

  it("bounds the price: under $1 or not a number is no price; over $1,000 is $1,000", () => {
    expect(answer({ price_dollars: 0, price_reason: "Worn." }).priceDollars).toBeNull();
    expect(answer({ price_dollars: -20 }).priceDollars).toBeNull();
    expect(answer({ price_dollars: "lots" }).priceDollars).toBeNull();
    expect(answer({}).priceDollars).toBeNull();
    expect(answer({ price_dollars: 5000, price_reason: "Big." }).priceDollars).toBe(1000);
    // No price, no reason.
    expect(answer({ price_reason: "Nice." }).priceReason).toBeNull();
  });

  it("never a retail or store claim: that reason is dropped, the price stays", () => {
    for (const claim of [
      "Retail is $300, so $80 is a deal.",
      "MSRP was $250.",
      "A new one costs $200.",
      "Originally paid $150.",
      "Similar ones go for $60 on eBay.",
      "Amazon sells it for $90.",
      "Facebook Marketplace prices are around $50.",
    ]) {
      const d = answer({ price_dollars: 60, price_reason: claim });
      expect(d.priceDollars, claim).toBe(60);
      expect(d.priceReason, claim).toBeNull();
    }
  });

  it("is clamped into OUR sold-price range when the hint has one, and says so", () => {
    const d = answer({ price_dollars: 120, price_reason: "Looks great." });
    const grounded = groundPrice(d, { low_cents: 4000, high_cents: 7550, sales: 20 });
    expect(grounded.priceDollars).toBe(75);
    expect(grounded.priceReason).toBe("Items like this sold for $40-$75 on Declutter near you.");
    expect(groundPrice(answer({ price_dollars: 10 }), { low_cents: 4000, high_cents: 7500, sales: 20 }).priceDollars).toBe(40);
    expect(groundPrice(answer({ price_dollars: 50 }), { low_cents: 4000, high_cents: 7500, sales: 20 }).priceDollars).toBe(50);
  });

  it("an invalid or thin hint changes nothing (the app's own validity rule)", () => {
    const d = answer({ price_dollars: 120, price_reason: "Looks great." });
    for (const h of [null, undefined, { low_cents: 4000, high_cents: 7500, sales: 5 }, { low_cents: 50, high_cents: 7500, sales: 20 }, { low_cents: 9000, high_cents: 7500, sales: 20 }]) {
      expect(groundPrice(d, h)).toEqual(d);
    }
    expect(groundPrice(answer({}), { low_cents: 4000, high_cents: 7500, sales: 20 }).priceDollars).toBeNull();
  });

  it("Claude's price range is the range a listing can be saved at ($1 to $1,000), no wider and no narrower", () => {
    const row = (price: string) => moveRowProblem({ title: "Oak rocking chair", price, floor: "" });
    expect(row(String(PRICE_MIN_DOLLARS))).toBeNull();
    expect(row(String(PRICE_MAX_DOLLARS))).toBeNull();
    expect(row((PRICE_MIN_DOLLARS - 0.01).toFixed(2))).not.toBeNull();
    expect(row(String(PRICE_MAX_DOLLARS + 1))).not.toBeNull();
  });

  it("reads the hint point only when it is a real lat/lng", () => {
    expect(hintPointFromBody({ lat: 30.4515, lng: -91.1871 })).toEqual({ lat: 30.45, lng: -91.19 });
    expect(hintPointFromBody({ lat: "30", lng: -91 })).toBeNull();
    expect(hintPointFromBody({ lat: 300, lng: -91 })).toBeNull();
    expect(hintPointFromBody(undefined)).toBeNull();
  });

  it("the edge function asks for the price, returns it, and grounds it as the caller in both draft paths", () => {
    expect(EDGE.length).toBeGreaterThan(5_000);
    expect(EDGE).toMatch(/required: \[[^\]]*"price_dollars", "price_reason"\]/);
    expect(EDGE).toMatch(/Never mention retail, new, original or store prices/);
    expect(EDGE).toContain('const { data, error } = await anon.rpc("declutter_price_hint", {');
    expect(EDGE).toContain("priceDollars: draft.priceDollars,");
    // The saved draft's path and a new listing's photos path both ground the price.
    expect([...EDGE.matchAll(/return json\(draftAnswer\(await groundWithOurSales\(anon, await priceDraftFromLookup\(ANTHROPIC_API_KEY, draft\), body\)\)\);/g)]).toHaveLength(2);
  });
});
