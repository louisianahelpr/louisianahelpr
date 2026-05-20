import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PayoutTicker from "./PayoutTicker";

// PayoutTicker hits a single public RPC. Mock the entire client
// surface to a single rpc() that we re-stub per test — that gives
// us full control over the loading / empty / PGRST202 / multi-row
// cases without standing up a real network mock.
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// Reduced-motion is normally driven by matchMedia. The shared
// test setup defaults `matches: false`; individual tests flip it
// via this helper when they need to exercise the snap path.
const setReducedMotion = (reduced: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced ? query.includes("reduce") : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  });
};

// Fresh QueryClient per render — otherwise tanstack caches the
// last query's data across describe blocks and the PGRST202 test
// "passes" off the empty-state test's empty cache.
const renderTicker = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PayoutTicker />
    </QueryClientProvider>,
  );
};

describe("PayoutTicker", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when the RPC returns zero payouts", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const { container } = renderTicker();
    // Initial paint is empty (no data yet). After the resolved
    // promise flushes, the component should stay empty because
    // the result was zero rows.
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders a single payout in 'First L. earned $X in City' shape (SQL-redacted display_name)", async () => {
    // Post-migration: the RPC returns display_name pre-redacted in SQL.
    // The client renders it verbatim — no `formatName` call needed.
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          display_name: "Maria S.",
          amount_dollars: 47,
          city: "Baton Rouge",
          paid_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        },
      ],
      error: null,
    });
    renderTicker();
    await screen.findByText("Maria S.");
    expect(screen.getByText("$47")).toBeInTheDocument();
    expect(screen.getByText("Baton Rouge")).toBeInTheDocument();
    // Relative time uses date-fns formatDistanceToNow with the
    // suffix — we don't assert exact wording (locale variations),
    // just that an "ago" suffix landed in the row.
    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });

  it("falls back to client-side formatName(full_name) during the pre-deploy window", async () => {
    // Migration window: the new client ships before `supabase db push`
    // has been run, so the old function definition still emits raw
    // `full_name`. The client must redact on the fly so the ticker
    // works (and the same "First L." privacy posture is enforced on
    // render, even if the bytes-over-wire posture isn't yet).
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          full_name: "Maria Sanchez",
          amount_dollars: 47,
          city: "Baton Rouge",
          paid_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        },
      ],
      error: null,
    });
    renderTicker();
    await screen.findByText("Maria S.");
    expect(screen.getByText("$47")).toBeInTheDocument();
    expect(screen.getByText("Baton Rouge")).toBeInTheDocument();
  });

  it("rotates through multiple payouts on the 4s interval", async () => {
    vi.useFakeTimers();
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          display_name: "Alice A.",
          amount_dollars: 30,
          city: "Houma",
          paid_at: new Date().toISOString(),
        },
        {
          display_name: "Bobby B.",
          amount_dollars: 90,
          city: "Lafayette",
          paid_at: new Date().toISOString(),
        },
      ],
      error: null,
    });
    renderTicker();

    // First-pass tanstack-query resolution requires the microtask
    // queue to drain. advanceTimersByTimeAsync handles both.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Alice A.")).toBeInTheDocument();

    // Tick past one rotation cycle. The interval is 4 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("Bobby B.")).toBeInTheDocument();

    // Wrap around — index 2 % 2 = 0 ⇒ back to Alice.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("Alice A.")).toBeInTheDocument();
  });

  it("does not rotate when prefers-reduced-motion is set", async () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          display_name: "Alice A.",
          amount_dollars: 30,
          city: "Houma",
          paid_at: new Date().toISOString(),
        },
        {
          display_name: "Bobby B.",
          amount_dollars: 90,
          city: "Lafayette",
          paid_at: new Date().toISOString(),
        },
      ],
      error: null,
    });
    renderTicker();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Alice A.")).toBeInTheDocument();

    // Even after several "rotation" cycles, reduced-motion users
    // stay on the first entry — no interval was scheduled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByText("Alice A.")).toBeInTheDocument();
    expect(screen.queryByText("Bobby B.")).not.toBeInTheDocument();
  });

  it("hides silently when the RPC returns the PGRST202 'not deployed' error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });
    const { container } = renderTicker();
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});
