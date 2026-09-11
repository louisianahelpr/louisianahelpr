import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

/**
 * The hook must never report a status it cannot back up.
 *
 * This exercises the REAL `useMapKitJs`, unlike `useMapKitJs.test.ts` beside it
 * — that file re-implements the resolution order in its own local
 * `resolveToken()` helper and asserts against that, so it is both the input and
 * the definition of correctness and could not fail for the outage it was
 * written to prevent. It passed green throughout.
 *
 * What it missed, found on prod 2026-09-11: with no token available from either
 * source, the hook resolved **"ready"**. The optimistic AUTH_CONFIRM_TIMEOUT_MS
 * timer was armed at init time, so it raced token resolution — which can take
 * two SERVER_TOKEN_TIMEOUT_MS windows — and won whenever Apple's script came
 * from the HTTP cache. MapKit was never handed a token, so its Geocoder never
 * invoked its callback, and `JobLocationPreview` pulsed on its loading skeleton
 * forever rather than reaching the "isn't available" branch one line below.
 *
 * Two invariants, both of which were false:
 *   1. no token from either source ⇒ "missing-token", never "ready";
 *   2. a status reached AFTER the internal one-shot promise resolves must still
 *      reach an already-mounted consumer.
 */

const SCRIPT_ID = "apple-mapkit-js";

type ConfigListener = (e: { status?: string }) => void;

/** A stub standing in for Apple's global, faithful on the two behaviours that
 *  matter: `init()` is asynchronous, and authorization is reported through
 *  events rather than a return value. */
function installMapKitStub() {
  const listeners: Record<string, ConfigListener[]> = {};
  const stub = {
    addEventListener: (t: string, fn: ConfigListener) => {
      (listeners[t] ||= []).push(fn);
    },
    removeEventListener: (t: string, fn: ConfigListener) => {
      listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
    },
    /** Tokens MapKit was actually handed. Empty ⇒ it was never authorized. */
    tokensReceived: [] as string[],
    init: (opts: { authorizationCallback: (done: (token: string) => void) => void }) => {
      opts.authorizationCallback((token) => {
        stub.tokensReceived.push(token);
        // Apple reports success asynchronously, never inline.
        setTimeout(() => {
          (listeners["configuration-change"] || []).forEach((fn) =>
            fn({ status: "Initialized" }),
          );
        }, 0);
      });
    },
  };
  (window as unknown as { mapkit: unknown }).mapkit = stub;
  return stub;
}

/** Pre-insert the script tag so the hook takes its "already loaded" branch and
 *  never reaches for Apple's real CDN. This is also the exact production shape
 *  that lost the race: a cached script means init runs immediately, leaving the
 *  full auth-confirm window free to expire before the token lands. */
function installScriptTag() {
  const s = document.createElement("script");
  s.id = SCRIPT_ID;
  document.head.appendChild(s);
}

async function freshHook() {
  vi.resetModules();
  return (await import("./useMapKitJs")).useMapKitJs;
}

describe("useMapKitJs authorization honesty", () => {
  beforeEach(() => {
    document.getElementById(SCRIPT_ID)?.remove();
    delete (window as unknown as { mapkit?: unknown }).mapkit;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("never reports ready while token resolution is still in flight", async () => {
    // THE REGRESSION TEST. An earlier draft of this file stubbed fetch to
    // reject immediately and passed against the BROKEN hook — token resolution
    // finished long before the 5s optimistic timer, so the race it was meant to
    // catch never happened. The bug only appears when resolution is SLOWER than
    // AUTH_CONFIRM_TIMEOUT_MS, which in production it always is: the abort
    // fires at SERVER_TOKEN_TIMEOUT_MS and `resolveToken` burns two of those
    // windows (the primed attempt, then a real retry).
    //
    // So the fetch here HANGS until the hook's own AbortController kills it —
    // exactly what a Supabase edge cold start does, and the rejection message
    // is the literal one production writes to error_logs.
    vi.useFakeTimers();
    try {
      vi.stubEnv("VITE_APPLE_MAPKIT_TOKEN", "");
      vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
      vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, opts: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              opts.signal.addEventListener("abort", () =>
                reject(new Error("signal is aborted without reason")),
              );
            }),
        ),
      );

      const stub = installMapKitStub();
      installScriptTag();

      const useMapKitJs = await freshHook();
      const { result } = renderHook(() => useMapKitJs());

      // Past the 5s optimistic auth-confirm window, with the token fetch still
      // hanging. The broken hook armed that timer at init time, so it fires
      // here and resolves "ready" for a MapKit that has been given nothing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(result.current).not.toBe("ready");
      expect(stub.tokensReceived).toEqual([]);

      // Let both abort windows elapse and the honest answer arrive.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(result.current).toBe("missing-token");
      // "ready" is only ever honest if MapKit actually received a token.
      expect(stub.tokensReceived).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it("reports ready, and hands MapKit the token, when the server mints one", async () => {
    vi.stubEnv("VITE_APPLE_MAPKIT_TOKEN", "");
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ token: "server-minted", expiresIn: 3600 }),
          }) as Response,
      ),
    );

    const stub = installMapKitStub();
    installScriptTag();

    const useMapKitJs = await freshHook();
    const { result } = renderHook(() => useMapKitJs());

    await waitFor(() => expect(result.current).toBe("ready"), { timeout: 4000 });
    // "ready" is only honest if MapKit actually got the token.
    expect(stub.tokensReceived).toEqual(["server-minted"]);
  }, 10_000);

  it("delivers a later status change to an ALREADY-MOUNTED consumer", async () => {
    // The hook's internal promise reports exactly one value, so everything
    // after it used to be invisible to anything already on screen: a consumer
    // kept rendering a status that had stopped being true. Proven here by
    // driving a real second resolution cycle and asserting the FIRST consumer
    // — which never remounts — sees it.
    vi.stubEnv("VITE_APPLE_MAPKIT_TOKEN", "");
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");

    let succeed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!succeed) throw new Error("signal is aborted without reason");
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "server-minted", expiresIn: 3600 }),
        } as Response;
      }),
    );

    installMapKitStub();
    installScriptTag();

    const useMapKitJs = await freshHook();

    // Consumer A mounts while the token cannot be minted.
    const a = renderHook(() => useMapKitJs());
    await waitFor(() => expect(a.result.current).toBe("missing-token"), { timeout: 4000 });

    // The edge function recovers (cold start over), and a second consumer
    // mounts — e.g. the user opens a job sheet — starting a fresh cycle.
    succeed = true;
    const b = renderHook(() => useMapKitJs());
    await waitFor(() => expect(b.result.current).toBe("ready"), { timeout: 4000 });

    // A never remounted. Before the subscription it stayed on "missing-token"
    // forever; it must now track the truth.
    expect(a.result.current).toBe("ready");
  }, 10_000);
});
