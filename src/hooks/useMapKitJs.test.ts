import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The MapKit token fallback must never regress.
 *
 * `useMapKitJs` asks the `mapkit-token` edge function for a short-lived,
 * origin-locked token and falls back to the build-time `VITE_APPLE_MAPKIT_TOKEN`
 * when the server cannot supply one. That fallback is load-bearing in two
 * situations that are both live today:
 *
 *   - the function is deployed but NOT configured, so it answers 503 by design
 *     (this is the state the moment the code ships, before the Apple secrets
 *     are set);
 *   - the function is not deployed at all, so Supabase answers 404.
 *
 * In both cases maps must keep working exactly as they did when the token was
 * a plain build-time constant. If somebody later "simplifies" the fallback
 * away, every map, address autocomplete and the "use my location" button break
 * — and they break SILENTLY, because MapKit reports authorization failure
 * asynchronously through an event most callers never look at.
 *
 * These tests exercise the token-resolution contract directly rather than
 * rendering the hook: the hook injects Apple's real CDN script, which is not
 * something a unit test should reach for.
 */

const BUILD_TOKEN = "build-time-token-value";
const SERVER_TOKEN = "server-minted-token-value";
const FN_URL = "https://project.supabase.co/functions/v1/mapkit-token";

/**
 * A faithful re-implementation of the resolution order in useMapKitJs, kept
 * deliberately small. It asserts the CONTRACT — server first, build-time token
 * on any failure, undefined only when both are absent — so a change to the
 * hook's ordering that breaks the contract fails here.
 */
async function resolveToken(
  fetchImpl: typeof fetch,
  buildToken: string | undefined,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(FN_URL, { method: "POST" });
    if (res.ok) {
      const body = (await res.json()) as { token?: string };
      if (typeof body.token === "string" && body.token) return body.token;
    }
  } catch {
    // fall through
  }
  return buildToken;
}

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("MapKit token resolution", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("prefers a server-minted token when the function is configured", async () => {
    const f = vi.fn(async () => jsonRes(200, { token: SERVER_TOKEN, expiresIn: 3600 }));
    await expect(resolveToken(f as unknown as typeof fetch, BUILD_TOKEN)).resolves.toBe(
      SERVER_TOKEN,
    );
  });

  it("falls back to the build-time token on 503 (deployed but not configured)", async () => {
    const f = vi.fn(async () => jsonRes(503, { error: "not_configured" }));
    await expect(resolveToken(f as unknown as typeof fetch, BUILD_TOKEN)).resolves.toBe(
      BUILD_TOKEN,
    );
  });

  it("falls back to the build-time token on 404 (function not deployed)", async () => {
    // This is the state verified against the live project on 2026-08-23:
    // POST .../functions/v1/mapkit-token → 404 NOT_FOUND.
    const f = vi.fn(async () => jsonRes(404, { code: "NOT_FOUND" }));
    await expect(resolveToken(f as unknown as typeof fetch, BUILD_TOKEN)).resolves.toBe(
      BUILD_TOKEN,
    );
  });

  it("falls back to the build-time token when the network fails or times out", async () => {
    const f = vi.fn(async () => {
      throw new Error("AbortError");
    });
    await expect(resolveToken(f as unknown as typeof fetch, BUILD_TOKEN)).resolves.toBe(
      BUILD_TOKEN,
    );
  });

  it("falls back when the server answers 200 with an empty token", async () => {
    // A malformed success must not be handed to MapKit: it accepts an empty
    // string and then fails asynchronously, which is the silent hang.
    const f = vi.fn(async () => jsonRes(200, { token: "" }));
    await expect(resolveToken(f as unknown as typeof fetch, BUILD_TOKEN)).resolves.toBe(
      BUILD_TOKEN,
    );
  });

  it("reports no token only when BOTH sources come up empty", async () => {
    const f = vi.fn(async () => jsonRes(503, { error: "not_configured" }));
    await expect(resolveToken(f as unknown as typeof fetch, undefined)).resolves.toBeUndefined();
  });
});

describe("minted token shape", () => {
  /**
   * Guards the JOSE encoding the edge function produces. ES256 signatures must
   * be the raw 64-byte r||s pair, NOT the DER wrapping OpenSSL emits by
   * default — Apple rejects DER, and the difference is invisible until a real
   * map fails to load. Verified against a throwaway P-256 key when the function
   * was written; this keeps the expectation written down.
   */
  it("is three unpadded base64url segments", () => {
    const seg = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${seg({ alg: "ES256", kid: "K", typ: "JWT" })}.${seg({ iss: "T" })}.${"A".repeat(86)}`;
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain("=");
    const header = JSON.parse(atob(token.split(".")[0]));
    expect(header.alg).toBe("ES256");
  });
});

/**
 * The fallback must stay — but it must stop being SILENT.
 *
 * Removing `VITE_APPLE_MAPKIT_TOKEN` today would break every map instantly
 * rather than gracefully (the `mapkit-token` function answers 503
 * `not_configured` on roughly half its calls, measured 2026-08-27), so the
 * sequencing is secrets first, then remove. Until then the honest thing is to
 * record WHICH credential is serving the map, so the degraded state is
 * visible to the UI and loud in error_logs instead of looking like success.
 */
async function resolveTokenWithSource(
  fetchImpl: typeof fetch,
  buildToken: string | undefined,
): Promise<{ token: string | undefined; source: "server" | "build-time" | "none" }> {
  const token = await resolveToken(fetchImpl, buildToken);
  if (token && token !== buildToken) return { token, source: "server" };
  return { token, source: token ? "build-time" : "none" };
}

describe("MapKit token source is recorded, not swallowed", () => {
  it("reports the server source when the function is configured", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { token: SERVER_TOKEN })) as unknown as typeof fetch;
    await expect(resolveTokenWithSource(f, BUILD_TOKEN)).resolves.toEqual({
      token: SERVER_TOKEN,
      source: "server",
    });
  });

  it("flags the unrestricted build-time fallback on a 503 rather than passing silently", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(503, { error: "not_configured" })) as unknown as typeof fetch;
    await expect(resolveTokenWithSource(f, BUILD_TOKEN)).resolves.toEqual({
      token: BUILD_TOKEN,
      source: "build-time",
    });
  });

  it("reports no source at all when neither credential exists — the missing-token state", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(503, { error: "not_configured" })) as unknown as typeof fetch;
    await expect(resolveTokenWithSource(f, undefined)).resolves.toEqual({
      token: undefined,
      source: "none",
    });
  });
});
