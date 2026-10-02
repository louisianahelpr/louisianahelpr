// Shown able to fail: with the chip never pressed, "shows selected once taken" reds.
// @mutate src/components/postjob/BudgetSection.tsx | aria-pressed={taken} | aria-pressed={false}
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetSection } from "./BudgetSection";
import { getSmartPrice } from "@/lib/pricingGuide";

/**
 * Owner, 2026-10-01, Post a Job on the phone: "I tapped use 65, 55 went in
 * the box and like 61 was in the button. It all needs to be the same number".
 *
 * Three ways the numbers came apart, each its own check:
 *  - the field was focused (keyboard open) when "Use $X" was tapped; iOS does
 *    not blur on a button tap, and CurrencyInput ignored an outside value while
 *    focused, so the box kept the typed number and blur put it back;
 *  - the chip vanished once taken, so the tap looked like it did nothing;
 *  - a budget under the minimum blocked the CTA with no line saying why.
 * The CTA half (budget only, never the fee-inclusive total) is
 * displayedMoneyMatchesReality.test.ts.
 */
function Harness({ initial = "" }: { initial?: string }) {
  const [budget, setBudget] = useState(initial);
  return (
    <>
      <BudgetSection
        stepNumber={3}
        budget={budget}
        setBudget={setBudget}
        suggested={{ min: 25, max: 80, label: "Cleaning" }}
        budgetPresets={[25, 50, 75, 100, 150]}
        priceStats={null}
        priceStatsLoading={false}
        isUrgent={false}
        setIsUrgent={() => {}}
        urgentFee=""
        setUrgentFee={() => {}}
        customUrgentFee={false}
        setCustomUrgentFee={() => {}}
        budgetComplete={false}
        category="cleaning"
      />
      <output data-testid="state">{budget}</output>
    </>
  );
}

const smart = getSmartPrice("cleaning")!;
const field = () => screen.getByLabelText("Job budget in dollars") as HTMLInputElement;
const chip = () => screen.getByRole("button", { name: new RegExp(`\\$${smart}$`) });

describe("Post a Job budget: field, chip and form state are one number", () => {
  it("tapping Use while the field is focused fills the field, and blur keeps it", () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "65" } });
    // Keyboard still open: the field never blurs before the tap.
    fireEvent.click(chip());
    expect(Number(screen.getByTestId("state").textContent)).toBe(smart);
    expect(Number(field().value.replace(/[$,]/g, ""))).toBe(smart);
    fireEvent.blur(field());
    expect(Number(screen.getByTestId("state").textContent)).toBe(smart);
    expect(field().value).toBe(`$${smart.toFixed(2)}`);
  });

  it("the chip stays and shows selected once its amount is the budget", () => {
    render(<Harness />);
    fireEvent.click(chip());
    const c = chip();
    expect(c.getAttribute("aria-pressed")).toBe("true");
    expect(c.textContent).toBe(`Using $${smart}`);
  });

  it("a budget under the minimum says what the minimum is", () => {
    render(<Harness initial="5" />);
    expect(screen.getByText(/minimum budget is \$10/i).closest('[role="status"]')).not.toBeNull();
  });

  it("no minimum message at or above the minimum", () => {
    render(<Harness initial="10" />);
    expect(screen.queryByText(/minimum budget is/i)).toBeNull();
  });
});
