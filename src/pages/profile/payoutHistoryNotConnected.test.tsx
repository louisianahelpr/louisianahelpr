/**
 * Payout history for a member with no payout account while setup is not offered.
 *
 * ui-sweep (nightly-red #3491, run 40826596311): /profile?tab=payout_history rendered only its
 * title, "Payout history" (BLANK_SCREEN, 14 visible chars), for customer and helper. Setup is
 * switched off for everyone (the `payout_setup` switch), and the notice that stood in that
 * branch renders nothing while it is (owner 2026-10-25: "remove that red box. its not paused"),
 * so the tab said nothing about what it holds. It now says there are no payouts yet in both
 * not-offered states, and the not-hired-yet notice still shows above it.
 *
 * @mutate src/pages/profile/PayoutHistory.tsx |           <p className="text-ds-13 px-1" style={quiet}>{NO_PAYOUTS_YET}</p>\n        </> |         </>
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const block = vi.hoisted(() => ({ value: "paused" as "paused" | "needs_hire" | null }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({
  usePayoutSetupBlock: () => block.value,
  usePayoutSetupPaused: () => block.value !== null,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, profile: null, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "order", "limit"]) b[op] = () => b;
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return {
    supabase: {
      from: () => b,
      functions: {
        invoke: () => Promise.resolve({
          data: { connected: false, payouts_enabled: false, available: [], pending: [], payouts: [] },
          error: null,
        }),
      },
    },
  };
});

import PayoutHistory from "./PayoutHistory";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/profile?tab=payout_history"]}>
        <PayoutHistory />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("payout history with no payout account while setup is not offered (#3491)", () => {
  it("setup switched off for everyone: says there are no payouts yet, not just its title", async () => {
    block.value = "paused";
    renderTab();
    expect(await screen.findByText(/No payouts yet\./)).toBeInTheDocument();
    expect(screen.queryByText(/Set up payouts on the Money page/)).toBeNull();
  });

  it("not hired yet: the notice explains it, and the tab still says there are no payouts yet", async () => {
    block.value = "needs_hire";
    renderTab();
    expect(await screen.findByText("You'll set up payouts once you're hired or make your first sale.")).toBeInTheDocument();
    expect(screen.getByText(/No payouts yet\./)).toBeInTheDocument();
    expect(screen.queryByText(/Set up payouts on the Money page/)).toBeNull();
  });

  it("setup offered: points to the Money page (control)", async () => {
    block.value = null;
    renderTab();
    expect(await screen.findByText(/Set up payouts on the Money page/)).toBeInTheDocument();
  });
});
