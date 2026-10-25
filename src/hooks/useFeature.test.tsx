import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";

/**
 * useFeature fails closed: false while auth or the read is pending, on an RPC
 * error, on any answer but `true`, and when signed out (no RPC at all).
 *
 * And it asks ONCE per cold load, however many switches a page reads
 * (nightly-red #2601: loading-states-refresh 39158661660 metered 480
 * feature_enabled_for calls over 118 signed-in boots, one per switch per
 * boot). Every switch is answered by one public.feature_switches_for_me call.
 */
// @mutate src/hooks/useFeature.ts |   const on = signedIn && answer.isSuccess && answer.data === true; |   const on = answer.data !== false;
// @mutate src/hooks/useFeature.ts |   const settled = isReady && (!uid \|\| answer.isSuccess \|\| answer.isError); |   const settled = true;
// @mutate src/hooks/useFeature.ts |   const settled = isReady && (!uid \|\| answer.isSuccess \|\| answer.isError); |   const settled = isReady && (!uid \|\| answer.isSuccess);
// @mutate src/hooks/useFeature.ts |     enabled: signedIn,\n |     enabled: true,\n
// @mutate src/hooks/useFeature.ts | (all === null ? undefined : all[key] === true) | (all === null ? undefined : Boolean(all[key]))
// @mutate src/hooks/useFeature.ts |     staleTime: STALE_MS,\n    meta: SWITCH_QUERY_META,\n    queryFn: fetchAllSwitches, |     staleTime: 0,\n    meta: SWITCH_QUERY_META,\n    queryFn: fetchAllSwitches,
// @mutate src/hooks/useFeature.ts |     meta: SWITCH_QUERY_META,\n    queryFn: fetchAllSwitches, |     queryFn: fetchAllSwitches,
// @mutate src/hooks/useFeature.ts |     for (const [k, v] of Object.entries(data)) out[k] = v === true; |     for (const [k, v] of Object.entries(data)) out[k] = Boolean(v);
// @mutate src/hooks/useFeature.ts |   if (res.error && isMissingRpcNamed(res.error, "feature_switches_for_me")) return null; |   if (res.error && res.error.code === "PGRST202" && !res.error.hint) return null;
// @mutate src/lib/missingRpc.ts |   return names(e.message) && !names(e.hint); |   return false;
// @mutate src/lib/missingRpc.ts |   return names(e.message) && !names(e.hint); |   return true;
// @mutate src/hooks/useFeature.ts |   const answer = missing ? single : batch; |   const answer = batch;
// @mutate src/hooks/useFeature.ts |   const lastAnswer = signedIn && typeof answer.data === "boolean" ? answer.data : null; |   const lastAnswer = answer.isSuccess && typeof answer.data === "boolean" ? answer.data : null;
// @mutate src/lib/featureSwitchQuery.ts | export const FEATURE_SWITCH_PREFIX = "feature-enabled"; | export const FEATURE_SWITCH_PREFIX = "feature-switches";
// @mutate src/lib/featureSwitchQuery.ts |   if (batch.data !== null) return true; |   if (batch.data !== undefined) return true;
// @mutate src/lib/featureSwitchQuery.ts |   if (batch?.status === "error") return true; |   if (batch?.status === "error") return false;

const rpc = vi.fn();
const auth = { user: { id: "u1" } as { id: string } | null, isReady: true };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));

import { useFeature, useFeatureStatus } from "./useFeature";
import { featureSwitchBatchKey, featureSwitchSettled, featureSwitchSingleKey } from "@/lib/featureSwitchQuery";

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

/** The batched answer the server gives: {key: boolean} for every key asked. */
const batch = (on: Record<string, unknown>) => ({ data: on, error: null });

beforeEach(() => {
  rpc.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  auth.user = { id: "u1" };
  auth.isReady = true;
});

describe("useFeature", () => {
  it("is true only when the server answers true, and false while it is loading", async () => {
    let resolve!: (v: unknown) => void;
    rpc.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useFeature("switch_canary"), { wrapper });
    expect(result.current).toBe(false);
    resolve(batch({ switch_canary: true }));
    await waitFor(() => expect(result.current).toBe(true));
    expect(rpc).toHaveBeenCalledWith("feature_switches_for_me", { p_keys: [...FEATURE_SWITCH_KEYS] });
  });

  it("is false on an RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } });
    const { result } = renderHook(() => useFeature("switch_canary"), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(false);
  });

  it("is false for a non-boolean answer, and for a key the answer leaves out", async () => {
    rpc.mockResolvedValue(batch({ switch_canary: "true", declutter: 1 }));
    const a = renderHook(() => useFeature("switch_canary"), { wrapper });
    const b = renderHook(() => useFeature("declutter"), { wrapper });
    const c = renderHook(() => useFeatureStatus("quotes"), { wrapper });
    await waitFor(() => expect(c.result.current.settled).toBe(true));
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);
    expect(c.result.current.on).toBe(false);
  });

  it("is false and asks nothing when signed out or auth is not ready", async () => {
    rpc.mockResolvedValue(batch({ switch_canary: true }));
    auth.user = null;
    const a = renderHook(() => useFeature("switch_canary"), { wrapper });
    auth.user = { id: "u1" };
    auth.isReady = false;
    const b = renderHook(() => useFeature("switch_canary"), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("useFeature asks once per cold load (nightly-red #2601)", () => {
  it("a page reading several switches (the sidebar reads 3) sends exactly ONE request", async () => {
    // Answers the old per-switch call too, so the old hook fails on the COUNT
    // (5 requests), not on the shape of the answer.
    const on: Record<string, boolean> = { declutter: true, shops: false, quotes: true, rentals: false };
    rpc.mockImplementation(async (fn: string, args: { p_key?: string }) =>
      fn === "feature_enabled_for" ? { data: on[args.p_key!] === true, error: null } : batch(on));
    const hooks = [
      renderHook(() => useFeature("declutter"), { wrapper }),
      renderHook(() => useFeature("shops"), { wrapper }),
      renderHook(() => useFeature("quotes"), { wrapper }),
      renderHook(() => useFeature("declutter"), { wrapper }),
    ];
    const status = renderHook(() => useFeatureStatus("rentals"), { wrapper });
    await waitFor(() => expect(status.result.current.settled).toBe(true));
    await waitFor(() => expect(hooks[0].result.current).toBe(true));
    expect(hooks.map((h) => h.result.current)).toEqual([true, false, true, true]);
    expect(status.result.current).toEqual({ on: false, settled: true, lastAnswer: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("feature_switches_for_me", { p_keys: [...FEATURE_SWITCH_KEYS] });
    // Inventory floor: the one request covers the whole registry, not just these 4.
    expect(FEATURE_SWITCH_KEYS.length).toBeGreaterThan(10);
  });

  it("a switch read LATER on the same load reuses the answer: still one request", async () => {
    rpc.mockResolvedValue(batch({ declutter: true, shops: true }));
    const a = renderHook(() => useFeature("declutter"), { wrapper });
    await waitFor(() => expect(a.result.current).toBe(true));
    const b = renderHook(() => useFeature("shops"), { wrapper });
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("an admin's switch change (invalidate ['feature-enabled']) re-reads with ONE new request", async () => {
    rpc.mockResolvedValue(batch({ declutter: false, shops: false }));
    const a = renderHook(() => useFeature("declutter"), { wrapper });
    const b = renderHook(() => useFeature("shops"), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect([a.result.current, b.result.current]).toEqual([false, false]);
    rpc.mockResolvedValue(batch({ declutter: true, shops: true }));
    await client.invalidateQueries({ queryKey: ["feature-enabled"] });
    await waitFor(() => expect([a.result.current, b.result.current]).toEqual([true, true]));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("before the batched RPC is deployed (PGRST202) each switch asks feature_enabled_for itself", async () => {
    rpc.mockImplementation(async (fn: string, args: { p_key?: string }) =>
      fn === "feature_switches_for_me"
        ? { data: null, error: { message: "Could not find the function", code: "PGRST202" } }
        : { data: args.p_key === "declutter", error: null });
    const a = renderHook(() => useFeature("declutter"), { wrapper });
    const b = renderHook(() => useFeatureStatus("shops"), { wrapper });
    await waitFor(() => expect(a.result.current).toBe(true));
    await waitFor(() => expect(b.result.current).toEqual({ on: false, settled: true, lastAnswer: false }));
    expect(rpc).toHaveBeenCalledWith("feature_enabled_for", { p_key: "declutter" });
    expect(rpc).toHaveBeenCalledWith("feature_enabled_for", { p_key: "shops" });
  });

  it("not deployed, as PostgREST really answers it: PGRST202 WITH a hint pointing at ANOTHER function -> per-switch fallback, never all-off", async () => {
    // What PostgREST sends for a missing function whose name is near an
    // existing one (lead review 2026-10-19): the hint names the neighbour.
    rpc.mockImplementation(async (fn: string, args: { p_key?: string }) =>
      fn === "feature_switches_for_me"
        ? { data: null, error: {
            code: "PGRST202",
            message: "Could not find the function public.feature_switches_for_me(p_keys) in the schema cache",
            details: "Searched for the function public.feature_switches_for_me with parameter p_keys or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
            hint: "Perhaps you meant to call the function public.feature_enabled_for(p_key)",
          } }
        : { data: args.p_key === "declutter", error: null });
    const a = renderHook(() => useFeatureStatus("declutter"), { wrapper });
    await waitFor(() => expect(a.result.current).toEqual({ on: true, settled: true, lastAnswer: true }));
    expect(rpc).toHaveBeenCalledWith("feature_enabled_for", { p_key: "declutter" });
  });

  it("PGRST202 whose hint names the batched RPC itself (it exists, its parameters changed) is a real failure: off, settled, no fallback", async () => {
    rpc.mockResolvedValue({ data: null, error: {
      code: "PGRST202",
      message: "Could not find the function public.feature_switches_for_me(p_keys) in the schema cache",
      hint: "Perhaps you meant to call the function public.feature_switches_for_me(p_names)",
    } });
    const a = renderHook(() => useFeatureStatus("declutter"), { wrapper });
    await waitFor(() => expect(a.result.current).toEqual({ on: false, settled: true, lastAnswer: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("feature_enabled_for", expect.anything());
  });

  it("a failed batched read is ONE request and ONE error for every switch on the page (no per-switch retry chains)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } });
    const hooks = ["declutter", "shops", "quotes"].map((k) => renderHook(() => useFeatureStatus(k as "declutter"), { wrapper }));
    await waitFor(() => hooks.forEach((h) => expect(h.result.current).toEqual({ on: false, settled: true, lastAnswer: null })));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("switch answers are never persisted (meta.persist false on the batch and on the fallback)", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "feature_switches_for_me" ? { data: null, error: { message: "Could not find the function", code: "PGRST202" } } : { data: true, error: null });
    const a = renderHook(() => useFeature("declutter"), { wrapper });
    await waitFor(() => expect(a.result.current).toBe(true));
    const cache = client.getQueryCache();
    expect(cache.find({ queryKey: featureSwitchBatchKey("u1"), exact: true })?.meta).toMatchObject({ persist: false });
    expect(cache.find({ queryKey: featureSwitchSingleKey("declutter", "u1"), exact: true })?.meta).toMatchObject({ persist: false });
  });
});

describe("featureSwitchSettled: the gates' cache read agrees with useFeatureStatus", () => {
  it("pending -> unsettled; batch answer or batch error -> settled; missing batch defers to the per-switch entry", async () => {
    expect(featureSwitchSettled(client, "declutter", "u1")).toBe(false);
    client.setQueryData(featureSwitchBatchKey("u1"), { declutter: false });
    expect(featureSwitchSettled(client, "declutter", "u1")).toBe(true);
    // The batched RPC not deployed: the per-switch read decides.
    client.setQueryData(featureSwitchBatchKey("u1"), null);
    expect(featureSwitchSettled(client, "declutter", "u1")).toBe(false);
    client.setQueryData(featureSwitchSingleKey("declutter", "u1"), false);
    expect(featureSwitchSettled(client, "declutter", "u1")).toBe(true);
    // An errored batch is an answer (off).
    const other = new QueryClient();
    await other.prefetchQuery({ queryKey: featureSwitchBatchKey("u2"), queryFn: () => Promise.reject(new Error("x")), retry: false });
    expect(other.getQueryState(featureSwitchBatchKey("u2"))?.status).toBe("error");
    expect(featureSwitchSettled(other, "declutter", "u2")).toBe(true);
  });
});

describe("useFeatureStatus: settled says the answer is in (Q?profile-declutter-shift)", () => {
  it("is unsettled while the read is pending, then settled with the answer", async () => {
    let resolve!: (v: unknown) => void;
    rpc.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useFeatureStatus("switch_canary"), { wrapper });
    expect(result.current).toEqual({ on: false, settled: false, lastAnswer: null });
    resolve(batch({ switch_canary: true }));
    await waitFor(() => expect(result.current).toEqual({ on: true, settled: true, lastAnswer: true }));
  });

  it("an RPC error is an answer: settled, and off", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } });
    const { result } = renderHook(() => useFeatureStatus("switch_canary"), { wrapper });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.on).toBe(false);
  });

  it("signed out is settled at once and asks nothing; auth not ready is unsettled", async () => {
    auth.user = null;
    const a = renderHook(() => useFeatureStatus("switch_canary"), { wrapper });
    expect(a.result.current).toEqual({ on: false, settled: true, lastAnswer: null });
    auth.user = { id: "u1" };
    auth.isReady = false;
    const b = renderHook(() => useFeatureStatus("switch_canary"), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(b.result.current).toEqual({ on: false, settled: false, lastAnswer: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("useFeatureStatus: lastAnswer survives a failed refetch (lead re-review of SH2b #3), on the batched read", () => {
  it("a refetch error turns on off but keeps the last successful answer", async () => {
    rpc.mockResolvedValueOnce(batch({ switch_canary: true }));
    const { result } = renderHook(() => useFeatureStatus("switch_canary"), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ on: true, settled: true, lastAnswer: true }));
    rpc.mockResolvedValueOnce({ data: null, error: { message: "network", code: "" } });
    await client.refetchQueries({ queryKey: featureSwitchBatchKey("u1") });
    await waitFor(() => expect(result.current.on).toBe(false));
    expect(result.current).toEqual({ on: false, settled: true, lastAnswer: true });
  });

  it("a successful 'off' is the new last answer", async () => {
    rpc.mockResolvedValueOnce(batch({ switch_canary: true }));
    const { result } = renderHook(() => useFeatureStatus("switch_canary"), { wrapper });
    await waitFor(() => expect(result.current.lastAnswer).toBe(true));
    rpc.mockResolvedValueOnce(batch({ switch_canary: false }));
    await client.refetchQueries({ queryKey: featureSwitchBatchKey("u1") });
    await waitFor(() => expect(result.current).toEqual({ on: false, settled: true, lastAnswer: false }));
  });

  it("an error with no earlier answer has no last answer", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } });
    const { result } = renderHook(() => useFeatureStatus("switch_canary"), { wrapper });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.lastAnswer).toBeNull();
  });
});
