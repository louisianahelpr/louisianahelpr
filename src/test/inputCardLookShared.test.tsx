/**
 * Q2709 "nothing hand-made" (Declutter packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * The Sell form's and Edit listing's title boxes were hand-made <input>s carrying SellFormParts' SELL_INPUT class
 * set; they are the shared Input's `look="card"` now. Look-identical by construction: the rendered class SET equals
 * the hand-made literal (CSS does not read class order), and SELL_INPUT (still used by the description Textarea and
 * the address field) is the same constant, so those keep their look too.
 *
 * @mutate src/components/ui/input.tsx | border border-border bg-card px-4 | border border-input bg-card px-4
 * @mutate src/components/ui/input.tsx |     if (look === "card") { |     if (look === "glass") {
 * @mutate src/components/declutter/SellFormParts.tsx | export const SELL_INPUT = CARD_FIELD_CLS; | export const SELL_INPUT = CARD_FIELD_CLS + " shadow-sm";
 * @mutate src/components/declutter/DeclutterEditListing.tsx | <Input look="card" id="edit-title" | <Input id="edit-title"
 * @mutate src/components/declutter/SellSummaryCard.tsx | <Input look="card" id="sell-title" | <input id="sell-title" className={SELL_INPUT}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Input } from "@/components/ui/input";
import { SELL_INPUT } from "@/components/declutter/SellFormParts";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
// The hand-made literal, verbatim from SellFormParts.tsx at main 793859cd9c.
const HAND_MADE =
  "w-full h-[52px] rounded-[14px] border border-border bg-card px-4 text-ds-15 text-foreground focus:border-primary focus:outline-none placeholder:text-muted-foreground";
const FILES: Record<string, string> = {
  "src/components/declutter/DeclutterSellView.tsx": "sell-title",
  "src/components/declutter/SellSummaryCard.tsx": "sell-title",
  "src/components/declutter/DeclutterEditListing.tsx": "edit-title",
};

describe("the Sell / Edit title boxes are the shared Input look=card, class for class the hand-made look", () => {
  it("look=card renders exactly the hand-made class set; SELL_INPUT is that same set", () => {
    const i = render(<Input look="card" id="t" defaultValue="Oak chair" />).container.querySelector("input")!;
    expect(set(i.className)).toEqual(set(HAND_MADE));
    expect(i.hasAttribute("type")).toBe(false);
    expect(set(SELL_INPUT)).toEqual(set(HAND_MADE));
    // The default Input is untouched: still the glass field, never the card look.
    const d = render(<Input id="d" />).container.querySelector("input")!;
    expect(d.className).toContain("glass-field");
    expect(d.className).not.toContain("h-[52px]");
  });

  it("every Sell / Edit title box uses it; none keeps the hand-made input", () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(2);
    for (const [f, id] of Object.entries(FILES)) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toContain(`<input id="${id}"`);
      expect(s, f).toContain(`<Input look="card" id="${id}"`);
    }
  });
});
