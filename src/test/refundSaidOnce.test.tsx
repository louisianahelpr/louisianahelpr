/**
 * Lead 11-01 (B107): the poster's cancelled job page said the refund twice: "Refunded to your card." under the price
 * and "You cancelled · Plans changed · Your payment was refunded" on the tracker. It is said once, on the tracker.
 * An expired listing's tracker says only "No Helpr was hired in time", so its page keeps the money line (once).
 *
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | : refundInTracker ? null : HELD_LINE[status] | : HELD_LINE[status]
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0 }));

import { JobTracker, PosterMoneyNotes } from "@/pages/jobs/jobPage/JobPageParts";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const base = {
  id: "j1", title: "Haul off an old couch", status: "cancelled", payment_status: "refunded", customer_id: "p", helper_id: null,
  date_needed: jobLocalDateISO(2), start_time: "09:00", is_group_job: false, budget: 120,
} as unknown as JobPageRow;

const pageText = (job: JobPageRow) => {
  const { container, unmount } = render(
    <MemoryRouter>
      <PosterMoneyNotes job={job} total={0} loading={false} />
      <JobTracker job={job} side="poster" trackingStatus={null} otherFirst={null} />
    </MemoryRouter>,
  );
  const t = container.textContent ?? "";
  unmount();
  return t;
};
const refunds = (t: string) => (t.match(/refunded/gi) ?? []).length;

describe("the refund is said once on the job page", () => {
  it("a cancelled job: once, on the tracker line", () => {
    const t = pageText({ ...base, cancelled_by: "p", cancellation_reason: "Plans changed" } as JobPageRow);
    expect(t).toContain("Your payment was refunded");
    expect(refunds(t)).toBe(1);
  });

  it("an expired listing: once, under the price", () => {
    const t = pageText({ ...base, cancelled_by: null, cancellation_reason: "Job listing expired: no Helpr was hired" } as JobPageRow);
    expect(t).toContain("Refunded to your card.");
    expect(refunds(t)).toBe(1);
  });
});
