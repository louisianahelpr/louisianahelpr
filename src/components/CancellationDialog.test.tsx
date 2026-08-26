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
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

function isoDateHoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobTitle: "Fix the fence",
    jobDate: isoDateHoursFromNow(20),
    jobBudget: 100,
    hasHelper: true,
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
  it("derives the platform fee % from the job's frozen helper_fee_percent", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(6), helperFeePercent: 8 })} />);
    expect(screen.getByText("Platform fee (8%)")).toBeInTheDocument();
    // 25% of $100 = $25 fee; 8% platform cut = $2; helper gets $23.
    expect(screen.getByText("−$2")).toBeInTheDocument();
    expect(screen.getByText("$23")).toBeInTheDocument();
  });

  it("falls back to 10% when helper_fee_percent is absent", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(6), helperFeePercent: null })} />);
    expect(screen.getByText("Platform fee (10%)")).toBeInTheDocument();
    expect(screen.getByText("−$2.50")).toBeInTheDocument();
    expect(screen.getByText("$22.50")).toBeInTheDocument();
  });

  it("shows free cancellation (no breakdown) when 24+ hours out", () => {
    pinEvening();
    render(<CancellationDialog {...makeProps({ jobDate: isoDateHoursFromNow(72) })} />);
    expect(screen.queryByText(/Platform fee/)).not.toBeInTheDocument();
    expect(screen.getByText(/Free cancellation/)).toBeInTheDocument();
  });
});
