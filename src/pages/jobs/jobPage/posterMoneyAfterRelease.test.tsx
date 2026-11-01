/**
 * THE POSTER'S FINISHED JOB SAYS IT WAS PAID AND RELEASED, WHEN THE PAY GOES OUT, AND WHERE THE RECEIPT IS.
 *
 * Audit 2026-10-28 (part 4 half 2 final leg, F32; shot p4j-disp-job-p1-375.png): after approving, the poster's
 * job page still read "Your budget $40" and nothing else, because payment_status 'payout_pending' (approved, the
 * Helpr's pay scheduled) had no line in PosterMoney. Now: "Job price", "Paid and released to your Helpr. Their pay
 * goes out <payout_scheduled_at, Louisiana time>.", and a link to the receipts.
 *
 * Since 2026-11-01 (owner: no budget card) the amount and a word sit in the header (PosterPrice) and these lines
 * under it (PosterMoneyNotes).
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

import { PosterPrice, PosterMoneyNotes } from "./JobPageParts";

const row = (over: Partial<JobPageRow>): JobPageRow => ({
  id: "j", title: "AA5-AUDIT-1029 test clean", description: null, category: "cleaning", budget: 40, date_needed: null, start_time: null,
  is_flexible_schedule: false, location: null, customer_id: "p", helper_id: "h", status: "completed", payment_status: "payout_pending",
  urgent_fee: null, helpers_needed: 1, is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
  ...over,
});

// Owner 2026-11-01: no budget card. The amount and its word sit at the right of the page header (PosterPrice); what
// a word cannot say (the release, when the pay goes out, the receipt) is PosterMoneyNotes under the header.
const show = (job: JobPageRow) =>
  render(<MemoryRouter><PosterPrice job={job} /><PosterMoneyNotes job={job} total={0} loading={false} /></MemoryRouter>);
const price = () => document.querySelector("[data-poster-money]")!.textContent ?? "";
const notes = () => document.querySelector("[data-poster-money-notes]")?.textContent ?? "";

describe("the poster's money after the release (F32)", () => {
  it("approved, pay scheduled: $40 Released, paid and released, the payout time in Louisiana, the receipt link", () => {
    const at = new Date(Date.now() + 3 * 86_400_000);
    show(row({ payout_scheduled_at: at.toISOString() }));
    expect(price()).toBe("$40Released");
    const day = at.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });
    expect(notes()).toContain(`Paid and released to your Helpr. Their pay goes out ${day} at `);
    expect(screen.getByRole("link", { name: "See your receipt" }).getAttribute("href")).toBe("/profile?tab=receipts");
  });

  it("paid out: says so, with the receipt", () => {
    show(row({ payment_status: "released" }));
    expect(notes()).toContain("Paid out to your Helpr.");
    expect(screen.getByRole("link", { name: "See your receipt" })).toBeTruthy();
  });

  it("still held: $40 Paid · held, no sentence and no receipt link", () => {
    show(row({ status: "in_progress", payment_status: "escrow" }));
    expect(price()).toBe("$40Paid · held");
    expect(document.querySelector("[data-poster-money-notes]")).toBeNull();
    expect(screen.queryByRole("link", { name: "See your receipt" })).toBeNull();
  });

  it("a held card says it is not charged yet; an unpaid post says Helprs can't see it", () => {
    show(row({ status: "open", payment_status: "held" }));
    expect(price()).toContain("Card held");
    expect(notes()).toContain("Your card isn't charged until a Helpr accepts your offer.");
    document.body.innerHTML = "";
    show(row({ status: "open", payment_status: "unpaid" }));
    expect(notes()).toContain("Not paid yet. Helprs can't see this job until it's paid.");
  });
});
