// A2-C36 / A2-C33 (app audit 2026-10-29): Post a job's review step quoted a Repeats job's total with no word that it
// pays for the first visit only, and a crew job's total with no word of how it splits.
//   - C36: a $40 weekly job of 4 visits read "Total $40" and nothing else under it. Now "$40 a visit · 4 visits",
//     then "The total is for the first visit; each later visit is charged to your saved card about 3 days before
//     it." (charge-recurring-visits FUND_LEAD_DAYS = 3). The total is not called "charged now": under
//     card_hold_at_post (on for everyone, 20261027185147) a card is only held until the hire.
//   - C33: a $90 crew job of 3 read "Total $90". Now "3 Helprs, about $30 each" (allocateCents, the server's
//     largest-remainder split, as the form's "~$30/Helpr" hint reads).
//
// Red first (2026-10-29) against origin/main 1a38dea437: neither line rendered.
//
// @mutate src/components/postjob/CheckoutBudgetLine.tsx |   const series = visitCount > 1; |   const series = false;
// @mutate src/components/postjob/CheckoutBudgetLine.tsx |   const crew = crewSize > 1; |   const crew = false;
// @mutate src/lib/seriesMoneyCopy.ts | "each later visit is charged to your saved card about 3 days before it"; | "each later visit is charged to your saved card";
// @mutate src/pages/post-job/CheckoutStepView.tsx |         isGroupJob={form.isGroupJob} |         isGroupJob={false}
// JOBS-28 (Jobs audit 10-30, "later repeat visits don't mention tax"): a taxable category's later visits are charged
// their sales tax too (charge-recurring-visits), so Review says so; an untaxed one keeps the plain words.
// @mutate src/components/postjob/CheckoutStep.tsx | taxable={hasTaxableLine(category)} /> | taxable={false} />
// @mutate src/lib/seriesMoneyCopy.ts |   return taxable ? SERIES_LATER_VISITS_CHARGED_TAXED : SERIES_LATER_VISITS_CHARGED; |   return SERIES_LATER_VISITS_CHARGED;
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutStepView } from "./CheckoutStepView";
import type { usePostJobForm } from "./usePostJobForm";

vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));

function makeForm(over: Record<string, unknown> = {}): ReturnType<typeof usePostJobForm> {
  return {
    setStep: vi.fn(), title: "Mow my lawn", description: "Front and back, bag the clippings.", categoryLabel: "Yard work",
    category: "yard_work", imagePreviews: [], streetAddress: "314 Lynn St", city: "Delcambre", addrState: "LA", zipCode: "70528",
    dateNeeded: "2026-11-02", startTime: "09:00", estimatedHours: "", isFlexibleSchedule: false, specialRequirements: "",
    isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
    isGroupJob: false, helpersNeeded: "2",
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

describe("A2-C36: a Repeats job's review says the total is one visit of several", () => {
  it("$40 weekly on Mondays for 4 weeks: '$40 a visit · 4 visits' and when the later visits are charged", () => {
    render(<CheckoutStepView form={makeForm({ isRecurring: true, recurrenceInterval: "weekly", recurrenceDays: [1], recurrenceWeeks: 4 })} />);
    const row = totalRow();
    expect(row).toContain("$40 a visit · 4 visits");
    expect(row).toContain("The total is for the first visit; each later visit is charged to your saved card about 3 days before it.");
    // Never "charged now": the card may only be held until the hire (card_hold_at_post).
    expect(row).not.toMatch(/charged now/);
  });

  it("a taxable category (handyman): the later visits are charged their sales tax too", () => {
    render(<CheckoutStepView form={makeForm({ category: "handyman", categoryLabel: "Handyman", isRecurring: true, recurrenceInterval: "weekly", recurrenceDays: [1], recurrenceWeeks: 4 })} />);
    expect(totalRow()).toContain("The total is for the first visit; each later visit, plus its sales tax, is charged to your saved card about 3 days before it.");
  });

  it("an untaxed category (yard work) does not mention tax on the later visits", () => {
    render(<CheckoutStepView form={makeForm({ isRecurring: true, recurrenceInterval: "weekly", recurrenceDays: [1], recurrenceWeeks: 4 })} />);
    expect(totalRow()).not.toMatch(/sales tax/);
  });

  it("a one-off job says nothing about visits", () => {
    render(<CheckoutStepView form={makeForm()} />);
    expect(totalRow()).not.toMatch(/visit/);
  });
});

describe("A2-C33: a crew job's review says how the budget splits", () => {
  it("$90 for a crew of 3: '3 Helprs, about $30 each'", () => {
    render(<CheckoutStepView form={makeForm({ isGroupJob: true, helpersNeeded: "3", budgetNum: 90, totalCharge: 90 })} />);
    expect(totalRow()).toContain("3 Helprs, about $30 each");
  });

  it("an uneven split quotes the smallest share, never more than a Helpr gets", () => {
    render(<CheckoutStepView form={makeForm({ isGroupJob: true, helpersNeeded: "3", budgetNum: 100, totalCharge: 100 })} />);
    expect(totalRow()).toContain("3 Helprs, about $33.33 each");
  });

  it("a one-Helpr job names no crew", () => {
    render(<CheckoutStepView form={makeForm({ helpersNeeded: "3" })} />);
    expect(totalRow()).not.toMatch(/Helprs, about/);
  });
});
