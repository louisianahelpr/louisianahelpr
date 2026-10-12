/**
 * Q1672 (lh-silent-failure review of Q1287): Admin Health's Marketplace Health
 * card read a failed get_fill_rate_stats as "no data". useFillRate never
 * exposed the error, so the card showed "—", "0" and "No job data for this
 * period yet." It now says the read failed (never loaded) or that the numbers
 * are from an earlier read (a refresh failed).
 *
 * Renders the REAL useFillRate / useInstantQuery over a Supabase client whose
 * fill-rate RPC answers with an error, every other read with an empty answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const fill = vi.hoisted(() => ({ fail: true, calls: 0 }));

vi.mock("@/integrations/supabase/client", () => {
  const ANSWER = { data: [], count: 0, error: null, status: 200 };
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve(ANSWER) : chain),
    apply: () => chain,
  });
  const FILL_ROWS = [
    { parish: null, total_jobs: 12, filled_jobs: 9, fill_rate_pct: 75, median_minutes_to_first_app: 42 },
    { parish: "Orleans", total_jobs: 12, filled_jobs: 9, parish_fill_rate_pct: 75 },
  ];
  return {
    supabase: {
      from: () => chain,
      rpc: (name: string) => {
        if (name !== "get_fill_rate_stats") return chain;
        fill.calls += 1;
        return Promise.resolve(
          fill.fail
            ? { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" }, status: 500 }
            : { data: FILL_ROWS, error: null, status: 200 },
        );
      },
      functions: { invoke: () => Promise.resolve({ data: { status: "healthy" }, error: null }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => undefined,
      auth: { getSession: () => new Promise(() => {}), getUser: () => new Promise(() => {}) },
    },
  };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import AdminHealth from "./AdminHealth";

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminHealth />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

// @mutate src/components/admin/adminHealth/useFillRate.ts |   const fillNeverLoaded = fillIsError && !fillUpdatedAt; |   const fillNeverLoaded = false;
// @mutate src/components/admin/adminHealth/useFillRate.ts |   const fillStale = fillIsError && !!fillUpdatedAt; |   const fillStale = false;
// @mutate src/components/admin/AdminHealth.tsx | <FillRateReadFailed fetching={fillFetching} onRetry={() => void refetchFill()} /> | <FillRateReadFailed fetching={fillFetching} onRetry={() => undefined} />
describe("Admin Health's fill rate when its read fails (Q1672)", () => {
  beforeEach(() => {
    fill.fail = true;
    fill.calls = 0;
  });

  it("never loaded: an error with a retry, not '—', '0' or 'No job data'", async () => {
    const { container } = renderIt();
    await waitFor(() => expect(screen.getByText("Couldn't load fill rate")).toBeTruthy());
    const text = container.textContent ?? "";
    expect(text).not.toContain("No job data for this period yet");
    expect(text).not.toContain("jobs with ≥1 app");
    // Retry re-reads, and a read that now answers replaces the error with readings.
    fill.fail = false;
    const before = fill.calls;
    const retry = screen.getByRole("button", { name: /try again|retry/i });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(container.textContent).toContain("75%"));
    expect(fill.calls).toBeGreaterThan(before);
    expect(container.textContent).not.toContain("Couldn't load fill rate");
  });

  it("loaded earlier, then a refresh fails: the last reading stays, marked as stale", async () => {
    fill.fail = false;
    const { container, client } = renderIt();
    await waitFor(() => expect(container.textContent).toContain("75%"));
    expect(container.textContent).not.toContain("Couldn't refresh fill rate");
    fill.fail = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ["admin-fill-rate"] });
    });
    await waitFor(() => expect(container.textContent).toContain("Couldn't refresh fill rate"));
    expect(container.textContent).toContain("75%");
  });

  it("control: a read that answers shows its readings and no error", async () => {
    fill.fail = false;
    const { container } = renderIt();
    await waitFor(() => expect(container.textContent).toContain("Orleans"));
    expect(container.textContent).not.toContain("Couldn't");
  });
});
