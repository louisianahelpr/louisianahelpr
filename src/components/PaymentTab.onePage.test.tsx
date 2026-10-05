/**
 * Q1177: PaymentTab is the Money tab's PAYOUT ACCOUNT block (the connect card
 * at the top until payouts are set up, the bank account at the floor of the
 * Earned half after). Kept: "Next expected", same figure for the same data.
 * Removed: "Last payout · $X on date" (the payouts list states every payout)
 * and the Spent card, which is now the Spent half (SpentSection.test.tsx).
 *
 * The "same figures" test was run unchanged against PaymentTab on
 * origin/main before the redesign and passed there too.
 */
// @mutate src/components/PaymentTab.tsx | const nextExpected = new Date(paidAt.getTime() + 7 * 86400 * 1000); | const nextExpected = new Date(paidAt.getTime() + 6 * 86400 * 1000);
// @mutate src/components/PaymentTab.tsx |   const settled = !!user?.id && formSettled && !lastPayoutLoading; |   const settled = !!user?.id && formSettled;
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, profile: null, loading: false }),
}));
vi.mock("@/components/PayoutSetupForm", () => ({
  PayoutSetupForm: ({ onSettled }: { onSettled?: () => void }) => {
    useEffect(() => { onSettled?.(); }, [onSettled]);
    return <p>payout setup form</p>;
  },
}));

let lastPaid: { amount_cents: number; paid_at: string | null; created_at: string; status: string } | null;
let resolveLastPaid: (() => void) | null = null;

/** A PostgREST builder stand-in: every filter returns itself; the payout read
 *  ends in maybeSingle(). `hold` keeps it pending until released. */
let hold = false;
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
  b.maybeSingle = () =>
    hold
      ? new Promise((r) => { resolveLastPaid = () => r({ data: lastPaid, error: null }); })
      : Promise.resolve({ data: lastPaid, error: null });
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => builder() },
}));

import { PaymentTab } from "./PaymentTab";

function renderTab(onSettled?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentTab onSettled={onSettled} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PaymentTab, the Money tab's payout account (Q1177)", () => {
  beforeEach(() => {
    hold = false;
    lastPaid = { amount_cents: 12_000, paid_at: "2026-10-01T15:00:00Z", created_at: "2026-10-01T15:00:00Z", status: "paid" };
  });

  it("same figures: next expected payout is the last paid one plus seven days", async () => {
    renderTab();
    const line = await screen.findByText(/Next expected:/);
    expect(line.textContent).toMatch(/Next expected: ~Oct 8 · Stripe rolls weekly/);
  });

  it("states no 'Last payout' line, no Spent card and no range control", async () => {
    renderTab();
    await screen.findByText(/Next expected:/);
    expect(screen.queryByText(/Last payout/)).toBeNull();
    expect(screen.queryByText("Spent")).toBeNull();
    expect(screen.queryByText(/Total spent/)).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("no paid payout on record: no Next expected card", async () => {
    lastPaid = null;
    const onSettled = vi.fn();
    renderTab(onSettled);
    await screen.findByText("payout setup form");
    // Wait for the last-payout read to ANSWER first, so "no card" is the loaded state.
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(screen.queryByText(/Next expected/)).toBeNull();
  });

  it("reports settled only once its last-payout read has answered", async () => {
    hold = true;
    const onSettled = vi.fn();
    renderTab(onSettled);
    await screen.findByText("payout setup form");
    await new Promise((r) => setTimeout(r, 20));
    expect(onSettled).not.toHaveBeenCalled();
    resolveLastPaid?.();
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });
});
