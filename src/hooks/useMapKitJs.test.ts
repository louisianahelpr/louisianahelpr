import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * THE MAPKIT TOKEN FALLBACK, AND THE FACT THAT IT IS LOUD.
 *
 * REWRITTEN 2026-09-21 — this file was HOLLOW, and said so out loud in the
 * sibling `useMapKitJs.authorization.test.tsx`: it declared its own local
 * `resolveToken()` re-implementation of the hook's resolution order and
 * asserted against THAT. It never imported `useMapKitJs` at all, so it was
 * both the input and the definition of correctness. Proof: deleting the real
 * fallback outright (`const built = getBuildTimeToken()` -> `undefined`, i.e.
 * every map in production goes dark) left all nine of its tests green.
 *
 * Everything below drives the REAL module. The contract it pins, which the
 * authorization test beside it does not cover:
 *
 *   1. server token wins, and is what MapKit is actually HANDED;
 *   2. on ANY server failure — 503 not_configured, 403 origin refused, 404 not
 *      deployed, a network abort, or a 200 carrying an empty token — the
 *      honest answer is "missing-token": MapKit is handed nothing, never an
 *      empty string and never the old build-time token (removed, Q249: it was
 *      an unrestricted credential compiled into the bundle; the owner's order
 *      was "Apple secrets first, THEN remove the fallback", and the secrets
 *      are set);
 *   3. a failure is never silent: `useMapKitTokenSource()` reports "none" and
 *      `report()` writes an error-severity line.
 */

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));

const BUILD_TOKEN = "build-time-token-value";
const SERVER_TOKEN = "server-minted-token-value";
const SCRIPT_ID = "apple-mapkit-js";

type ConfigListener = (e: { status?: string }) => void;

/** Apple's global, faithful on the two behaviours that matter: `init()` is
 *  asynchronous, and authorization is reported through events. */
function installMapKitStub() {
  const listeners: Record<string, ConfigListener[]> = {};
  const stub = {
    addEventListener: (t: string, fn: ConfigListener) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t: string, fn: ConfigListener) => {
      listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
    },
    /** Tokens MapKit was actually handed. Empty ⇒ it was never authorized. */
    tokensReceived: [] as string[],
    init: (opts: { authorizationCallback: (done: (token: string) => void) => void }) => {
      opts.authorizationCallback((token) => {
        stub.tokensReceived.push(token);
        setTimeout(() => {
          (listeners["configuration-change"] || []).forEach((fn) => fn({ status: "Initialized" }));
        }, 0);
      });
    },
  };
  (window as unknown as { mapkit: unknown }).mapkit = stub;
  return stub;
}

/** Pre-insert the script tag so the hook takes its "already loaded" branch and
 *  never reaches for Apple's real CDN. */
function installScriptTag() {
  const s = document.createElement("script");
  s.id = SCRIPT_ID;
  document.head.appendChild(s);
}

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

/** Boot the REAL module against a given server answer and build-time token. */
async function drive(
  fetchImpl: () => Promise<Response>,
  buildToken: string | undefined,
) {
  vi.stubEnv("VITE_APPLE_MAPKIT_TOKEN", buildToken ?? "");
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
  vi.stubGlobal("fetch", vi.fn(fetchImpl));

  const stub = installMapKitStub();
  installScriptTag();

  vi.resetModules();
  const mod = await import("./useMapKitJs");
  const status = renderHook(() => mod.useMapKitJs());
  const source = renderHook(() => mod.useMapKitTokenSource());
  return { stub, status, source };
}

describe("MapKit token resolution — the real hook", () => {
  beforeEach(() => {
    document.getElementById(SCRIPT_ID)?.remove();
    delete (window as unknown as { mapkit?: unknown }).mapkit;
    reportMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("hands MapKit the server-minted token when the function is configured", async () => {
    const { stub, status, source } = await drive(
      async () => jsonRes(200, { token: SERVER_TOKEN, expiresIn: 3600 }),
      BUILD_TOKEN,
    );
    await waitFor(() => expect(stub.tokensReceived).toEqual([SERVER_TOKEN]));
    await waitFor(() => expect(status.result.current).toBe("ready"));
    expect(source.result.current).toBe("server");
    // A working server path is not a degraded state and must not be reported.
    expect(reportMock).not.toHaveBeenCalled();
  });

  // Q249: there is no fallback token. Even when a build still carries
  // VITE_APPLE_MAPKIT_TOKEN in its environment (the iOS workflows did, from
  // the GitHub secret), MapKit is never handed it: that token is unrestricted
  // and was compiled into the bundle for anyone to lift out.
  it.each([
    ["503 (not configured)", async () => jsonRes(503, { error: "not_configured" })],
    ["403 (origin refused)", async () => jsonRes(403, { error: "origin_not_allowed" })],
    ["404 (not deployed)", async () => jsonRes(404, { code: "NOT_FOUND" })],
    ["a network failure or timeout", async () => { throw new Error("AbortError"); }],
    ["200 with an empty token", async () => jsonRes(200, { token: "" })],
  ] as Array<[string, () => Promise<Response>]>)(
    "on %s: no token at all, never the build-time one (Q249)",
    async (_label, answer) => {
      const { stub, status, source } = await drive(answer, BUILD_TOKEN);
      await waitFor(() => expect(status.result.current).toBe("missing-token"));
      expect(source.result.current).toBe("none");
      // Never the build-time token, and never an empty string (MapKit accepts
      // one and fails asynchronously: the silent hang).
      expect(stub.tokensReceived).toEqual([]);
    },
  );

  it("a malformed success is recorded as a FAILURE, not waved through", async () => {
    // Without the truthiness half of the check the empty string is "returned"
    // and merely discarded downstream, so it never reaches error_logs.
    await drive(async () => jsonRes(200, { token: "" }), BUILD_TOKEN);
    await waitFor(() => expect(reportMock).toHaveBeenCalled());
    expect((reportMock.mock.calls[0][0] as Error).message).toMatch(/returned no token/);
  });

  it("reports a failed mint at error severity rather than passing silently", async () => {
    await drive(async () => jsonRes(503, { error: "not_configured" }), undefined);
    await waitFor(() => expect(reportMock).toHaveBeenCalled());
    const [err, opts] = reportMock.mock.calls[0] as [Error, { severity?: string; tags?: Record<string, string> }];
    expect(err.message).toMatch(/MapKit has no token/);
    expect(err.message).toMatch(/503/);
    expect(opts.severity).toBe("error");
    expect(opts.tags?.mapkit_token_source).toBe("none");
  });
});

describe("the minted token the edge function produces", () => {
  it("base64url-encodes the raw ES256 signature with no padding", async () => {
    // Apple rejects the DER wrapping OpenSSL emits by default and rejects
    // padded base64 — and the difference is invisible until a real map fails
    // to load. Pinned against the edge function's own source rather than
    // against a token this test builds itself: the previous version of this
    // block constructed its own three-segment string and asserted it had
    // three segments, which is true of any string it could have built.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/mapkit-token/index.ts"),
      "utf8",
    );
    // Floor: a missing or truncated read must fail here, not pass by absence.
    expect(src.length).toBeGreaterThan(1_000);
    expect(src).toMatch(/alg:\s*"ES256"/);
    // WebCrypto's ECDSA sign returns raw r||s; it is passed straight through.
    expect(src).toMatch(/base64url\(new Uint8Array\(signature\)\)/);
    // ...and base64url strips the `=` padding.
    expect(src).toMatch(/\.replace\(\/=\+\$\/, ""\)/);
  });
});

// Shown able to fail:
// Bringing the build-time fallback back (Q249): the unrestricted bundle token.
// @mutate src/hooks/useMapKitJs.ts |   setTokenSource("none");\n  return undefined; |   setTokenSource("none");\n  return import.meta.env.VITE_APPLE_MAPKIT_TOKEN \|\| undefined;
// The server token must be used when it is there.
// @mutate src/hooks/useMapKitJs.ts | if (served) {\n    setTokenSource("server");\n    return served;\n  } | if (false) {\n    setTokenSource("server");\n    return served;\n  }
// An empty token is never handed to MapKit — it accepts one and then hangs.
// @mutate src/hooks/useMapKitJs.ts | if (typeof body.token === "string" && body.token) return body.token; | if (typeof body.token === "string") return body.token;
