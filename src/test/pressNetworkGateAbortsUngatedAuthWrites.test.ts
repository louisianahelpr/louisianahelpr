/**
 * THE NETWORK GATE COVERS /auth/v1 (lead, 2026-10-17, ready/sec-c-1017-22).
 * ready/sec-c-1017-21 put the press sweep's network gate on /rest, /functions
 * and /storage and left GoTrue out. So an ungated press could still change
 * the shared test account's password, email or phone, rewrite its metadata,
 * sign it out everywhere (run 35761400822: one global sign-out cost 274
 * "failed presses"), enroll or remove an MFA factor (opening TwoFactorCard's
 * set-up dialog ENROLLS a factor before anything is pressed), link or unlink
 * an identity, or send a reset / OTP / resend email, and the run would not
 * know. Now, while the gate is armed, every GoTrue write is aborted in the
 * browser and named as a GATE MISS. One auth call passes: the token refresh
 * (PRESS_AUTH_ALLOWED). The harness's own sign-in never goes through a page:
 * it is minted in Node (prodSession -> scripts/lib/adminSession.mjs) and
 * injected into localStorage, so a sign-in sent BY THE PAGE is a write.
 *
 * This test fails if an ungated press's auth write would get through:
 * - networkGate, armed: each auth write in AUTH_WRITES is aborted and named
 *   (with its grant_type / scope); the refresh and the reads fall through;
 * - the gate's route regex covers /auth/v1 (or the gate never sees it);
 * - every endpoint auth-js itself can call (read from its own dist, so a new
 *   GoTrue endpoint in an upgrade is classified the day it lands) is a write
 *   unless it is a GET or the allowed refresh, and the named GET writes are
 *   exact (two-way);
 * - every supabase.auth.* method the app calls is classified below, so a new
 *   one cannot slip in unclassified.
 *
 * @mutate scripts/audit/pressProdSafety.mjs | export const PRESS_WRITE_SURFACE_RX = /\/(rest\|functions\|storage\|auth)\/v1\//; | export const PRESS_WRITE_SURFACE_RX = /\/(rest\|functions\|storage)\/v1\//;
 * @mutate scripts/audit/pressProdSafety.mjs |     return isAllowedAuthRequest(m, u) ? "read" : "write"; |     return "read";
 * @mutate scripts/audit/pressProdSafety.mjs |     if (safeMethod) return Object.hasOwn(PRESS_AUTH_GET_WRITES, pathname) ? "write" : "read"; |     if (safeMethod) return "read";
 * @mutate scripts/audit/pressProdSafety.mjs |   "POST /auth/v1/token?grant_type=refresh_token": | "POST /auth/v1/token?grant_type=password":
 * @mutate scripts/audit/pressProdSafety.mjs |   if (pathname.startsWith("/auth/v1/")) { |   if (pathname.startsWith("/auth/v2/")) {
 * @mutate scripts/audit/press-every-control.mjs | ["grant_type", "scope"].filter | [].filter
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const ROOT = resolve(__dirname, "..", "..");
const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
type Kind = "read" | "side-effect" | "write";
const kind = (method: string, path: string, body: string | null = null): Kind =>
  safety.pressWriteKind({ method, url: `${BASE}${path}`, body });

function fake(method: string, path: string, body: string | null = null) {
  const route = { fallback: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const req = { method: () => method, url: () => `${BASE}${path}`, postData: () => body };
  return { route, req };
}

/** The auth writes an ungated press can set off, as auth-js 2.117 sends them. */
const AUTH_WRITES: Array<[string, string, string | null]> = [
  ["PUT", "/auth/v1/user", '{"password":"x","code_challenge":null,"code_challenge_method":null}'],
  ["PUT", "/auth/v1/user", '{"email":"new@example.com","code_challenge":"c","code_challenge_method":"s256"}'],
  ["PUT", "/auth/v1/user", '{"phone":"+15045550100"}'],
  ["PUT", "/auth/v1/user", '{"data":{"senior_mode":true}}'],
  ["POST", "/auth/v1/logout?scope=global", null],
  ["POST", "/auth/v1/logout?scope=others", null],
  ["POST", "/auth/v1/logout?scope=local", null],
  ["POST", "/auth/v1/factors", '{"factor_type":"totp"}'],
  ["POST", "/auth/v1/factors/f1/challenge", "{}"],
  ["POST", "/auth/v1/factors/f1/verify", '{"code":"123456"}'],
  ["DELETE", "/auth/v1/factors/f1", null],
  ["DELETE", "/auth/v1/user/identities/i1", null],
  ["GET", "/auth/v1/user/identities/authorize?provider=google&skip_http_redirect=true", null],
  ["GET", "/auth/v1/reauthenticate", null],
  ["POST", "/auth/v1/token?grant_type=password", '{"email":"a@b.c","password":"x","gotrue_meta_security":{"captcha_token":"t"}}'],
  ["POST", "/auth/v1/token?grant_type=id_token", "{}"],
  ["POST", "/auth/v1/token?grant_type=pkce", "{}"],
  ["POST", "/auth/v1/verify", '{"type":"magiclink","token_hash":"h"}'],
  ["POST", "/auth/v1/otp", '{"email":"a@b.c","gotrue_meta_security":{"captcha_token":"t"}}'],
  ["POST", "/auth/v1/recover", '{"email":"a@b.c","gotrue_meta_security":{"captcha_token":"t"}}'],
  ["POST", "/auth/v1/resend", '{"email":"a@b.c","type":"signup"}'],
  ["POST", "/auth/v1/signup", "{}"],
];

/** Every supabase.auth.* method the app calls, by what it sends ("local" sends nothing). Exact both ways. */
const APP_AUTH_METHODS: Record<string, "read" | "write" | "local"> = {
  getUser: "read", getSession: "local", onAuthStateChange: "local",
  refreshSession: "read", // the allowed token refresh
  "mfa.listFactors": "read", "mfa.getAuthenticatorAssuranceLevel": "local",
  signOut: "write", updateUser: "write", signInWithOAuth: "write", signInWithPassword: "write",
  signInWithIdToken: "write", signUp: "write", resetPasswordForEmail: "write", resend: "write",
  linkIdentity: "write", unlinkIdentity: "write", "mfa.enroll": "write", "mfa.unenroll": "write",
  "mfa.challengeAndVerify": "write",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** [METHOD, path] of every literal endpoint auth-js's own client calls (template ids become "x"). */
function authJsEndpoints(): Array<[string, string]> {
  const req = createRequire(join(ROOT, "package.json"));
  const dist = join(dirname(req.resolve("@supabase/auth-js/package.json")), "dist", "main");
  const out: Array<[string, string]> = [];
  for (const f of ["GoTrueClient.js", "GoTrueAdminApi.js"]) {
    const src = readFileSync(join(dist, f), "utf8");
    for (const m of src.matchAll(/_request\)\(this\.fetch, '(GET|POST|PUT|PATCH|DELETE)', `\$\{this\.url\}([^`]*)`/g)) {
      out.push([m[1], `/auth/v1${m[2].replace(/\$\{[^}]+\}/g, "x")}`]);
    }
  }
  return out;
}

describe("the press sweep's network gate aborts every GoTrue write an ungated press sets off", () => {
  it("armed: every auth write is aborted and named; the token refresh and reads fall through", async () => {
    const gate = harness.networkGate();
    gate.arm();
    for (const [m, path, body] of AUTH_WRITES) {
      const w = fake(m, path, body);
      await gate.handler(w.route, w.req);
      expect(w.route.abort, `${m} ${path} got through`).toHaveBeenCalledTimes(1);
      expect(w.route.fallback, `${m} ${path} got through`).not.toHaveBeenCalled();
    }
    for (const [m, path] of [["POST", "/auth/v1/token?grant_type=refresh_token"], ["GET", "/auth/v1/user"], ["GET", "/auth/v1/settings"]] as const) {
      const r = fake(m, path, m === "POST" ? '{"refresh_token":"r"}' : null);
      await gate.handler(r.route, r.req);
      expect(r.route.fallback, `${m} ${path}`).toHaveBeenCalledTimes(1);
      expect(r.route.abort, `${m} ${path}`).not.toHaveBeenCalled();
    }
    const { misses, sideEffects } = gate.disarm();
    expect(sideEffects).toEqual([]);
    expect(misses).toContain("POST /auth/v1/logout?scope=global");
    expect(misses).toContain("POST /auth/v1/token?grant_type=password");
    expect(misses).toContain("PUT /auth/v1/user");
    expect(misses).toContain("POST /auth/v1/factors");
    expect(misses.length).toBe(new Set(AUTH_WRITES.map(([m, p]) => harness.gateRequestLabel(m, `${BASE}${p}`))).size);
  });

  it("the gate's route covers /auth/v1, so it sees GoTrue calls at all", () => {
    expect(safety.PRESS_WRITE_SURFACE_RX.test(`${BASE}/auth/v1/user`)).toBe(true);
    expect(safety.PRESS_WRITE_SURFACE_RX.test(`${BASE}/auth/v1/logout?scope=global`)).toBe(true);
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toContain("await ctx.route(PRESS_WRITE_SURFACE_RX, netGate.handler);");
  });

  it("only the token refresh is allowed; a sign-in by the page is a write (the harness signs in from Node)", () => {
    expect(Object.keys(safety.PRESS_AUTH_ALLOWED)).toEqual(["POST /auth/v1/token?grant_type=refresh_token"]);
    expect(kind("POST", "/auth/v1/token?grant_type=refresh_token")).toBe("read");
    expect(kind("POST", "/auth/v1/token?grant_type=refresh_token&extra=1")).toBe("read");
    expect(kind("PUT", "/auth/v1/token?grant_type=refresh_token")).toBe("write");
    expect(kind("POST", "/auth/v1/token")).toBe("write");
    expect(kind("POST", "/auth/v1/verify")).toBe("write");
    // The harness's sign-in: minted in Node, injected into localStorage, never sent by a page.
    const pec = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(pec).toMatch(/await ctx\.addInitScript\(\(\[k, v\]\) => \{/);
    expect(pec).not.toMatch(/page\.fill\([^)]*password/i);
    const mint = readFileSync(resolve(ROOT, "scripts/lib/adminSession.mjs"), "utf8");
    expect(mint).toMatch(/export async function fetchTransport/);
  });

  it("every endpoint auth-js can call is classified: non-GET writes bar the refresh, and the GET writes are exact", () => {
    const eps = authJsEndpoints();
    expect(eps.length).toBeGreaterThan(60); // 66 literal endpoints in auth-js 2.117.3 (measured 2026-10-17)
    const leaks: string[] = [];
    for (const [m, path] of eps) {
      const k = kind(m, path);
      const allowed = `${m} ${path}` in safety.PRESS_AUTH_ALLOWED;
      if (m !== "GET" && !allowed && k !== "write") leaks.push(`${m} ${path} reads as ${k}`);
      if (allowed && k !== "read") leaks.push(`${m} ${path} is allowed but reads as ${k}`);
    }
    expect(leaks).toEqual([]);
    const sent = new Set(eps.map(([m, p]) => `${m} ${p}`));
    for (const key of Object.keys(safety.PRESS_AUTH_ALLOWED)) {
      expect(sent.has(key), `stale baseline entry ${key}: auth-js no longer sends it, remove it from PRESS_AUTH_ALLOWED`).toBe(true);
    }
    const gets = new Set(eps.filter(([m]) => m === "GET").map(([, p]) => p.replace(/\?.*$/, "")));
    gets.add("/auth/v1/user/identities/authorize"); // linkIdentity builds this one through _getUrlForProvider
    for (const p of Object.keys(safety.PRESS_AUTH_GET_WRITES)) {
      expect(gets.has(p), `PRESS_AUTH_GET_WRITES ${p} is no GET auth-js makes`).toBe(true);
      expect(kind("GET", p)).toBe("write");
    }
    expect(readFileSync(createRequire(join(ROOT, "package.json")).resolve("@supabase/auth-js/dist/main/GoTrueClient.js"), "utf8")).toContain("/user/identities/authorize");
  });

  it("every supabase.auth.* method the app calls is classified here", () => {
    const used = new Set<string>();
    for (const f of sourceFiles(resolve(ROOT, "src"))) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/supabase\.auth\.(mfa\.)?([a-zA-Z]+)\s*\(/g)) used.add(`${m[1] ?? ""}${m[2]}`);
    }
    expect(used.size).toBeGreaterThan(18); // 19 distinct methods outside comments (measured 2026-10-17)
    const unclassified = [...used].filter((m) => !(m in APP_AUTH_METHODS));
    expect(unclassified, "a new supabase.auth method: say what it sends, and add an AUTH_WRITES case if it writes").toEqual([]);
    const stale = Object.keys(APP_AUTH_METHODS).filter((m) => !used.has(m));
    expect(stale, "classified but no longer called: drop it").toEqual([]);
  });
});
