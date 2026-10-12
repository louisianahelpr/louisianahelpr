import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminAnalytics from "./AdminAnalytics";

/**
 * Owner 2026-10-12, "Test mode for test accounts": the shared test accounts now
 * pay and get paid on the Stripe TEST key. Their payouts are written to the
 * same payout_transfers ledger, on is_seed jobs, and must never count as money
 * the platform paid out. "Helpr Payouts" summed EVERY settled payout_transfers
 * row, seed jobs included (every other source in this loader is seed-filtered).
 *
 * @mutate src/components/admin/AdminAnalytics.tsx |       .filter((t) => t.jobs?.is_seed !== true) |       .filter(() => true)
 */

const transfers = vi.hoisted(() => ({
  rows: [
    // A test-mode payout on a test job: $500.00.
    { amount_cents: 50000, status: "paid", job_id: "job-seed", jobs: { is_seed: true } },
    // A real payout: $8.00.
    { amount_cents: 800, status: "paid", job_id: "job-real", jobs: { is_seed: false } },
    // A real payout whose job row is gone still counts: $2.00.
    { amount_cents: 200, status: "paid", job_id: null, jobs: null },
  ],
}));

function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  const self = new Proxy(b, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
      return () => self;
    },
  });
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) =>
      builder(table === "payout_transfers" ? { data: transfers.rows, error: null } : { data: [], error: null }),
  },
}));
vi.mock("./giftCardPaidJobIds", () => ({
  loadGiftCardPaidJobIds: async () => ({ ids: new Set<string>(), error: null }),
}));

describe("AdminAnalytics: test-mode payouts never count as Helpr Payouts", () => {
  it("sums only the real ledger rows ($10.00), never the $500.00 test payout", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AdminAnalytics />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Helpr Payouts")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    expect(screen.queryByText("$510.00")).not.toBeInTheDocument();
  });
});
