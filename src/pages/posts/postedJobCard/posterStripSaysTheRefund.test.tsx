/**
 * F105 (owner UI audit 2026-11-09, data): the poster's cancelled Posted card said "Your payment was refunded" while
 * Receipts showed $1.17 kept on the same job (53c98775: $28.83 refunded). The card's strip reads the Receipts numbers
 * (usePosterJobRefund) and says them.
 *
 * @mutate src/pages/posts/postedJobCard/PosterStatusStrip.tsx | job.helper_id ? helperName : null, refund ? { refund } : undefined) | job.helper_id ? helperName : null)
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const posterRefund = vi.hoisted(() => ({ value: null as { refundedCents: number; keptCents: number } | null }));
vi.mock("@/hooks/usePosterJobRefund", () => ({ usePosterJobRefund: () => posterRefund.value }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "p" }, profile: null }) }));

import { PosterStatusStrip } from "./PosterStatusStrip";
import type { Job } from "@/components/job-card/activityConstants";

const job = { id: "j1", status: "cancelled", payment_status: "refunded", cancellation_reason: "Plans changed", customer_id: "p", helper_id: null } as unknown as Job;
const text = () => {
  const { container, unmount } = render(<MemoryRouter><PosterStatusStrip job={job} pendingApplicantCount={0} completedMeta={undefined} /></MemoryRouter>);
  const t = container.textContent ?? "";
  unmount();
  return t;
};

describe("F105: the cancelled Posted card says the Receipts refund numbers", () => {
  it("with the numbers: the amount and that the card cost isn't refunded; never 'Your payment was refunded'", () => {
    posterRefund.value = { refundedCents: 2883, keptCents: 117 };
    try {
      const t = text();
      expect(t).toContain("$28.83 refunded · Card processing cost isn't refunded.");
      expect(t).not.toContain("Your payment was refunded");
    } finally {
      posterRefund.value = null;
    }
  });

  it("without them (loading or no read): a refund was sent, never that it was whole", () => {
    const t = text();
    expect(t).toContain("Refund sent to your card");
    expect(t).not.toContain("Your payment was refunded");
  });
});
