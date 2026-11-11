/**
 * Post a job's Budget is the poster's own number (owner, 2026-10-08: "remove the
 * suggested prices from post a job ... also remove jobs under rarely get
 * applications"). What stays: the field, the minimum and the cap.
 *
 * Earlier (2026-10-01) this file pinned the "Use $X" chip agreeing with the
 * field; the chip is gone with the suggestions.
 *
 * Audit 11-01 JA-43: ONE budget control. The big number is the field; the separate "Budget * $0.00" field
 * under it (the same value twice) is gone, and − / + move that one field.
 * @mutate src/components/postjob/BudgetSection.tsx |               hero\n | \n
 * @mutate src/components/postjob/BudgetSection.tsx |   const underBudgetMin = budget.trim() !== "" && budgetNum < MIN_JOB_BUDGET_DOLLARS; |   const underBudgetMin = false;
 * @mutate src/components/postjob/BudgetSection.tsx |   const underBudgetMin = budget.trim() !== "" && budgetNum < MIN_JOB_BUDGET_DOLLARS; |   const underBudgetMin = budgetNum > 0 && budgetNum < MIN_JOB_BUDGET_DOLLARS;
 * @mutate src/components/postjob/BudgetSection.tsx | setBudget(next === undefined ? "" : Math.abs(next).toString()) | setBudget(next === undefined ? "" : next.toString())
 */
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BudgetSection } from "./BudgetSection";

function Harness({ initial = "" }: { initial?: string }) {
  const [budget, setBudget] = useState(initial);
  return (
    <BudgetSection
      stepNumber={3}
      budget={budget}
      setBudget={setBudget}
      isUrgent={false}
      setIsUrgent={() => {}}
      urgentFee=""
      setUrgentFee={() => {}}
      customUrgentFee={false}
      setCustomUrgentFee={() => {}}
      budgetComplete={false}
    />
  );
}

describe("Post a job budget: the poster's own number", () => {
  it("no suggested range, no Use button, no preset prices, no lowball warning", () => {
    render(<Harness initial="12" />);
    expect(screen.queryByText(/Suggested:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Use \$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^\$\d+$/ })).toBeNull();
    expect(screen.queryByText(/rarely get applicants/)).toBeNull();
  });

  it("a budget under the minimum says what the minimum is", () => {
    render(<Harness initial="5" />);
    expect(screen.getByText(/minimum budget is \$10/i).closest('[role="status"]')).not.toBeNull();
  });

  it("no minimum message at or above the minimum", () => {
    render(<Harness initial="10" />);
    expect(screen.queryByText(/minimum budget is/i)).toBeNull();
  });

  // F302 (audit 11-10): '0' and '-5' only greyed the button; letters never reach the field (stripFormatting).
  it("a typed 0 says what the minimum is", () => {
    cleanup();
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "Job budget in dollars" }), { target: { value: "0" } });
    expect(screen.getByText(/minimum budget is \$10/i).closest('[role="status"]')).not.toBeNull();
  });

  it("a minus sign is dropped as it is typed, and letters are ignored", () => {
    cleanup();
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Job budget in dollars" }) as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "-25" } });
    expect(field.value).toBe("25");
    expect(screen.queryByText(/minimum budget is/i)).toBeNull();
    fireEvent.change(field, { target: { value: "abc" } });
    expect(field.value).toBe("");
    expect(screen.queryByText(/minimum budget is/i)).toBeNull();
  });

  it("JA-43: one budget control; the big number is the field and the steppers move it", () => {
    cleanup();
    const { container } = render(<Harness initial="120" />);
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(1);
    const budget = screen.getByRole("textbox", { name: "Job budget in dollars" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByText(/^Budget$/)).toBeNull();
    expect((budget as HTMLInputElement).value).toBe("120");
    expect(budget.className).toMatch(/text-ds-40/);
    fireEvent.click(screen.getByRole("button", { name: "Raise the budget by $5" }));
    expect((screen.getByRole("textbox", { name: "Job budget in dollars" }) as HTMLInputElement).value).toBe("125");
  });
});
