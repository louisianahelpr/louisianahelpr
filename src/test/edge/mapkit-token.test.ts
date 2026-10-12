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

/**
 * Q249: the origin claim was copied from ANY http(s) Origin, so a page on any
 * other site got a working token locked to itself (measured 2026-10-12 on
 * prod: Origin https://evil.example.com -> 200, claim https://evil.example.com).
 * These run the real mint with a throwaway P-256 key and read the claim back.
 */
describe("mapkit-token — which origins get a token (Q249)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  async function loadConfigured(): Promise<EdgeHarness> {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      APPLE_MAPKIT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      APPLE_MAPKIT_KEY_ID: "TESTKEY123",
      APPLE_MAPKIT_TEAM_ID: "TESTTEAM12",
    });
    return loadEdgeFunction("mapkit-token");
  }

  async function mint(fn: EdgeHarness, origin: string | null) {
    const res = await fn.fetch(fn.request({ method: "GET", headers: origin === null ? {} : { origin } }));
    const body = (await res.json()) as { token?: string };
    const claims = body.token
      ? (JSON.parse(Buffer.from(body.token.split(".")[1], "base64url").toString()) as { origin?: string })
      : null;
    return { status: res.status, claims };
  }

  // @mutate supabase/functions/mapkit-token/index.ts |   return { kind: "refused" }; |   return { kind: "locked", origin: raw };
  it.each([
    ["another site", "https://evil.example.com"],
    ["a look-alike suffix", "https://www.louisianahelpr.com.evil.example"],
    ["a look-alike prefix", "https://notlouisianahelpr.com"],
    ["plain http of our host", "http://www.louisianahelpr.com"],
    ["a subdomain we do not serve", "https://shop.louisianahelpr.com"],
    ["a sandboxed document", "null"],
    ["a Vercel deployment", "https://louisianahelpr-abc.vercel.app"],
  ])("refuses %s with 403 and mints nothing", async (_label, origin) => {
    const fn = await loadConfigured();
    const { status, claims } = await mint(fn, origin);
    expect(status).toBe(403);
    expect(claims).toBeNull();
  });

  it.each([
    ["www", "https://www.louisianahelpr.com"],
    ["the apex", "https://louisianahelpr.com"],
    ["the Android app", "https://localhost"],
    ["local dev", "http://localhost:8080"],
  ])("locks the token to %s", async (_label, origin) => {
    const fn = await loadConfigured();
    const { status, claims } = await mint(fn, origin);
    expect(status).toBe(200);
    expect(claims?.origin).toBe(origin);
  });

  it.each([
    ["the iOS app (capacitor://localhost)", "capacitor://localhost"],
    ["no Origin at all", null],
  ])("still mints an unlocked token for %s (the native carve-out, filed separately)", async (_label, origin) => {
    const fn = await loadConfigured();
    const { status, claims } = await mint(fn, origin);
    expect(status).toBe(200);
    expect(claims && "origin" in claims).toBe(false);
  });
});

// ── Shown able to fail ─────────────────────────────────────────────────────
// The EF-04 ceiling itself. Removing the gate returns this anonymous endpoint
// to unmetered hour-long Apple MapKit token minting — quota exhaustion with
// nothing to revoke.
// @mutate supabase/functions/mapkit-token/index.ts | if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeadersFull); |
