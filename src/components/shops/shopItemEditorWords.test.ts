/**
 * Shops audit 11-12 S040 + S042 + S027.
 *   S040: the item editor says ONE rule about live edits (owner 2026-11-05): an edit stays live unless the kind or
 *         type changes. The Publish box used to say only price or stock edits stay live.
 *   S042: a combination price typed "1,200" or "$1,200" is $1,200 (it was NaN), and a price the server would refuse
 *         shows under its field instead of a toast after Save.
 *
 * @mutate src/components/shops/ShopItemOptionsEditor.tsx | Math.round(Number(s.replace(/[$,\s]/g, "")) * 100) | Math.round(Number(s) * 100)
 * @mutate src/components/shops/ShopItemOptionsEditor.tsx |   if (c < 100 \|\| c > SHOP_ITEM_MAX_PRICE_CENTS) | if (false)
 * @mutate src/components/shops/ShopItemEditor.tsx |  Edits to a live item keep it live, unless you change what kind of item it is or its type.</p> |  Changing only the price or stock of a live item keeps it live.</p>
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { optionPriceCents, optionPriceProblem } from "./ShopItemOptionsEditor";

describe("S042: a combination's price", () => {
  it("reads commas and a dollar sign", () => {
    expect(optionPriceCents("1,200")).toBe(120000);
    expect(optionPriceCents("$1,200.50")).toBe(120050);
    expect(optionPriceCents("12.5")).toBe(1250);
  });
  it("says what is wrong under the field", () => {
    expect(optionPriceProblem("1,200")).toBeNull();
    expect(optionPriceProblem("0.50")).toBe("From $1 to $5,000.");
    expect(optionPriceProblem("6000")).toBe("From $1 to $5,000.");
    expect(optionPriceProblem("abc")).toBe("Type a price, like 12.50.");
    expect(optionPriceProblem("")).toBe("Type a price, like 12.50.");
  });
});

describe("S040: one rule about live edits", () => {
  const src = readFileSync(resolve(__dirname, "ShopItemEditor.tsx"), "utf8");
  it("never says only price or stock edits stay live", () => {
    expect(src).not.toMatch(/only the price or stock/);
    expect(src).toContain("Edits to a live item keep it live, unless you change what kind of item it is or its type.");
  });
});
