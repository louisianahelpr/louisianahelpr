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
// @mutate src/lib/analytics.ts | const { captureEvent } = await backgroundImport(() => import("@/lib/posthog"), "posthog"); | const { captureEvent } = await import("@/lib/posthog");
// @mutate src/lib/chunkReload.ts | const settle = beginSpeculativePrefetch();\n  // A load that never settles | const settle = () => {};\n  // A load that never settles
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @mutate src/lib/chunkReload.ts | lateBackgroundImports += 1;\n    settle(); | lateBackgroundImports += 1;
import {
  BACKGROUND_IMPORT_GATE_TIMEOUT_MS,
  backgroundImport,
  handleVitePreloadError,
  isLateBackgroundImportPending,
  isRecoveryReloadInFlight,
  isSpeculativePrefetchInFlight,
  __resetChunkReloadForTests,
} from "./chunkReload";

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

  it("releases the gate after the timeout when the load never settles (Q161)", async () => {
    vi.useFakeTimers();
    void backgroundImport(() => new Promise<never>(() => {}), "never-settles");
    expect(isSpeculativePrefetchInFlight()).toBe(true);
    await vi.advanceTimersByTimeAsync(BACKGROUND_IMPORT_GATE_TIMEOUT_MS - 1);
    expect(isSpeculativePrefetchInFlight(), "gate still held just before the timeout").toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(isSpeculativePrefetchInFlight(), "a stalled background load must not suppress recovery forever").toBe(false);
  });

  it("track() fetches posthog only under the gate, and never the supabase client (Q162: flush is a plain fetch)", async () => {
    vi.useFakeTimers();
    const { track, AhaEvent } = await import("./analytics");
    track(AhaEvent.JobApplied, { job_id: "q131" });
    // The posthog fan-out is immediate; the supabase flush is debounced 1.5s.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(Object.keys(flagDuringImport).sort()).toEqual(["posthog"]));
    expect(flagDuringImport.posthog, "posthog was imported with recovery armed").toBe(true);
    expect(flagDuringImport.supabase, "the analytics flush no longer imports supabase at all").toBeUndefined();
    expect(isSpeculativePrefetchInFlight()).toBe(false);
  });
});

/**
 * Q170 — the Q161 gate timeout must not reopen Q131.
 *
 * After BACKGROUND_IMPORT_GATE_TIMEOUT_MS the gate drops so a stalled load
 * cannot suppress recovery for unrelated chunks forever. But the load is still
 * pending, and if it THEN rejects, Vite raises vite:preloadError with the gate
 * down, and main.tsx used to reload the page for a module nothing on screen
 * needs: the exact Q131 reload that wiped "Application sent!".
 *
 * `viteImport` reproduces Vite's own preload helper contract
 * (node_modules/vite/dist/node/chunks/node.js, handlePreloadError): on a
 * failed import it dispatches a cancelable "vite:preloadError" with
 * `payload = err`, and rethrows the same `err` when not prevented. The
 * listener is the real handleVitePreloadError, the one main.tsx registers.
 * "Recovery started" is observed through its real side effects: the attempt
 * counter in sessionStorage and isRecoveryReloadInFlight().
 */
// @mutate src/lib/chunkReload.ts | if (backgroundOwnedErrors.has(payload)) return; | void backgroundOwnedErrors;
// @mutate src/lib/chunkReload.ts |   if (isLateBackgroundImportPending()) { |   if (false) {
describe("a background import that fails AFTER its gate timeout (Q170)", () => {
  const originalLocation = window.location;
  const viteImport = (base: () => Promise<unknown>) => () =>
    base().catch((err) => {
      const e = new Event("vite:preloadError", { cancelable: true }) as Event & { payload?: unknown };
      e.payload = err;
      window.dispatchEvent(e);
      if (!e.defaultPrevented) throw err;
    });
  const recoveryStarted = () =>
    sessionStorage.getItem("helpr_chunk_reload_count") !== null || isRecoveryReloadInFlight();

  beforeEach(() => {
    __resetChunkReloadForTests();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      value: { href: "https://www.louisianahelpr.com/dashboard", replace: vi.fn() },
      configurable: true,
      writable: true,
    });
    window.addEventListener("vite:preloadError", handleVitePreloadError);
  });
  afterEach(() => {
    window.removeEventListener("vite:preloadError", handleVitePreloadError);
    Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
    sessionStorage.clear();
    vi.useRealTimers();
    __resetChunkReloadForTests();
  });

  it("a background load pending past 15s that then rejects never starts the recovery reload", async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const p = backgroundImport(
      viteImport(() => new Promise((_, rej) => { fail = rej; })),
      "posthog",
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(BACKGROUND_IMPORT_GATE_TIMEOUT_MS + 1_000);
    expect(isSpeculativePrefetchInFlight(), "the gate itself still times out (Q161)").toBe(false);
    expect(isLateBackgroundImportPending()).toBe(true);

    fail(new Error("Failed to fetch dynamically imported module: /assets/posthog-x.js"));
    await p;
    await vi.advanceTimersByTimeAsync(100);
    expect(recoveryStarted(), "a late background failure reloaded the page (Q131 reopened)").toBe(false);
    expect(isLateBackgroundImportPending(), "the late count settles").toBe(false);
  });

  it("an unrelated route-chunk failure after the timeout still recovers", async () => {
    vi.useFakeTimers();
    void backgroundImport(viteImport(() => new Promise<never>(() => {})), "posthog").catch(() => {});
    await vi.advanceTimersByTimeAsync(BACKGROUND_IMPORT_GATE_TIMEOUT_MS + 1_000);
    expect(isLateBackgroundImportPending()).toBe(true);

    const routeLoad = viteImport(() =>
      Promise.reject(new Error("Failed to fetch dynamically imported module: /assets/Dashboard-x.js")),
    )();
    await expect(routeLoad).rejects.toThrow(/Dashboard-x/);
    await vi.advanceTimersByTimeAsync(100);
    expect(recoveryStarted(), "a stalled background load suppressed recovery for a real route chunk").toBe(true);
  });

  it("with no background import pending, a route-chunk failure recovers at once and swallows the throw", async () => {
    const routeLoad = viteImport(() =>
      Promise.reject(new Error("Failed to fetch dynamically imported module: /assets/Dashboard-y.js")),
    )();
    await expect(routeLoad).resolves.toBeUndefined();
    expect(recoveryStarted()).toBe(true);
  });
});
