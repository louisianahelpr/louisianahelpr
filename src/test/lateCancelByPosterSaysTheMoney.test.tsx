/**
 * Q2701 + Q2696 (audit 1102e rows 3 and 4): a poster's late cancel (poster_cancel_job: cancellation_fee > 0).
 *  - The poster's line read "You cancelled ... · Plans changed · Your payment was refunded", a full refund, against the
 *    cancel sheet they had just confirmed ("$30 for your Helpr's time"). It now says what was kept for the Helpr's time
 *    and that the rest came back: "... · $30 was kept for Eli's time · The rest was refunded".
 *  - The Helpr read "you get a share of the late-cancel fee" (a fee word, owner 10-25; no amount). It now says when it
 *    was cancelled and the dollars they get: the server's own share (cancellationHelperShare, the cancel dialog's quote:
 *    the fee less the flat 5% + 70c, rounded down to the whole dollar, as void-cancelled-payments sends it).
 *
 * @mutate src/components/tracker/jobProgressState.ts |   const kept = poster && posterDid && fee > 0 ? `$${formatPrice(fee)} was kept for ${other}'s time` : null; |   const kept = null;
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |     const share = cancellationHelperShare(fee, job); |     const share = { helperPayout: fee, noFee: true };
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | `${lateBy(job)}, so you get ${share.noFee \|\| isFlatFeeJob(job) ? "" : "at least "}$${share.helperPayout} for your time.` | `${lateBy(job)}, so you get a share of the late-cancel fee.`
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 2 }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "h" }, profile: null }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// Q2701: the refund ledger's figure for this job (useJobRefundedCents reads payment_refunds).
const refunded = vi.hoisted(() => ({ cents: 9040 as number | null, calls: [] as Array<[string | null | undefined, boolean | undefined]> }));
vi.mock("@/hooks/useJobRefundedCents", () => ({
  useJobRefundedCents: (id: string | null | undefined, enabled?: boolean) => { refunded.calls.push([id, enabled]); return enabled ? refunded.cents : null; },
}));
import { HelprMoneyNotes, JobTracker } from "@/pages/jobs/jobPage/JobPageParts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const NOW = new Date("2037-10-21T15:00:00Z");
const job = {
  id: "j", title: "Rake the front yard", description: null, category: "yard", budget: 120, date_needed: "2037-10-20", start_time: "09:00",
  is_flexible_schedule: false, location: null, customer_id: "p", helper_id: "h", status: "cancelled", payment_status: "refunded",
  urgent_fee: null, helpers_needed: 1, is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
  helper_confirmed_at: "2037-10-18T12:00:00Z", cancelled_by: "p", cancelled_at: "2037-10-20T11:03:00Z", // Tue 6:03 AM, 2 h 57 min before 9:00 AM
  cancellation_fee: 30, cancellation_reason: "Plans changed",
} as unknown as JobPageRow & ProgressJob;

afterEach(cleanup);

describe("a poster's late cancel says the money on both sides (Q2701, Q2696)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it("the poster's line: the amount kept for the Helpr's time, and the rest refunded, never a full refund", () => {
    const p = jobProgress(job, { viewer: "poster", otherFirst: "Eli", now: NOW });
    expect(p.next).toBe("You cancelled Tue 6:03 AM · Plans changed · $30 was kept for Eli's time · The rest was refunded");
    expect(p.next).not.toContain("Your payment was refunded");
    // An early cancel (no fee) keeps the full-refund words.
    expect(jobProgress({ ...job, cancellation_fee: 0 }, { viewer: "poster", otherFirst: "Eli", now: NOW }).next).toContain("Your payment was refunded");
  });

  // Q2701 (owner 11-03 "YES"): the poster's line shows the dollar amount refunded, from the refund ledger.
  // @mutate src/components/tracker/jobProgressState.ts |   const refund = refunded ? (back ?? (kept ? "The rest was refunded" : "Your payment was refunded")) : null; |   const refund = refunded ? (kept ? "The rest was refunded" : "Your payment was refunded") : null;
  // @mutate src/pages/jobs/jobPage/JobPageParts.tsx |     crewMember,\n    refundedCents,\n  }); |     crewMember,\n  });
  // @mutate src/pages/jobs/jobPage/JobPageParts.tsx | side === "poster" && job.status === "cancelled" && job.payment_status === "refunded" | false
  it("the poster's line names the dollars refunded when the ledger is read (Q2701)", () => {
    const p = jobProgress(job, { viewer: "poster", otherFirst: "Eli", now: NOW, refundedCents: 9040 });
    expect(p.next).toBe("You cancelled Tue 6:03 AM · Plans changed · $30 was kept for Eli's time · $90.40 was refunded");
    // An early cancel (no fee): the whole refund, in dollars.
    expect(jobProgress({ ...job, cancellation_fee: 0 }, { viewer: "poster", otherFirst: "Eli", now: NOW, refundedCents: 12000 }).next)
      .toBe("You cancelled Tue 6:03 AM · Plans changed · $120 was refunded");
    // The Helpr never reads the poster's refund.
    expect(jobProgress(job, { viewer: "helpr", otherFirst: "Pat", now: NOW, refundedCents: 9040 }).next).not.toContain("refunded");
  });

  it("the job page reads the ledger for the poster's cancelled, refunded job and shows it (Q2701)", () => {
    refunded.calls.length = 0;
    const qc = new QueryClient();
    const t = render(
      <QueryClientProvider client={qc}><MemoryRouter><JobTracker job={job} side="poster" otherFirst="Eli" /></MemoryRouter></QueryClientProvider>,
    ).container.textContent ?? "";
    expect(refunded.calls.some(([id, on]) => id === "j" && on === true)).toBe(true);
    expect(t).toContain("$90.40 was refunded");
    cleanup();
    refunded.calls.length = 0;
    render(<QueryClientProvider client={qc}><MemoryRouter><JobTracker job={job} side="helpr" otherFirst="Pat" /></MemoryRouter></QueryClientProvider>);
    expect(refunded.calls.every(([, on]) => on === false)).toBe(true);
  });

  it("the Helpr's line: when it was cancelled and the dollars they get, with no fee words", () => {
    const t = render(<MemoryRouter><HelprMoneyNotes job={job} hired /></MemoryRouter>).container.textContent ?? "";
    // $30 less the flat 5% + 70c ($2.20) is $27.80, sent rounded down: $27.
    expect(t).toBe("It was cancelled less than 3 hours before the start, so you get $27 for your time.");
    expect(t).not.toMatch(/\bfee\b/i);
  });
});
