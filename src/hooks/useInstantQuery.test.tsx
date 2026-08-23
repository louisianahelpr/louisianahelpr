// useInstantQuery is the foundation under most of the read-heavy admin
// + activity pages. The contract: render fallback while loading, swap
// in real data when fetched, and never show a blocking spinner if the
// caller provided a fallback. Bugs here either flash spinners (UX
// regression) or render fallback over stale-but-real data.

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

  it("isInitialLoading is false when fallback exists (we have something to show)", () => {
    const fetcher = vi.fn(() => new Promise<string[]>(() => {})); // never resolves
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useInstantQuery({
          key: ["test-3"],
          fetcher,
          fallback: ["shell"],
        }),
      { wrapper },
    );
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
