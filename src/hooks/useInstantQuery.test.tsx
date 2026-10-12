// useInstantQuery is the foundation under most of the read-heavy admin
// + activity pages. The contract: render fallback while loading, swap
// in real data when fetched, and never show a blocking spinner if the
// caller provided a fallback. Bugs here either flash spinners (UX
// regression) or render fallback over stale-but-real data.
// @mutate src/hooks/useInstantQuery.ts | (query.isLoading \|\| query.fetchStatus === "paused") && | query.isLoading &&

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useInstantQuery } from "./useInstantQuery";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

describe("useInstantQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the fallback before the fetcher resolves", () => {
    const fetcher = vi.fn(
      () => new Promise<string[]>((resolve) => setTimeout(() => resolve(["real"]), 100)),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-1"],
          fetcher,
          fallback: ["empty"],
        }),
      { wrapper },
    );
    // Synchronous render — data is the fallback
    expect(result.current.data).toEqual(["empty"]);
  });

  it("swaps in real data when fetcher resolves", async () => {
    const fetcher = vi.fn(async () => ["real-data"]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-2"],
          fetcher,
          fallback: ["fallback-data"],
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual(["real-data"]));
  });

  // Q1287: no fallback is data. An object fallback is a shell of zeros, and
  // it painted as a reading: the admin health screen opened on "0 sent",
  // "0 unresolved" and a false "No admin has registered a push token"
  // banner. Every fallback shape the app passes is covered here.
  // @mutate src/hooks/useInstantQuery.ts |       query.data === undefined, |       query.data === undefined && (fallback === undefined \|\| (Array.isArray(fallback) && fallback.length === 0)),
  it.each([
    ["a non-empty array", ["shell"]],
    ["an object of zeros", { sent: 0, failed: 0 }],
    ["an object with an empty list", { rows: [], deployed: true }],
  ])("isInitialLoading is TRUE while the first fetch is in flight, with %s as the fallback (Q1287)", (_label, fallback) => {
    const fetcher = vi.fn(() => new Promise<unknown>(() => {})); // never resolves
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery<unknown>({
          key: ["test-3", _label],
          fetcher,
          fallback,
        }),
      { wrapper },
    );
    expect(result.current.isInitialLoading).toBe(true);
    // The fallback still shapes `data`, so a caller can render unconditionally.
    expect(result.current.data).toEqual(fallback);
  });

  it("control: isInitialLoading turns false once the first answer lands, whatever the fallback (Q1287)", async () => {
    // The fix must not leave a permanent skeleton.
    const fetcher = vi.fn(async () => ({ sent: 8, failed: 0 }));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useInstantQuery({ key: ["test-3-landed"], fetcher, fallback: { sent: 0, failed: 0 } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual({ sent: 8, failed: 0 }));
    expect(result.current.isInitialLoading).toBe(false);
  });

  it("isInitialLoading is TRUE when the fallback is an empty array (nothing to show)", () => {
    // An empty array is not a shell — it renders as the EMPTY STATE. 15 admin
    // surfaces pass `fallback: []`, and treating that as "we have something to
    // show" made their skeletons unreachable: AdminFraudDashboard's first paint
    // was "No unresolved fraud flags — looking good!" while the read was still
    // in flight. An operator must never be told there is no fraud because a
    // query hasn't finished.
    const fetcher = vi.fn(() => new Promise<string[]>(() => {})); // never resolves
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-empty-fallback"],
          fetcher,
          fallback: [],
        }),
      { wrapper },
    );
    expect(result.current.isInitialLoading).toBe(true);
  });

  it("isInitialLoading stays TRUE for a first load paused offline (Q571: never the empty state)", async () => {
    // Offline, a never-answered query is PAUSED, not fetching, so isLoading is
    // false; an empty fallback then rendered "Nothing to send. Every payout is
    // settled." to an operator who was merely offline.
    const { onlineManager } = await import("@tanstack/react-query");
    onlineManager.setOnline(false);
    try {
      const fetcher = vi.fn(async () => ["data"]);
      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useInstantQuery({ key: ["test-offline-paused"], fetcher, fallback: [] as string[] }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.fetchStatus).toBe("paused"));
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isInitialLoading).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("isInitialLoading is true when no fallback AND fetcher hasn't resolved", () => {
    const fetcher = vi.fn(() => new Promise<string[]>(() => {})); // never resolves
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-4"],
          fetcher,
          // no fallback
        }),
      { wrapper },
    );
    expect(result.current.isInitialLoading).toBe(true);
  });

  it("does NOT fetch when enabled is false", async () => {
    const fetcher = vi.fn(async () => ["data"]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-5"],
          fetcher,
          fallback: ["empty"],
          enabled: false,
        }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetcher).not.toHaveBeenCalled();
    // Still renders fallback
    expect(result.current.data).toEqual(["empty"]);
  });

  it("data is fallback when fetch is in-flight (component renders unconditionally)", async () => {
    let resolveFetch!: (v: string[]) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-6"],
          fetcher,
          fallback: ["fallback-shell"],
        }),
      { wrapper },
    );
    expect(result.current.data).toEqual(["fallback-shell"]);

    resolveFetch(["real"]);
    await waitFor(() => expect(result.current.data).toEqual(["real"]));
  });

  it("data is undefined fallback when no fallback provided AND fetch in-flight", () => {
    const fetcher = vi.fn(() => new Promise<string[]>(() => {}));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-7"],
          fetcher,
          // No fallback
        }),
      { wrapper },
    );
    expect(result.current.data).toBeUndefined();
  });

  it("propagates query error state via standard React Query result fields", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-8"],
          fetcher,
          fallback: ["empty"],
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// `fallback: []` is not a shell — it renders as the EMPTY STATE. Let a
// fallback count as data again and the admin surfaces open on "No unresolved
// fraud flags" while the read is still in flight (no fallback is data, Q1287).
// @mutate src/hooks/useInstantQuery.ts |       query.data === undefined, |       query.data === undefined && fallback === undefined,
