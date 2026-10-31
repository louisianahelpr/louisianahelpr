/**
 * THE POSTER'S FINISHED JOB SAYS IT WAS PAID AND RELEASED, WHEN THE PAY GOES OUT, AND WHERE THE RECEIPT IS.
 *
 * Audit 2026-10-28 (part 4 half 2 final leg, F32; shot p4j-disp-job-p1-375.png): after approving, the poster's
 * job page still read "Your budget $40" and nothing else, because payment_status 'payout_pending' (approved, the
 * Helpr's pay scheduled) had no line in PosterMoney. Now: "Job price", "Paid and released to your Helpr. Their pay
 * goes out <payout_scheduled_at, Louisiana time>.", and a link to the receipts.
 *
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | const RELEASED = new Set(["payout_pending", "released"]); | const RELEASED = new Set(["released"]);
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |       {released && ( |       {false && (
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { JobPageRow } from "./useJobPage";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "p" }, profile: null }) }));
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
// card_hold_at_post (F4, same component): off unless a case turns it on.
const flags = vi.hoisted(() => ({ cardHold: false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "card_hold_at_post" && flags.cardHold }));

import { PosterMoney } from "./JobPageParts";

const row = (over: Partial<JobPageRow>): JobPageRow => ({
  id: "j", title: "AA5-AUDIT-1029 test clean", description: null, category: "cleaning", budget: 40, date_needed: null, start_time: null,
  is_flexible_schedule: false, location: null, customer_id: "p", helper_id: "h", status: "completed", payment_status: "payout_pending",
  urgent_fee: null, helpers_needed: 1, is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
  ...over,
});

const show = (job: JobPageRow) =>
  render(<MemoryRouter><PosterMoney job={job} total={0} loading={false} /></MemoryRouter>);

describe("the poster's money after the release (F32)", () => {
  it("approved, pay scheduled: Job price, paid and released, the payout time in Louisiana, the receipt link", () => {
    // The audit's moment: payout_scheduled_at 2026-11-01 04:13Z = Sat, Oct 31 at 11:13 PM in Louisiana.
    const at = new Date(Date.now() + 3 * 86_400_000);
    show(row({ payout_scheduled_at: at.toISOString() }));
    const card = document.querySelector("[data-poster-money]")!;
    expect(card.textContent).toContain("Job price");
    expect(card.textContent).not.toContain("Your budget");
    const day = at.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });
    expect(card.textContent).toContain(`Paid and released to your Helpr. Their pay goes out ${day} at `);
    expect(screen.getByRole("link", { name: "See your receipt" }).getAttribute("href")).toBe("/profile?tab=receipts");
  });

  it("paid out: says so, with the receipt", () => {
    show(row({ payment_status: "released" }));
    expect(document.querySelector("[data-poster-money]")!.textContent).toContain("Paid out to your Helpr.");
    expect(screen.getByRole("link", { name: "See your receipt" })).toBeTruthy();
  });

  it("still held: the budget and no receipt link", () => {
    show(row({ status: "in_progress", payment_status: "escrow" }));
    expect(document.querySelector("[data-poster-money]")!.textContent).toContain("Your budget");
    expect(screen.queryByRole("link", { name: "See your receipt" })).toBeNull();
  });

  it("under card hold (F4 + F32 together): a held job says Paid with no 'when you posted'; a released one still says released", () => {
    flags.cardHold = true;
    try {
      show(row({ status: "in_progress", payment_status: "escrow" }));
      expect(document.querySelector("[data-poster-money]")!.textContent).toContain("Paid. Louisiana Helpr holds it until the job is done.");
      document.body.innerHTML = "";
      show(row({ payout_scheduled_at: null }));
      expect(document.querySelector("[data-poster-money]")!.textContent).toContain("Paid and released to your Helpr.");
    } finally {
      flags.cardHold = false;
    }
  });
});
