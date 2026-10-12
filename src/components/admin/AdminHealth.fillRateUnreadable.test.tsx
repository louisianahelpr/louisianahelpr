/**
 * A failed Fill Rate read is not "no data" (lh-silent-failure review of the
 * cold-load fix, 2026-10-12, finding lh-silent-failure@6daabe56f#1).
 *
 * useFillRate never exposed its error, so when get_fill_rate_stats failed the
 * Marketplace Health card showed the fallback shell as a reading: Fill Rate
 * "—", Jobs Tracked "0", and "No job data for this period yet." Now a read
 * that never loaded shows an error with retry, a read that loaded earlier
 * keeps its numbers marked stale, and a function that is not deployed yet
 * (PGRST202) still hides the card.
 *
 * Runs the REAL useFillRate over a Supabase client whose get_fill_rate_stats
 * answers as each case says; the health panels' own hooks are stubbed healthy.
 *
 * @mutate src/components/admin/adminHealth/useFillRate.ts |   const fillNeverLoaded = fillIsError && !fillUpdatedAt; |   const fillNeverLoaded = false;
 * @mutate src/components/admin/adminHealth/useFillRate.ts |   const fillStale = fillIsError && !!fillUpdatedAt; |   const fillStale = false;
 * @mutate src/components/admin/AdminHealth.tsx |           {fillNeverLoaded ? ( |           {false ? (
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

type Answer = { data: unknown; error: unknown };
const rpcState = vi.hoisted(() => ({ answers: [] as Answer[], calls: 0 }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => {
      if (name !== "get_fill_rate_stats") return Promise.resolve({ data: null, error: null });
      const a = rpcState.answers[Math.min(rpcState.calls, rpcState.answers.length - 1)];
      rpcState.calls++;
      return Promise.resolve(a);
    },
  },
}));

const HEALTHY = {
  emailStats: { total: 8, sent: 8, failed: 0, suppressed: 0 },
  pushStats: { total: 2, ios: 2, android: 0, latestAt: null },
  fraudCount: 0,
  adminPushTokenCount: 1,
  recentJobs: { open: 1, completed: 0, disputed: 0, cancelled: 0 },
  healthStatus: "healthy",
  parishStats: [],
  medianTimeToFirstAppMin: null,
  jobsAwaitingApps: 0,
};
vi.mock("./adminHealth/useHealthData", () => ({
  useHealthData: () => ({
    queryKey: ["admin-health"],
    data: HEALTHY,
    isFetching: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    isInitialLoading: false,
  }),
}));
vi.mock("./adminHealth/useConfigChecks", () => ({ useConfigChecks: () => ({ data: [] }) }));
vi.mock("./adminHealth/useCronHealth", () => ({ useCronHealth: () => ({ data: [] }) }));
vi.mock("./adminHealth/useOpenAlerts", () => ({ useOpenAlerts: () => ({ data: [] }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import AdminHealth from "./AdminHealth";

const FAILED: Answer = { data: null, error: { message: "permission denied for function get_fill_rate_stats", code: "42501" } };
const LOADED: Answer = {
  data: [
    { parish: null, total_jobs: 12, filled_jobs: 9, fill_rate_pct: 75, median_minutes_to_first_app: 42 },
    { parish: "Lafayette", total_jobs: 12, filled_jobs: 9, parish_fill_rate_pct: 75 },
  ],
  error: null,
};
const EMPTY: Answer = { data: [{ parish: null, total_jobs: 0, filled_jobs: 0, fill_rate_pct: null, median_minutes_to_first_app: null }], error: null };

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminHealth />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe("Marketplace Health's Fill Rate when its read fails", () => {
  beforeEach(() => {
    rpcState.answers = [];
    rpcState.calls = 0;
  });

  it("never loaded: an error with retry, and none of the fallback's '—' / 0 / 'No job data'", async () => {
    rpcState.answers = [FAILED, LOADED];
    const { container } = renderIt();
    expect(await screen.findByText("Couldn't load the fill rate")).toBeInTheDocument();
    const text = container.textContent ?? "";
    expect(text).not.toContain("No job data for this period yet.");
    expect(text).not.toContain("jobs with ≥1 app");
    // Retry reads again and shows the real numbers.
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Couldn't load the fill rate")).toBeNull();
    expect(rpcState.calls).toBe(2);
  });

  it("loaded earlier, then a refresh failed: the last reading stays, marked stale", async () => {
    rpcState.answers = [LOADED, FAILED];
    const { client } = renderIt();
    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
    await client.refetchQueries({ queryKey: ["admin-fill-rate"] });
    expect(await screen.findByText(/Couldn't refresh the fill rate\./)).toBeInTheDocument();
    expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
    expect(screen.queryByText("Couldn't load the fill rate")).toBeNull();
  });

  it("a real empty period still says so (control)", async () => {
    rpcState.answers = [EMPTY];
    renderIt();
    expect(await screen.findByText("No job data for this period yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't (load|refresh) the fill rate/)).toBeNull();
  });

  it("not deployed yet (PGRST202): the card stays hidden, no error (control)", async () => {
    rpcState.answers = [{ data: null, error: { message: "Could not find the function", code: "PGRST202" } }];
    renderIt();
    await waitFor(() => expect(rpcState.calls).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Marketplace Health")).toBeNull();
    expect(screen.queryByText(/Couldn't (load|refresh) the fill rate/)).toBeNull();
  });
});
