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
 * @mutate src/components/TipCostBreakdown.tsx |           {row("Service fee", q.feeCents)} |           {row("Service fee", Math.round(q.tipCents * 0.05))}
 * @mutate src/components/TipDialog.tsx | receiverName={helperName} feeSplit /> | receiverName={helperName} />
 *
 * F277 (owner 2026-11-11 morning pop-up): the JOB TIP SHEET (TipDialog) now shows "Tip $14.25 / Service fee $0.73"
 * above "Pay $14.98", both from the same tipChargeBreakdown the server charges, so the rows add up to the button.
 * The completion prompt and the Declutter delivery tip keep the words-only card above (tip sheet only).
 * @mutate src/components/reviewPanel/ReviewForm.tsx |               Your Helpr gets the whole tip. Includes a small Louisiana Helpr service fee. Most people tip |               Goes straight to the Helpr — no platform cut. Most people tip
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { TipCostBreakdown, tipPayLabel } from "@/components/TipCostBreakdown";
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

  it("F277 owner 11-11: the job tip sheet shows Tip and Service fee rows that add up to the Pay button", () => {
    // $14.25 is the owner's example (15% of a $95 job).
    const q = tipChargeBreakdown(1425);
    expect(q.feeCents).toBeGreaterThan(0);
    const { container } = render(<TipCostBreakdown tipDollars={14.25} receiverName="Hallie Hebert" feeSplit />);
    const rows = [...container.querySelectorAll("dl > div")].map((d) => d.textContent);
    expect(rows).toEqual(["Tip$14.25", `Service fee$${(q.feeCents / 100).toFixed(2)}`]);
    // The fee is the server's number, and tip + fee is exactly what the Pay button names (and Stripe charges).
    expect(tipPayLabel(14.25)).toBe(`Pay $${((1425 + q.feeCents) / 100).toFixed(2)}`);
    expect(container.textContent).toContain("Hallie receives the whole tip.");
    expect(container.textContent).not.toContain("You pay");
  });

  it("F277: only the job tip sheet turns the fee split on (scoped exception)", () => {
    const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", f), "utf8"));
    expect(read("components/TipDialog.tsx")).toMatch(/<TipCostBreakdown[^>]*\bfeeSplit\b/);
    for (const f of ["components/CompletionPrompts.tsx", "components/declutter/DeliveryTipPanel.tsx"]) {
      expect(read(f), f).toContain("<TipCostBreakdown");
      expect(read(f), f).not.toMatch(/feeSplit/);
    }
  });

  it("F277: the tip sheet never pre-selects a tip amount", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/TipDialog.tsx"), "utf8"));
    expect(src).toMatch(/const \[amount, setAmount\] = useState<number \| undefined>\(undefined\);/);
  });

  it("the tip prompt after a review: no 'no platform cut', the fee in words", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/reviewPanel/ReviewForm.tsx"), "utf8")).replace(/\s+/g, " ");
    expect(src).not.toMatch(/no platform cut/i);
    expect(src).toContain(`Your Helpr gets the whole tip. ${FEE_WORDS}`);
  });
});
