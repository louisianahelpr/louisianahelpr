// @mutate src/components/postjob/CheckoutStep.tsx | className="flex-1 text-ds-13 text-foreground leading-relaxed line-clamp-3 text-right" | className="flex-1 text-ds-13 text-foreground leading-relaxed line-clamp-3"
/**
 * Owner, 2026-10-01, on the Post a Job "Order Summary" (review) screen:
 * "Remove detail and review and pay at the top. Category should be seperate
 * from the title in its own space. Description should be right aligned like
 * the other stufff" + "no need to show vermilion parish in the location or
 * any parish".
 *
 * Class check over EVERY row of the "Your post at a glance" card: each row is
 * a label + one value, and every value is right-aligned. Plus: no step rail on
 * the review screen, Category is its own row (not stacked under the title),
 * and no row names a parish.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutStepView } from "./CheckoutStepView";
import type { usePostJobForm } from "./usePostJobForm";

vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));

function makeForm(): ReturnType<typeof usePostJobForm> {
  const form = {
    setStep: vi.fn(),
    title: "Clean my room",
    description: "Help clean my room ".repeat(12).trim(),
    categoryLabel: "Cleaning",
    category: "cleaning",
    imagePreviews: [],
    streetAddress: "314 Lynn St",
    city: "Delcambre",
    addrState: "LA",
    zipCode: "70528",
    dateNeeded: "2026-10-03",
    startTime: "09:00",
    estimatedHours: "",
    isFlexibleSchedule: false,
    specialRequirements: "",
    isRecurring: false,
    recurrenceInterval: "",
    recurrenceEndDate: "",
    recurrenceDays: [],
    recurrenceWeeks: 0,
    isUrgent: false,
    urgentFeeNum: 0,
    budgetNum: 30,
    helprActivity: null,
    customerFee: null,
    customerFeeAmount: 2,
    onboardingFeeAmount: 0,
    totalCharge: 32,
    hasGift: false,
    giftAppliedAmount: 0,
    giftCreditAmount: 0,
    giftLoading: false,
    giftUnavailable: false,
    confirmed: false,
    setConfirmed: vi.fn(),
    saveCardForFuture: false,
    setSaveCardForFuture: vi.fn(),
    saving: false,
    redirecting: false,
    uploading: false,
    uploadProgress: null,
    handleSubmit: vi.fn(),
    parish: "Vermilion",
  };
  return form as unknown as ReturnType<typeof usePostJobForm>;
}

function glanceRows(): HTMLElement[] {
  const heading = screen.getByText(/your post at a glance/i);
  const card = heading.closest(".liquid-glass") as HTMLElement;
  const list = card.querySelector(".divide-y") as HTMLElement;
  return Array.from(list.children) as HTMLElement[];
}

describe("Order Summary review card (owner 2026-10-01)", () => {
  it("has no DETAILS → REVIEW AND PAY step rail", () => {
    render(<CheckoutStepView form={makeForm()} />);
    expect(screen.queryByText(/review and pay/i)).toBeNull();
    expect(screen.queryByRole("group", { name: /step \d of \d/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /go back to edit job details/i })).toBeNull();
  });

  it("every glance row is a label plus one right-aligned value", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const rows = glanceRows();
    // Job, Category, Details, Total, Location, When at minimum.
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      const kids = Array.from(row.children) as HTMLElement[];
      expect(kids.length, `row "${row.textContent}" has label + value`).toBe(2);
      expect(kids[1].className, `value of "${kids[0].textContent}" is right-aligned`).toMatch(/\btext-right\b/);
    }
  });

  it("Category is its own row, separate from the Job title", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const rows = glanceRows();
    const label = (r: HTMLElement) => (r.children[0] as HTMLElement).textContent?.trim();
    const jobIdx = rows.findIndex((r) => label(r) === "Job");
    const catIdx = rows.findIndex((r) => label(r) === "Category");
    expect(jobIdx).toBeGreaterThanOrEqual(0);
    expect(catIdx).toBe(jobIdx + 1);
    expect(rows[jobIdx].textContent).not.toContain("Cleaning");
    expect(rows[catIdx].textContent).toContain("Cleaning");
  });

  it("the Details value is right-aligned", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const details = glanceRows().find((r) => (r.children[0] as HTMLElement).textContent?.trim() === "Details");
    expect(details).toBeDefined();
    expect((details!.children[1] as HTMLElement).className).toMatch(/\btext-right\b/);
  });

  it("Location shows the address only, never a parish", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const loc = glanceRows().find((r) => /Location/.test((r.children[0] as HTMLElement).textContent ?? ""));
    expect(loc).toBeDefined();
    expect((loc!.children[1] as HTMLElement).textContent?.trim()).toBe("314 Lynn St, Delcambre, LA, 70528");
    for (const row of glanceRows()) expect(row.textContent).not.toMatch(/parish/i);
  });
});

// Q362 / CC-003: the poster pays the urgent bonus's card fee on top so the
// Helpr gets the whole bonus. Owner, 2026-10-09 ("it's all one post"): it is
// folded into the Service Fee number, no line of its own, and the "(12%)"
// label drops because the number is no longer exactly 12%.
// @mutate src/pages/post-job/CheckoutStepView.tsx | urgentCardFeeAmount={form.urgentCardFeeAmount} | urgentCardFeeAmount={0}
// @mutate src/components/postjob/CheckoutStep.tsx |  && !foldUrgentCardFee && ( |  && (
describe("urgent bonus card fee (Q362, folded 2026-10-09)", () => {
  it("adds the card fee into the Service Fee number and shows no separate line", () => {
    const base = makeForm();
    const form = { ...base, isUrgent: true, urgentFeeNum: 15, urgentCardFeeAmount: 0.45, totalCharge: 47.45 };
    render(<CheckoutStepView form={form as unknown as ReturnType<typeof usePostJobForm>} />);
    expect(screen.queryByText("Urgent Bonus Card Fee")).toBeNull();
    const label = screen.getByText("Service Fee");
    const expected = (Number(base.customerFeeAmount) + 0.45).toFixed(2);
    expect(label.parentElement?.textContent).toContain(`$${expected}`);
    expect(screen.queryByText(/Goes to Helpr/)).toBeNull();
  });

  it("shows no card fee line on a job that is not urgent", () => {
    render(<CheckoutStepView form={makeForm()} />);
    expect(screen.queryByText("Urgent Bonus Card Fee")).toBeNull();
  });
});
