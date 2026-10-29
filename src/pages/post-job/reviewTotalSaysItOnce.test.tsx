// F18 (app audit 2026-10-28, part 4 half 2): Post a job's review step read
// "Total $40 / $40 budget" on a plain $40 job (the same number twice), and
// "Save Card for Next Time" was Title Case.
//
// Red first (2026-10-28) against origin/main 6b3206e2bd: the plain job's Total
// row held "$40" twice, and the switch label read "Save Card for Next Time".
//
// @mutate src/components/postjob/CheckoutStep.tsx |               {budgetNum > 0 && (hasGift \|\| Math.round(totalWithTax * 100) !== Math.round(budgetNum * 100)) && ( |               {budgetNum > 0 && (
// @mutate src/components/postjob/CheckoutStep.tsx | <span className="font-semibold block">Save card for next time</span> | <span className="font-semibold block">Save Card for Next Time</span>
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutStepView } from "./CheckoutStepView";
import type { usePostJobForm } from "./usePostJobForm";

vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));

function makeForm(over: Record<string, unknown> = {}): ReturnType<typeof usePostJobForm> {
  return {
    setStep: vi.fn(), title: "Clean my kitchen", description: "Counters, floor and the stove top.", categoryLabel: "Cleaning",
    category: "cleaning", imagePreviews: [], streetAddress: "314 Lynn St", city: "Delcambre", addrState: "LA", zipCode: "70528",
    dateNeeded: "2026-11-03", startTime: "09:00", estimatedHours: "", isFlexibleSchedule: false, specialRequirements: "",
    isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
    isUrgent: false, urgentFeeNum: 0, budgetNum: 40, helprActivity: null, customerFeeAmount: 0, onboardingFeeAmount: 0,
    totalCharge: 40, hasGift: false, giftAppliedAmount: 0, giftCreditAmount: 0, giftLoading: false, giftUnavailable: false,
    confirmed: false, setConfirmed: vi.fn(), saveCardForFuture: false, setSaveCardForFuture: vi.fn(), saving: false,
    redirecting: false, uploading: false, uploadProgress: null, handleSubmit: vi.fn(), parish: "Vermilion",
    ...over,
  } as unknown as ReturnType<typeof usePostJobForm>;
}

/** The text of the summary card's Total row (its label is the DollarSign + "Total" span). */
function totalRow(): string {
  const label = screen.getAllByText("Total").find((el) => el.tagName === "SPAN" && el.querySelector("svg"));
  expect(label, "the summary card's Total row is gone").toBeTruthy();
  return (label!.parentElement?.textContent ?? "").replace(/\s+/g, " ");
}
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("F18: the review step's Total says each number once", () => {
  it("a plain $40 job: $40 once, no '$40 budget' line under it", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const row = totalRow();
    // Inventory floor: the row rendered its total.
    expect(count(row, "$40")).toBeGreaterThan(0);
    expect(count(row, "$40"), `"${row}" repeats the budget`).toBe(1);
    expect(row).not.toMatch(/budget/);
  });

  it("an urgent bonus on top: the budget line stays and names it", () => {
    render(<CheckoutStepView form={makeForm({ isUrgent: true, urgentFeeNum: 5, totalCharge: 45 })} />);
    const row = totalRow();
    expect(row).toContain("$45");
    expect(row).toMatch(/\$40 budget \+ urgent bonus/);
  });

  it("a gift: the budget line stays and names the gift", () => {
    render(<CheckoutStepView form={makeForm({ hasGift: true, giftAppliedAmount: 40, giftCreditAmount: 40, totalCharge: 0 })} />);
    expect(totalRow()).toMatch(/\$40 budget · \$40 gift applied/);
  });

  it("the save-card switch is sentence case", () => {
    render(<CheckoutStepView form={makeForm()} />);
    expect(screen.getByText("Save card for next time")).toBeTruthy();
    expect(screen.queryByText("Save Card for Next Time")).toBeNull();
  });
});
