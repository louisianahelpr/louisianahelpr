/**
 * Every path that sends a signed-in person to Log In WITHOUT them asking must
 * first prove the session is gone with confirmSessionLost() (src/lib/sessionLoss.ts),
 * which tries refreshSession() and never answers "lost" on a network error.
 *
 * Why (owner incident, 2026-10-09 21:45Z, measured in prod edge/auth logs and
 * error_logs): the owner's Mac woke with an expired access token, the refresh
 * failed on the network, getSession() returned null, ~35 requests went out with
 * no JWT, two came back "permission denied", and ProtectedRoute's session-lost
 * net read the null getSession() as "signed out" and hard-redirected to /login.
 * The same device's refresh succeeded 230 ms later; the session was alive.
 *
 * The CLASS, read from source: an involuntary hard redirect to /login is a
 * `window.location.replace|assign(…/login…)` or `location.href = "/login…"`
 * (a user's own Log Out goes through React Router's navigate after a click and
 * is not in this class). Every file doing one must call confirmSessionLost(),
 * or sit in ALLOWED with its reason. ALLOWED is exact in both directions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

/**
 * Files allowed to hard-redirect to /login without confirmSessionLost().
 * useSessionTimeout: the 30-minute idle sign-out, a deliberate sign-out of a
 * session that IS present, and not mounted at all (App.tsx SessionManager; the
 * second test below keeps it that way while it is on this list).
 */
// @two-way src/test/involuntarySignOutConfirmsLoss.test.ts:no longer hard-redirects to /login: drop it from ALLOWED
const ALLOWED = new Map<string, string>([
  ["src/hooks/useSessionTimeout.ts", "deliberate idle sign-out of a live session; dormant (not mounted)"],
]);

const HARD_LOGIN_REDIRECT =
  /(?:location\.(?:replace|assign)\s*\(\s*[`"'][^`"']*\/login|location\.href\s*=\s*[`"'][^`"']*\/login)/;

export const isHardLoginRedirect = (code: string): boolean => HARD_LOGIN_REDIRECT.test(code);
const callsConfirm = (code: string): boolean => /\bconfirmSessionLost\s*\(/.test(code);

const inventory = (): string[] => {
  const out: string[] = [];
  (function walk(d: string) {
    for (const dirent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, dirent.name);
      if (dirent.isDirectory()) {
        if (p === join("src", "test")) continue;
        walk(p);
      } else if (/\.tsx?$/.test(dirent.name) && !/\.test\./.test(dirent.name)) {
        if (isHardLoginRedirect(blankComments(readFileSync(p, "utf8")))) out.push(p);
      }
    }
  })("src");
  return out.sort();
};

describe("involuntary sign-outs confirm the session is really gone", () => {
  it("the detector sees each redirect shape and ignores comments", () => {
    expect(isHardLoginRedirect("window.location.replace(`/login?redirect=x`)")).toBe(true);
    expect(isHardLoginRedirect('window.location.href = "/login";')).toBe(true);
    expect(isHardLoginRedirect('location.assign("/login")')).toBe(true);
    expect(isHardLoginRedirect(blankComments('// window.location.replace("/login")'))).toBe(false);
    expect(isHardLoginRedirect('navigate("/login")')).toBe(false);
  });

  it("every involuntary /login redirect calls confirmSessionLost() first", () => {
    const files = inventory();
    // Floor: ProtectedRoute's session-lost net and the dormant idle timer.
    expect(files.length).toBeGreaterThan(1);
    expect(files).toContain(join("src", "components", "ProtectedRoute.tsx"));
    const offenders = files.filter(
      (f) => !ALLOWED.has(f) && !callsConfirm(blankComments(readFileSync(f, "utf8"))),
    );
    expect(offenders, "call confirmSessionLost() (src/lib/sessionLoss.ts) before redirecting to /login").toEqual([]);
    // Two-way: an allowlisted file that no longer redirects, or that now
    // confirms, leaves the list.
    for (const f of ALLOWED.keys()) {
      expect(files, `${f} no longer hard-redirects to /login: drop it from ALLOWED`).toContain(f);
      expect(callsConfirm(blankComments(readFileSync(f, "utf8"))), `${f} confirms now: drop it from ALLOWED`).toBe(false);
    }
  });

  it("the allowlisted idle sign-out stays unmounted", () => {
    const app = blankComments(readFileSync(join("src", "App.tsx"), "utf8"));
    expect(/\buseSessionTimeout\s*\(/.test(app)).toBe(false);
  });

  it("confirmSessionLost() refreshes first and treats a network failure as NOT lost", () => {
    const code = blankComments(readFileSync(join("src", "lib", "sessionLoss.ts"), "utf8"));
    expect(code).toMatch(/auth\.refreshSession\s*\(/);
    expect(code).toMatch(/AuthRetryableFetchError/);
  });
});

// @mutate src/components/ProtectedRoute.tsx |       void confirmSessionLost().then((lost) => { |       void Promise.resolve(true).then((lost) => {
