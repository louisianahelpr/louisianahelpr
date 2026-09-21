/**
 * EF-04 (hole hunt 2026-09-15): `mapkit-token` mints hour-long Apple MapKit
 * tokens to anonymous callers with no ceiling, letting anyone drive this Apple
 * account's daily map-view quota to exhaustion.
 *
 * The endpoint is deliberately anonymous — its only caller (useMapKitJs) sends
 * just the publishable apikey, no user JWT, and maps must work for signed-out
 * visitors and the native capacitor:// WebView — so the fix is a rate limit
 * (keyed on the server-derived IP), not an auth requirement.
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, rateLimitState } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

async function load(): Promise<EdgeHarness> {
  // Deliberately NOT setting the APPLE_MAPKIT_* secrets: unconfigured, the
  // function answers 503 on the mint path, which is what lets the test below
  // confirm the rate limiter runs BEFORE the mint without needing a real .p8.
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  return loadEdgeFunction("mapkit-token");
}

describe("mapkit-token — mint-rate ceiling", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("rate-limits an anonymous flood with 429 before minting", async () => {
    // THE HOLE. Before the fix there was no limiter at all — every anonymous
    // request reached the mint path.
    rateLimitState.allowed = false;
    rateLimitState.retryAfter = 30;
    const fn = await load();
    const res = await fn.fetch(fn.request({ method: "GET" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("lets a request through the limiter (503 unconfigured here) — the gate is not blanket", async () => {
    // Limiter allows → reaches the mint path → 503 because the signing secrets
    // are not set in this test. Proves the 429 above is the limiter, not an
    // always-closed door.
    const fn = await load();
    const res = await fn.fetch(fn.request({ method: "GET" }));
    expect(res.status).toBe(503);
  });
});

// ── Shown able to fail ─────────────────────────────────────────────────────
// The EF-04 ceiling itself. Removing the gate returns this anonymous endpoint
// to unmetered hour-long Apple MapKit token minting — quota exhaustion with
// nothing to revoke.
// @mutate supabase/functions/mapkit-token/index.ts | if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeadersFull); |
