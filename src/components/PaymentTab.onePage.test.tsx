/**
 * Q1177: PaymentTab is the one-page Earnings tab's bank-account section. Kept
 * (owner, 2026-10-04): "Next expected" and the Spent card, with the same
 * figures for the same data. Removed: "Last payout · $X on date" (the payouts
 * list states every payout), the Spent card's own range control (a second
 * toggle beside the Earned card's), and the "No activity yet" card (the
 * payouts list's empty state already says it).
 *
 * The two "same figures" tests were run unchanged against PaymentTab on
 * origin/main before the redesign and passed there too.
 */
// @mutate src/components/PaymentTab.tsx | const nextExpected = new Date(paidAt.getTime() + 7 * 86400 * 1000); | const nextExpected = new Date(paidAt.getTime() + 6 * 86400 * 1000);
// @mutate src/components/PaymentTab.tsx | const lifetimeSpent = spentJobs.reduce((s, j) => s + j.budget, 0); | const lifetimeSpent = spentJobs.reduce((s, j) => s + 0 * j.budget, 0);
// @mutate src/components/PaymentTab.tsx | const hasNoActivity = lifetimeSpent === 0 && totalEarnings === 0; | const hasNoActivity = lifetimeSpent === 0;
// @mutate src/components/PaymentTab.tsx |       {!hasNoActivity && ( |       {true && (
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
let spent: { id: string; budget: number; poster_completed_at: string | null; helper_completed_at: string | null; created_at: string }[];

/** A PostgREST builder stand-in: every filter returns itself; the payout read
 *  ends in maybeSingle(), the spend read is awaited directly. */
function builder(table: string) {
  const result = () =>
    table === "payout_transfers" ? { data: lastPaid, error: null } : { data: spent, error: null };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
  b.maybeSingle = async () => result();
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => builder(table) },
}));

import { PaymentTab } from "./PaymentTab";

function renderTab(totalEarnings: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentTab totalEarnings={totalEarnings} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PaymentTab on the one-page Earnings tab (Q1177)", () => {
  beforeEach(() => {
    // AnimatedCounter jumps straight to its value under reduced motion.
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    lastPaid = { amount_cents: 12_000, paid_at: "2026-10-01T15:00:00Z", created_at: "2026-10-01T15:00:00Z", status: "paid" };
    spent = [
      { id: "p1", budget: 30, poster_completed_at: "2026-09-01T12:00:00Z", helper_completed_at: null, created_at: "2026-08-30T12:00:00Z" },
      { id: "p2", budget: 20.5, poster_completed_at: "2025-12-01T12:00:00Z", helper_completed_at: null, created_at: "2025-11-30T12:00:00Z" },
    ];
  });

  it("same figures: next expected payout is the last paid one plus seven days", async () => {
    renderTab(0);
    const line = await screen.findByText(/Next expected:/);
    expect(line.textContent).toMatch(/Next expected: ~Oct 8 · Stripe rolls weekly/);
  });

  it("same figures: Total spent is the lifetime sum of completed posted jobs", async () => {
    renderTab(0);
    await waitFor(() => expect(document.body.textContent).toMatch(/Total spent\s*\$50\.50\s*across 2 jobs/));
  });

  it("states no 'Last payout' line and carries no range control of its own", async () => {
    renderTab(0);
    await screen.findByText(/Next expected:/);
    await screen.findByText("Spent");
    expect(screen.queryByText(/Last payout/)).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("This Week")).toBeNull();
  });

  it("renders no Spent card and no 'No activity yet' card when no money has moved", async () => {
    spent = [];
    lastPaid = null;
    renderTab(0);
    await screen.findByText("payout setup form");
    await waitFor(() => expect(screen.queryByText("Spent")).toBeNull());
    expect(screen.queryByText(/No activity yet/)).toBeNull();
    expect(screen.queryByText(/Next expected/)).toBeNull();
  });

  it("keeps the Spent card for a Helpr who earned but never posted ($0 spent)", async () => {
    spent = [];
    renderTab(90);
    await screen.findByText("Spent");
    expect(document.body.textContent).toMatch(/Total spent\s*\$0\.00\s*no jobs yet/);
  });
});
