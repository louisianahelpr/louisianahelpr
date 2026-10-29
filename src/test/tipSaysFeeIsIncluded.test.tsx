/**
 * F30 (app audit 2026-10-28, part 4 half 2 final leg): the tip prompt said "Goes straight to the Helpr — no
 * platform cut" while the tip sheet read "You pay $4.43" for a $4.00 tip, the 43¢ unexplained. Owner rule #20
 * (2026-10-28, "Words only"): say a small Louisiana Helpr service fee is included, never a rate or a number. The
 * Helpr does get the whole tip (create-payment: a destination charge whose application fee is only the added fee;
 * tipFeesOneDefinition.test.ts), so that line stays.
 *
 * Red first (2026-10-28) against origin/main 6b3206e2bd: no fee sentence on the sheet; "no platform cut" in the prompt.
 *
 * @mutate src/components/TipCostBreakdown.tsx |       {q.chargeCents > q.tipCents && ( |       {false && (
 * @mutate src/components/reviewPanel/ReviewForm.tsx |               Your Helpr gets the whole tip. Includes a small Louisiana Helpr service fee. Most people tip |               Goes straight to the Helpr — no platform cut. Most people tip
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { TipCostBreakdown } from "@/components/TipCostBreakdown";
import { tipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";

const FEE_WORDS = "Includes a small Louisiana Helpr service fee.";

describe("F30: the tip says a service fee is included, with no number", () => {
  it("the tip sheet: You pay, the whole tip to the Helpr, and the fee in words", () => {
    const q = tipChargeBreakdown(400);
    // Inventory floor: a $4 tip really does cost more than $4 (else this guard reads nothing).
    expect(q.chargeCents).toBeGreaterThan(q.tipCents);
    const { container } = render(<TipCostBreakdown tipDollars={4} receiverName="Hallie Hebert" />);
    const text = container.textContent ?? "";
    expect(text).toContain("Hallie receives the whole $4.00 tip.");
    expect(text).toContain(FEE_WORDS);
    // No fee number: the only money figures are what the poster pays and the tip itself.
    const figures = text.match(/\$\d+(?:\.\d+)?/g) ?? [];
    expect(new Set(figures)).toEqual(new Set([`$${(q.chargeCents / 100).toFixed(2)}`, "$4.00"]));
  });

  it("the tip prompt after a review: no 'no platform cut', the fee in words", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/reviewPanel/ReviewForm.tsx"), "utf8")).replace(/\s+/g, " ");
    expect(src).not.toMatch(/no platform cut/i);
    expect(src).toContain(`Your Helpr gets the whole tip. ${FEE_WORDS}`);
  });
});
