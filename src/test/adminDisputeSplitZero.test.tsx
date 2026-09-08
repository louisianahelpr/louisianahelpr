/**
 * A dispute split at the extremes (100/0 or 0/100) must never print "−$0.00".
 * A minus sign on a zero deduction reads as a charge that does not exist —
 * "−$0.00 Stripe keeps" beside "$0.00 refunded" on the losing column. A
 * value that rounds to zero renders as "$0.00", no sign, in every column.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { DisputeCard } from "@/components/admin/adminDisputes/DisputeCard";
import type { DisputedJob } from "@/components/admin/adminDisputes/types";

const JOB_ID = "bb2c3732-476a-4f66-aae6-372cbdfcfdf6";

const job: DisputedJob = {
  id: JOB_ID,
  title: "Lockbox code was wrong",
  budget: 180,
  status: "completed",
  dispute_reason: "Helpr never got inside",
  dispute_evidence_urls: [],
  disputed_at: "2026-09-05T10:00:00Z",
  disputed_by: "poster-1",
  customer_id: "poster-1",
  helper_id: "helper-1",
  stripe_payment_intent_id: "pi_1",
  urgent_fee: 0,
  helper_fee_percent: 12,
  customer_fee_amount: 5,
  sales_tax_amount: 0,
  payment_status: "escrow",
};

const renderAt = (helperShare: number) => {
  const { container } = render(
    <DisputeCard
      job={job}
      filter="open"
      disputeRecords={{}}
      profiles={{ "poster-1": "Pat Poster", "helper-1": "Hal Helpr" }}
      tiers={{ "helper-1": null }}
      activePanelJobId={JOB_ID}
      resolving={null}
      decisionText=""
      helperShare={helperShare}
      setDecisionText={vi.fn()}
      setHelperShare={vi.fn()}
      setActivePanelJobId={vi.fn()}
      decide={vi.fn()}
      retrySettlement={vi.fn()}
      retrying={null}
    />,
  );
  return () => container.textContent ?? "";
};

describe("dispute split preview at the extremes", () => {
  it("100% Helpr: the poster column shows $0.00 with no minus sign", () => {
    const text = renderAt(100);
    expect(text()).toMatch(/Poster 0%\$0\.00refunded\$0\.00 gross\$0\.00 Stripe keeps/);
    expect(text()).not.toMatch(/[−-]\$0\.00/);
  });

  it("100% poster: the Helpr column shows $0.00 with no minus sign", () => {
    const text = renderAt(0);
    expect(text()).toMatch(/Helpr 0%\$0\.00paid\$0\.00 gross\$0\.00 commission \(12%\)/);
    expect(text()).not.toMatch(/[−-]\$0\.00/);
  });

  it("a non-zero deduction still carries the minus sign", () => {
    const text = renderAt(50);
    expect(text()).toContain("−$10.80 commission (12%)");
  });
});
