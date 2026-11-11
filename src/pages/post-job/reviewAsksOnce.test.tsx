// A3-96 (audit 11-01): Review showed a "Payment breakdown" with a "Your charges" header over nothing but the Total
// (most posters: no fee lines), then asked the same confirmation twice: a required "I've checked the details above"
// checkbox AND a button reading "Confirm details to continue". Now the header shows only over lines to break down,
// and the button keeps its own words ("Continue to payment"), greyed until the one checkbox is ticked.
//
// @mutate src/components/postjob/CheckoutStep.tsx |           {budgetRowShown && <p className="text-ds-12 font-semibold text-muted-foreground uppercase tracking-wide">Your charges</p>} |           <p className="text-ds-12 font-semibold text-muted-foreground uppercase tracking-wide">Your charges</p>
// @mutate src/components/postjob/CheckoutStep.tsx |                   // A3-96: the checkbox above is the one ask; | : !confirmed ? "Confirm details to continue" // A3-96: the checkbox above is the one ask;
//
// F304 (audit 11-10, owner 2026-11-11 morning pop-up): a plain job's card was "Payment breakdown", an empty divider
// and "Total $25". Now it is "You pay $25" and "Held safely until you approve the work.", with no heading; the line
// under the button no longer repeats the hold. Anything with parts to break down keeps the heading and its Total.
// @mutate src/components/postjob/CheckoutStep.tsx |   const plainYouPay = !hasGift && !taxableLine && !budgetRowShown; |   const plainYouPay = false;
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

describe("A3-96: Review breaks down only what has parts, and asks once", () => {
  it("a plain job: no 'Your charges' header over the lone total", () => {
    render(<CheckoutStepView form={makeForm()} />);
    expect(screen.getByText("You pay")).toBeTruthy();
    expect(screen.queryByText("Your charges")).toBeNull();
  });

  it("F304 owner 11-11: a plain job reads 'You pay $40' and 'Held safely until you approve the work.', no heading or divider", () => {
    const { container } = render(<CheckoutStepView form={makeForm()} />);
    const row = container.querySelector("[data-plain-you-pay]");
    expect(row?.textContent?.replace(/\s+/g, "")).toBe("Youpay$40");
    expect(screen.getByText("Held safely until you approve the work.")).toBeTruthy();
    expect(screen.queryByText(/Payment breakdown/)).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
    // The hold is said once on the step.
    expect((container.textContent ?? "").split("Held safely").length - 1).toBe(1);
  });

  it("F304: a job with parts (an urgent bonus) keeps the Payment breakdown heading and its Total", () => {
    const { container } = render(<CheckoutStepView form={makeForm({ isUrgent: true, urgentFeeNum: 10, totalCharge: 50 })} />);
    expect(screen.getByText(/Payment breakdown/)).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(container.querySelector("[data-plain-you-pay]")).toBeNull();
  });

  it("a job with a line to break down keeps the header", () => {
    render(<CheckoutStepView form={makeForm({ isUrgent: true, urgentFeeNum: 10, totalCharge: 50 })} />);
    expect(screen.getByText("Your charges")).toBeTruthy();
    expect(screen.getByText("Job budget")).toBeTruthy();
  });

  it("unticked: the button keeps its own words, greyed; it never repeats the checkbox", () => {
    render(<CheckoutStepView form={makeForm()} />);
    expect(screen.getByLabelText(/I've checked the details above/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Continue to payment/ });
    expect(btn).toBeDisabled();
    expect(screen.queryByText(/Confirm details to continue/)).toBeNull();
  });
});
