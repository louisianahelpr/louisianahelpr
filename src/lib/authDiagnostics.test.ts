/**
 * Q1596: a session-loss report says whether the landing URL carried a sign-in
 * token (never the token), the auth events since load, and whether the page
 * ran inside another app's browser; and the unexpected-sign-out watcher starts
 * at BOOT when the page may hold a session, not on the first interaction.
 *
 * @mutate src/main.tsx |   if (landingAuthHint().hadAuthToken \|\| tokenProbeAtBoot()) registerUnexpectedSignOutWatch(); |
 * @mutate src/components/ProtectedRoute.tsx | context: { path: location.pathname, ...authDiagnostics() }, | context: { path: location.pathname },
 * @mutate src/lib/authDiagnostics.ts |   if (has("access_token")) kind = "access_token"; |
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import {
  authDiagnostics,
  inAppBrowserHint,
  noteAuthEventForDiagnostics,
  readLandingAuthHint,
  resetAuthEventsForTest,
  setLandingAuthHintForTest,
} from "./authDiagnostics";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("readLandingAuthHint", () => {
  it("names a PKCE code, an implicit access token and a token_hash, never their values", () => {
    const code = readLandingAuthHint("?code=abc123SECRET", "", "/home");
    expect(code).toEqual({ hadAuthToken: true, kind: "code", linkType: null, path: "/home" });
    const implicit = readLandingAuthHint("", "#access_token=eyJSECRET&refresh_token=r&type=signup", "/home");
    expect(implicit).toMatchObject({ hadAuthToken: true, kind: "access_token", linkType: "signup" });
    const th = readLandingAuthHint("?token_hash=SECRET&type=magiclink", "", "/auth/confirm");
    expect(th).toMatchObject({ hadAuthToken: true, kind: "token_hash", linkType: "magiclink" });
    expect(JSON.stringify([code, implicit, th])).not.toMatch(/SECRET/);
  });

  it("an error redirect or a plain URL is not a token", () => {
    expect(readLandingAuthHint("?error_code=otp_expired", "", "/").hadAuthToken).toBe(false);
    expect(readLandingAuthHint("?error_code=otp_expired", "", "/").kind).toBe("error");
    expect(readLandingAuthHint("?tab=jobs", "", "/home")).toMatchObject({ hadAuthToken: false, kind: null });
  });
});

describe("inAppBrowserHint", () => {
  it("names Facebook's and Instagram's in-app browsers and not Safari", () => {
    const fb =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22H20 [FBAN/FBIOS;FBAV/530.0.0.40.103;FBBV/1;FBDV/iPhone15,2]";
    const ig = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/22H20 Instagram 400.0.0";
    const safari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
    expect(inAppBrowserHint(fb)).toBe("facebook");
    expect(inAppBrowserHint(ig)).toBe("instagram");
    expect(inAppBrowserHint(safari)).toBeNull();
  });
});

describe("authDiagnostics", () => {
  beforeEach(() => resetAuthEventsForTest());

  it("carries the landing hint and the auth events, newest last, at most 16", () => {
    setLandingAuthHintForTest({ hadAuthToken: true, kind: "code", linkType: "signup", path: "/home" });
    for (let i = 0; i < 20; i++) noteAuthEventForDiagnostics(i === 19 ? "SIGNED_OUT" : "TOKEN_REFRESHED", i);
    const d = authDiagnostics();
    expect(d).toMatchObject({ landingHadAuthToken: true, landingAuthKind: "code", landingLinkType: "signup" });
    const evs = d.authEventsSinceLoad as Array<{ event: string; ms: number }>;
    expect(evs).toHaveLength(16);
    expect(evs[15]).toEqual({ event: "SIGNED_OUT", ms: 19 });
    expect(d).toHaveProperty("inAppBrowser");
  });
});

describe("wiring", () => {
  const main = read("main.tsx");

  it("main.tsx imports authDiagnostics before App (before the Supabase client can strip the URL)", () => {
    const diag = main.indexOf('from "./lib/authDiagnostics"');
    const app = main.indexOf('from "./App.tsx"');
    expect(diag).toBeGreaterThan(0);
    expect(app).toBeGreaterThan(diag);
  });

  it("the unexpected-sign-out watcher starts at boot when a session may exist, once only", () => {
    const fn = main.indexOf("const registerUnexpectedSignOutWatch");
    const deferred = main.indexOf("const runDeferred");
    expect(fn).toBeGreaterThan(0);
    const between = main.slice(fn, deferred);
    expect(between).toMatch(/if \(landingAuthHint\(\)\.hadAuthToken \|\| tokenProbeAtBoot\(\)\) registerUnexpectedSignOutWatch\(\);/);
    expect(between).toMatch(/if \(signOutWatchStarted\) return;/);
    expect(between).toMatch(/noteAuthEventForDiagnostics\(event\)/);
    expect(between).toMatch(/\.\.\.authDiagnostics\(\)/);
  });

  it("the session-lost report carries the diagnostics", () => {
    expect(read("components/ProtectedRoute.tsx")).toMatch(/context: \{ path: location\.pathname, \.\.\.authDiagnostics\(\) \}/);
  });
});
