/**
 * Q131 — a background import must never be able to trigger the stale-chunk
 * recovery reload.
 *
 * Measured on prod 2026-09-23 (e2e/prod-audit/interruptions.spec.ts "offline
 * mid-apply"): after a helper came back online and pressed Apply Now,
 * `apply_to_job` answered 200 and the row landed, then onSuccess's `track()`
 * asked for the posthog chunk. That chunk had failed to load while the device
 * was offline, and the browser keeps a failed module fetch for the life of the
 * document, so it failed again; `vite:preloadError` fired while online, and
 * main.tsx reloaded the page to `/dashboard?_v=…`, wiping "Application sent!".
 *
 * main.tsx declines recovery while `isSpeculativePrefetchInFlight()` is true.
 * So the contract is: while any analytics lazy import is being fetched, that
 * flag is up. The mocked module factories below run exactly while their
 * import is being resolved, so each records the flag at that moment.
 */
// @mutate src/lib/analytics.ts | const { captureEvent } = await backgroundImport(() => import("@/lib/posthog")); | const { captureEvent } = await import("@/lib/posthog");
// @mutate src/lib/analytics.ts | const mod = await backgroundImport(() => import("@/integrations/supabase/client")); | const mod = await import("@/integrations/supabase/client");
// @mutate src/lib/chunkReload.ts | const settle = beginSpeculativePrefetch();\n  try {\n    return await load(); | const settle = () => {};\n  try {\n    return await load();
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundImport, isSpeculativePrefetchInFlight, __resetChunkReloadForTests } from "./chunkReload";

const flagDuringImport: Record<string, boolean> = {};

vi.mock("@/lib/posthog", async () => {
  const { isSpeculativePrefetchInFlight: inFlight } = await import("./chunkReload");
  flagDuringImport.posthog = inFlight();
  return { captureEvent: vi.fn() };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { isSpeculativePrefetchInFlight: inFlight } = await import("./chunkReload");
  flagDuringImport.supabase = inFlight();
  return { supabase: { from: () => ({ insert: async () => ({ error: null }) }) } };
});

describe("backgroundImport (Q131)", () => {
  beforeEach(() => __resetChunkReloadForTests());
  afterEach(() => {
    vi.useRealTimers();
    __resetChunkReloadForTests();
  });

  it("holds the recovery gate up while the import is pending, and drops it after", async () => {
    let release!: (v: number) => void;
    const p = backgroundImport(() => new Promise<number>((r) => { release = r; }));
    expect(isSpeculativePrefetchInFlight()).toBe(true);
    release(7);
    await expect(p).resolves.toBe(7);
    expect(isSpeculativePrefetchInFlight()).toBe(false);
  });

  it("drops the gate on a rejected import too, so a failure can never suppress recovery forever", async () => {
    const err = new Error("Failed to fetch dynamically imported module: /assets/posthog-x.js");
    await expect(backgroundImport(() => Promise.reject(err))).rejects.toBe(err);
    expect(isSpeculativePrefetchInFlight()).toBe(false);
  });

  it("track() fetches posthog and the supabase client only under the gate — the path that reloaded the page on prod", async () => {
    vi.useFakeTimers();
    const { track, AhaEvent } = await import("./analytics");
    track(AhaEvent.JobApplied, { job_id: "q131" });
    // The posthog fan-out is immediate; the supabase flush is debounced 1.5s.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(Object.keys(flagDuringImport).sort()).toEqual(["posthog", "supabase"]));
    expect(flagDuringImport.posthog, "posthog was imported with recovery armed").toBe(true);
    expect(flagDuringImport.supabase, "the analytics flush imported supabase with recovery armed").toBe(true);
    expect(isSpeculativePrefetchInFlight()).toBe(false);
  });
});
