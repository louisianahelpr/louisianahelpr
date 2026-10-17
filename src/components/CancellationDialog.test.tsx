import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CancellationDialog } from "./CancellationDialog";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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

describe("CancellationDialog fee breakdown", () => {
  // The poster cannot resolve the assigned helper's tier — `profiles` RLS lets a
  // user read only their own row — and the job's stamped `helper_fee_percent` is
  // create-payment's escrow-time GLOBAL rate, not this helper's. (Quoting it
  // told a poster the helper would receive $54.00 on a job where
  // void-cancelled-payments transferred $55.20.) So the dialog quotes the
  // ladder's HIGHEST commission, making the helper figure a guaranteed floor.
  it("quotes the helper's share as a floor, using the highest ladder rate", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(6) })} />);
    expect(screen.getByText("Platform fee (up to 12%)")).toBeInTheDocument();
    // 25% of $100 = $25 fee; 12% platform cut = $3; helper gets at least $22.
    expect(screen.getByText("−$3")).toBeInTheDocument();
    expect(screen.getByText("at least $22")).toBeInTheDocument();
  });

  it("ignores the job's stamped helper_fee_percent entirely", () => {
    pinEvening();
    render(
      <CancellationDialog
        {...makeProps({ jobDate: isoDateHoursFromNow(6), helperFeePercent: 8 })}
      />,
    );
    // Would have read "Platform fee (8%)" / "$23" under the old stamped rule.
    expect(screen.getByText("Platform fee (up to 12%)")).toBeInTheDocument();
    expect(screen.queryByText("$23")).not.toBeInTheDocument();
  });

  // Q1839: a flat-model job (jobs.helper_fee_flat_cents stamped) pays the
  // Helpr the fee minus 5% + 70c, the cut void-cancelled-payments takes. Under
  // $10 that cut is larger than 12%, so the 12% "floor" overstated the Helpr's
  // pay: 25% of $32 = $8 fee; 12% leaves $7, 5% + 70c ($1.10) leaves $6.
  it("prices a flat-model job's Helpr share from its stamp, not the 12% rung", () => {
    pinEvening();
    render(
      <CancellationDialog
        {...makeProps({ jobDate: isoDateHoursFromNow(6), jobBudget: 32, feeStamp: { helper_fee_flat_cents: 70, helper_fee_percent: 5 } })}
      />,
    );
    expect(screen.getByText("Platform fee (5% + $0.70)")).toBeInTheDocument();
    expect(screen.getByText("at least $6")).toBeInTheDocument();
    expect(screen.queryByText("at least $7")).not.toBeInTheDocument();
  });

  it("keeps the 12% floor on a legacy job (no stamp)", () => {
    pinEvening();
    render(
      <CancellationDialog
        {...makeProps({ jobDate: isoDateHoursFromNow(6), jobBudget: 32, feeStamp: { helper_fee_flat_cents: null, helper_fee_percent: 10 } })}
      />,
    );
    expect(screen.getByText("Platform fee (up to 12%)")).toBeInTheDocument();
    expect(screen.getByText("at least $7")).toBeInTheDocument();
  });

  // Q1842: a flat-model job (F3) was charged the job price only, so the
  // "service fee isn't refundable" copy is false for it; its refund is the
  // payment less Stripe's card-processing fee. A legacy job keeps the old copy.
  // @mutate src/components/CancellationDialog.tsx |   const flatModel = isFlatFeeJob(feeStamp); |   const flatModel = false;
  it("a flat-model job's refund copy names the card-processing fee, not a service fee", () => {
    render(
      <CancellationDialog
        {...makeProps({ hasHelper: false, jobDate: isoDateHoursFromNow(72), feeStamp: { helper_fee_flat_cents: 70, helper_fee_percent: 5 } })}
      />,
    );
    expect(screen.getByText(/Your payment is refunded, less the card-processing fee Stripe keeps\./)).toBeInTheDocument();
    expect(screen.getByText("$0 cancellation fee · Refunded less card fee · No consequences")).toBeInTheDocument();
    expect(screen.queryByText(/service fee/i)).not.toBeInTheDocument();
  });

  it("a legacy job keeps its service-fee refund copy", () => {
    render(
      <CancellationDialog
        {...makeProps({ hasHelper: false, jobDate: isoDateHoursFromNow(72), feeStamp: { helper_fee_flat_cents: null, helper_fee_percent: 10 } })}
      />,
    );
    expect(screen.getByText(/the service fee isn't refundable once payment has been processed/)).toBeInTheDocument();
    expect(screen.getByText("$0 cancellation fee · Budget refunded · No consequences")).toBeInTheDocument();
  });

  it("shows free cancellation (no breakdown) when 24+ hours out", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(72) })} />);
    expect(screen.queryByText(/Platform fee/)).not.toBeInTheDocument();
    expect(screen.getByText(/Free cancellation/)).toBeInTheDocument();
  });
});

// Quotes a commission rate that is NOT the ladder's highest, so the helper's
// share stops being a floor — the exact shape that told a poster $54.00 on a
// job where void-cancelled-payments transferred $55.20.
// @mutate src/lib/cancellationHelperShare.ts |   const platformCut = Math.round(fee * MAX_HELPER_FEE_PERCENT) / 100; |   const platformCut = Math.round(fee * 8) / 100;
// @mutate src/components/CancellationDialog.tsx |   const { platformCut, helperPayout, feeLabel } = cancellationHelperShare(payeeFee, feeStamp); |   const { platformCut, helperPayout, feeLabel } = cancellationHelperShare(payeeFee, null);
