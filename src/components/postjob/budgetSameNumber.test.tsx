/**
 * Post a Job's Budget is the poster's own number (owner, 2026-10-08: "remove the
 * suggested prices from post a job ... also remove jobs under rarely get
 * applications"). What stays: the field, the minimum and the cap.
 *
 * Earlier (2026-10-01) this file pinned the "Use $X" chip agreeing with the
 * field; the chip is gone with the suggestions.
 *
 * @mutate src/components/postjob/BudgetSection.tsx |   const underBudgetMin = budgetNum > 0 && budgetNum < MIN_JOB_BUDGET_DOLLARS; |   const underBudgetMin = false;
 */
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
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

describe("Post a Job budget: the poster's own number", () => {
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
});
