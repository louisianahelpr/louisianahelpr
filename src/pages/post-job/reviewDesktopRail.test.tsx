/**
 * A2-L13 (app audit 2026-10-28, p2b-pw-review-p1-1440.png): at 1440 the post-job
 * Review step dropped the board 166 step rail and the "How your post will look"
 * card the form steps show, and its rows stretched ~1144px. Review now sits in
 * the same desktop columns as the form steps (POST_JOB_DESKTOP_GRID, shared
 * with FormStep): the rail on the left with Review as the current step, the
 * preview card on the right.
 *
 * @mutate src/pages/post-job/CheckoutStepView.tsx |       <PostJobStepRail screen="review" canPick={canPick} onPick={pick} /> |
 * @mutate src/pages/post-job/CheckoutStepView.tsx |         <PostJobPreviewCard title={form.title} category={form.category} photo={form.imagePreviews?.[0]} budget={form.quoteReview ? 0 : form.budgetNum} /> |
 * @mutate src/pages/post-job/CheckoutStepView.tsx |     <div key="checkout-step" className={POST_JOB_DESKTOP_GRID}> |     <div key="checkout-step" className="space-y-section">
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CheckoutStepView } from "./CheckoutStepView";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { usePostJobForm } from "./usePostJobForm";

vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));

function makeForm(): ReturnType<typeof usePostJobForm> {
  return {
    setStep: vi.fn(), setFormPage: vi.fn(), setCategoryGroup: vi.fn(),
    title: "Mow front yard", description: "Front yard about a quarter acre.", categoryLabel: "Yard work", category: "yard_work",
    imagePreviews: [], streetAddress: "4412 Highland Rd", city: "Baton Rouge", addrState: "LA", zipCode: "70808",
    dateNeeded: "2026-10-31", startTime: "09:00", estimatedHours: "", isFlexibleSchedule: false, specialRequirements: "",
    isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
    isUrgent: false, urgentFeeNum: 0, budgetNum: 40, helprActivity: null, customerFeeAmount: 0, onboardingFeeAmount: 0,
    totalCharge: 40, hasGift: false, giftAppliedAmount: 0, giftCreditAmount: 0, giftLoading: false, giftUnavailable: false,
    confirmed: false, setConfirmed: vi.fn(), saveCardForFuture: false, setSaveCardForFuture: vi.fn(),
    saving: false, redirecting: false, uploading: false, uploadProgress: null, handleSubmit: vi.fn(), parish: "East Baton Rouge",
  } as unknown as ReturnType<typeof usePostJobForm>;
}

describe("A2-L13: Review keeps the desktop step rail and the post preview", () => {
  it("shows the step rail with Review as the current step", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const rail = screen.getByRole("navigation", { name: "Post a job steps" });
    const current = rail.querySelector('[aria-current="step"]');
    expect(current?.textContent).toMatch(/Review/);
    // Vacuity floor: the rail lists every screen, not only Review.
    expect(within(rail).getAllByText(/./).length).toBeGreaterThan(5);
  });

  it("shows the How your post will look card with the job's title and price", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const card = screen.getByRole("region", { name: "How your post will look" });
    expect(card.textContent).toContain("Mow front yard");
    expect(card.textContent).toMatch(/\$40/);
  });

  it("sits in the same desktop columns as the form steps (one shared grid)", () => {
    const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "../../..", f), "utf8"));
    for (const f of ["src/pages/post-job/CheckoutStepView.tsx", "src/pages/post-job/FormStep.tsx"]) {
      expect(read(f), f).toMatch(/className=\{POST_JOB_DESKTOP_GRID\}/);
    }
  });
});
