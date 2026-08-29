// "Completed Jobs" is the one list that mixes both roles — its query is
// `.or(customer_id.eq.me, helper_id.eq.me)` — so a row may be work you PAID
// for or work you WERE PAID for. Those are different quantities. The list used
// to print the raw budget for both, so a job you worked read $140 here and
// $123 on its job card, in identical type, with nothing to say which was which.
//
// These pin the rule: net take-home when you were the helper, raw budget when
// you posted it.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE_ELSE = "22222222-2222-2222-2222-222222222222";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: ME },
    // Free tier ⇒ 12% helper fee, the same ladder Earnings & Payouts uses.
    profile: { subscription_tier: "free", subscription_expires_at: null },
    isAdmin: false,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/profile", search: "", hash: "", state: null, key: "t" }),
}));

import { JobListTab } from "./JobListTab";

/** Minimal row — only the fields the amount actually depends on. */
function job(over: Record<string, unknown>) {
  return {
    id: `j-${Math.random()}`,
    title: "Assemble a patio set",
    location: "New Iberia, LA",
    date_needed: "2026-08-22",
    category: "assembly",
    status: "completed",
    budget: 140,
    payment_status: "released",
    helper_id: null,
    customer_id: SOMEONE_ELSE,
    platform_fee_amount: null,
    helper_fee_percent: null,
    urgent_fee: null,
    is_group_job: false,
    helpers_needed: 1,
    ...over,
  } as never;
}

describe("Completed Jobs — whose money is this row?", () => {
  it("shows the helper's NET take-home on a job the viewer worked", () => {
    // 140 budget, 12% free-tier fee => 123.20, rendered as $123.
    render(<JobListTab variant="completed" jobs={[job({ helper_id: ME })]} onBack={() => {}} />);
    expect(screen.getByText("$123")).toBeInTheDocument();
    expect(screen.queryByText("$140")).not.toBeInTheDocument();
  });

  it("shows the RAW budget on a job the viewer posted", () => {
    // The poster paid 140; that is their number, not a take-home.
    render(
      <JobListTab
        variant="completed"
        jobs={[job({ customer_id: ME, helper_id: SOMEONE_ELSE })]}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText("$140")).toBeInTheDocument();
  });

  it("shows the RAW budget throughout the Posted Jobs list", () => {
    render(<JobListTab variant="posted" jobs={[job({ customer_id: ME })]} onBack={() => {}} />);
    expect(screen.getByText("$140")).toBeInTheDocument();
  });
});
