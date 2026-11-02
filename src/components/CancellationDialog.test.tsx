import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CancellationDialog } from "./CancellationDialog";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // The dialog's open-effect reads the job's series columns; give the
    // mock a resolvable chain so the fee-breakdown tests stay focused.
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

function isoDateHoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobTitle: "Fix the fence",
    jobDate: isoDateHoursFromNow(20),
    jobStartTime: null,
    jobBudget: 100,
    hasHelper: true,
    wasFunded: true,
    helperName: "Marie",
    open: true,
    onClose: vi.fn(),
    onCancelled: vi.fn(),
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

// Pin "now" so local-midnight parsing of jobDate lands deterministically in
// the 25% (<24h) tier: at 20:00 local, tomorrow's midnight is 4h away.
function pinEvening() {
  const now = new Date();
  now.setHours(20, 0, 0, 0);
  vi.useFakeTimers({ now, toFake: ["Date"] });
}

// Owner 2026-10-25: members never see a fee name, percentage or fee maths. The
// confirm screen shows the dollar amount for the Helpr's time and that most of
// the rest comes back; nothing else.
// Q2674 (audit 1102e row 7): the $ for the Helpr's time was said four times and "most of the rest comes back" twice,
// under a greyed "Before a Helpr is selected" step and an all-caps strike box. Now ONE money box ("$25 for Marie's
// time · counts as a strike"), what comes back said once (Back to you), no past step, the strike box only when it applies.
// @mutate src/components/cancellationDialog/CancelDialogNotices.tsx | {crew ? "your hired Helprs'" : `${helperName \|\| "your Helpr"}'s`} time | {crew ? "your hired Helprs'" : "your Helpr's"} time
// @mutate src/components/cancellationDialog/CancelDialogNotices.tsx |           {feeTier}{strike ? " · counts as a strike" : ""} |           {feeTier} · most of the rest of your payment comes back to you
// @mutate src/components/CancellationDialog.tsx |             {!hasHelper && (<> |             {(<>
// @mutate src/components/CancellationDialog.tsx |           {strikeApplies && ( |           {(
// @mutate src/components/cancellationDialog/CancelDialogNotices.tsx | comes out of that amount and is sent | comes out of the ${formatPrice(fee)} and is sent
// @mutate src/components/CancellationDialog.tsx |                   Cancel anytime before you hire. Most of your payment comes back to your card within the hour. |                   Cancel anytime with no cancellation fee. Your payment is refunded, less the card-processing fee Stripe keeps.
const FEE_WORDS = /fee|%|platform|card-processing|card processing|commission/i;
const shown = () => (document.body.textContent ?? "").replace(/one-time \$[\d.]+ account setup fee/g, "");

describe("CancellationDialog shows amounts, never fees", () => {
  it("a late cancel: ONE money box for the Helpr's time and the strike, what comes back said once (Q2674)", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(6) })} />);
    const t = shown();
    // 25% of $100 = $25 for the Helpr's time (the ladder, unchanged): in the box and on the button, nowhere else.
    expect(screen.getByText(/for Marie's time/)).toBeInTheDocument();
    expect(t.match(/\$25(?:\.00)?\b/g)?.length).toBe(2);
    expect(t).toContain("Cancel · pay $25");
    expect(screen.getByText(/ before job · counts as a strike$/)).toBeInTheDocument();
    expect(t.match(/Back to you/g)?.length).toBe(1);
    expect(t).not.toMatch(/most of the rest/i);
    expect(t).not.toMatch(/Before a Helpr is selected/);
    expect(t).toContain("How strikes work");
    expect(t).toContain("Keep the job");
    expect(t).not.toMatch(FEE_WORDS);
  });

  it("a flat-model job, and a legacy one, before a hire: most of the payment comes back, no fee named", () => {
    for (const feeStamp of [{ helper_fee_flat_cents: 70, helper_fee_percent: 10 }, { helper_fee_flat_cents: null, helper_fee_percent: 10 }]) {
      const { unmount } = render(
        <CancellationDialog {...makeProps({ hasHelper: false, jobDate: isoDateHoursFromNow(72), feeStamp })} />,
      );
      expect(screen.getByText(/Most of your payment comes back to your card within the hour\./)).toBeInTheDocument();
      expect(screen.getByText("Nothing goes to a Helpr · No consequences")).toBeInTheDocument();
      expect(shown()).not.toMatch(FEE_WORDS);
      unmount();
    }
  });

  it("24+ hours out with a Helpr: nothing for the Helpr's time, no breakdown", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(72) })} />);
    expect(screen.queryByText(/for Marie's time/)).not.toBeInTheDocument();
    // JOBS-14 (owner 10-30): poster_cancel_job files the strike only inside 24 hours, as for Helprs.
    expect(screen.getByText(/No charge for your Helpr's time\. The start is more than 24 hours away, so this isn't a strike\./)).toBeInTheDocument();
    expect(screen.queryByText(/ before job · counts as a strike$/)).not.toBeInTheDocument();
    // Q2674: no strike box on a cancel that is no strike (the green line above says so).
    expect(screen.queryByText(/How strikes work/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Free cancellation/)).not.toBeInTheDocument();
    expect(shown()).not.toMatch(FEE_WORDS);
  });
});
