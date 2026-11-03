/**
 * Q2557: the crew cancel dialog shows the SERVER's crew fee (create-payment cancel_quote, priced as
 * poster_cancel_job prices it, a banned or under-review member at 0) instead of the client's estimate, and a crew
 * cancel still sends no p_expected_fee_cents. Server half: src/test/edge/crewCancelQuoteSeesFrozen.test.ts.
 *
 * @mutate src/components/CancellationDialog.tsx |     ? (crewServerFeeCents !== null ? crewServerFeeCents / 100 : crewQuote.total) |     ? crewQuote.total
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── The dialog shows the server's crew fee ────────────────────────────────────────────────────────────────────────
const invoke = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn(), hapticLight: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          in: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
        })),
      })),
    })),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

import { CancellationDialog } from "@/components/CancellationDialog";

describe("the crew dialog (Q2557)", () => {
  const props = {
    jobId: "job-crew", jobTitle: "Move a piano", jobDate: new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10),
    jobStartTime: null, jobBudget: 300, hasHelper: true, wasFunded: true, helperName: "",
    open: true, onClose: vi.fn(), onCancelled: vi.fn(),
    crew: { needed: 3, members: [10000, 10000, 10000].map((s) => ({ share_cents: s, confirmed: true })) },
  };
  beforeEach(() => { invoke.mockReset(); rpc.mockReset(); });

  it("shows the server's crew fee, not the client's estimate, and the cancel still sends no expected fee", async () => {
    invoke.mockResolvedValue({ data: { can_cancel: true, fee_cents: 1234, fee_percent: 25, back_to_you_cents: null, unquoted_reason: "crew", charge_state: null }, error: null });
    rpc.mockResolvedValue({ data: { action: "none", cancellation_fee: 12.34 }, error: null });
    render(<CancellationDialog {...props} />);
    const btn = await screen.findByRole("button", { name: /^cancel · pay \$12\.34$/i });
    fireEvent.click(btn);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("poster_cancel_job", expect.anything()));
    const args = rpc.mock.calls.find(([n]) => n === "poster_cancel_job")?.[1] as Record<string, unknown>;
    expect(args.p_expected_fee_cents).toBeUndefined();
  });

  it("no server fee: the dialog's own crew estimate stays", async () => {
    invoke.mockResolvedValue({ data: { can_cancel: true, fee_cents: null, fee_percent: null, back_to_you_cents: null, unquoted_reason: "crew", charge_state: null }, error: null });
    render(<CancellationDialog {...props} />);
    expect(await screen.findByRole("button", { name: /^cancel · pay \$/i })).toBeTruthy();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /\$12\.34/ })).toBeNull();
  });
});
