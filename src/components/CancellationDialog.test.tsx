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
// @mutate src/components/CancellationDialog.tsx | {crewQuote ? "For your hired Helprs' time" : `For ${helperName \|\| "your Helpr"}'s time`} | {`Cancellation fee (${cancellationFeePercent}% of $${formatPrice(jobBudget)})`}
// @mutate src/components/CancellationDialog.tsx |                   Cancel anytime before you hire. Most of your payment comes back to your card within the hour. |                   Cancel anytime with no cancellation fee. Your payment is refunded, less the card-processing fee Stripe keeps.
const FEE_WORDS = /fee|%|platform|card-processing|card processing|commission/i;
const shown = () => (document.body.textContent ?? "").replace(/one-time \$[\d.]+ account setup fee/g, "");

describe("CancellationDialog shows amounts, never fees", () => {
  it("a late cancel: the dollar amount for the Helpr's time, and that most of the rest comes back", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(6) })} />);
    // 25% of $100 = $25 for the Helpr's time (the ladder, unchanged).
    expect(screen.getByText("For Marie's time")).toBeInTheDocument();
    expect(screen.getAllByText("$25").length).toBeGreaterThan(0);
    expect(screen.getByText(/Strike recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Most of the rest of your payment comes back to your card within the hour\./)).toBeInTheDocument();
    expect(shown()).not.toMatch(FEE_WORDS);
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
    expect(screen.queryByText("For Marie's time")).not.toBeInTheDocument();
    // JOBS-14 (owner 10-30): poster_cancel_job files the strike only inside 24 hours, as for Helprs.
    expect(screen.getByText(/No charge for your Helpr's time\. The start is more than 24 hours away, so this isn't a strike\./)).toBeInTheDocument();
    expect(screen.queryByText(/Strike recorded/)).not.toBeInTheDocument();
    expect(screen.getByText(/These consequences don't apply to this cancel/)).toBeInTheDocument();
    expect(screen.queryByText(/Free cancellation/)).not.toBeInTheDocument();
    expect(shown()).not.toMatch(FEE_WORDS);
  });
});
