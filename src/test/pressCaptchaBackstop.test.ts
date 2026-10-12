/**
 * CLASS GUARD (Q1374): press-every-control never counts Supabase Auth CAPTCHA's
 * refusal of its own tokenless build as a product failure.
 *
 * Measured: scheduled press runs 38042662790 (2026-10-10) and 38238345303
 * (2026-10-12) failed "Email me a password reset link" on /profile?tab=security
 * for every persona: `400 POST v1/recover`, toast "The security check didn't
 * finish. Give it a second and try again." Supabase Auth CAPTCHA is on (Q1314)
 * and the press build has no VITE_TURNSTILE_ENABLED, and its 127.0.0.1 origin is
 * not a Turnstile widget hostname, so GoTrue refuses every guarded call it
 * makes. (The live bundle ships the widget on: its turnstile site-key getter
 * returns the production key, read 2026-10-12.)
 *
 * INVENTORY: every supabase.auth method the app calls that Supabase Auth
 * CAPTCHA guards (src/, non-test). Each one's endpoint must be recognised by
 * isCaptchaGatedAuthRequest, and the harness must abort such a request and
 * report the press SKIP_CAPTCHA_GATED (documented; never PASS).
 */
// @mutate scripts/audit/press-every-control.mjs |         if (isCaptchaGatedAuthRequest(req.url(), req.method(), req.postData())) { |         if (false) {
// @mutate scripts/audit/press-every-control.mjs |             skip(SKIP_CAPTCHA_GATED); |             void 0;
// @mutate scripts/audit/pressProdSafety.mjs | export const CAPTCHA_GATED_AUTH_PATHS = new Set(["signup", "recover", "otp", "magiclink", "resend"]); | export const CAPTCHA_GATED_AUTH_PATHS = new Set(["signup", "otp", "magiclink", "resend"]);
// @mutate scripts/audit/pressProdSafety.mjs |   return !(typeof token === "string" && token.length > 0); |   return true;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const ROOT = resolve(__dirname, "../..");
const gated = safety.isCaptchaGatedAuthRequest as (url: string, method: string, body: string | null) => boolean;
const AUTH = "https://fncmgoasalhdgfwzhsqa.supabase.co/auth/v1";

/** supabase-js auth method -> the GoTrue request it sends (gotrue-js GoTrueClient). */
const GUARDED_METHODS: Record<string, string> = {
  signUp: `${AUTH}/signup`,
  signInWithPassword: `${AUTH}/token?grant_type=password`,
  signInWithOtp: `${AUTH}/otp`,
  resetPasswordForEmail: `${AUTH}/recover?redirect_to=https%3A%2F%2Fwww.louisianahelpr.com%2Freset-password`,
  resend: `${AUTH}/resend`,
};

const SRC_FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));

describe("press: CAPTCHA-guarded auth calls are a documented skip, not a failure (Q1374)", () => {
  it("inventories the guarded auth calls the app makes", () => {
    const called = new Set<string>();
    for (const f of SRC_FILES) {
      const src = blankComments(readFileSync(join(ROOT, f), "utf8"));
      for (const m of Object.keys(GUARDED_METHODS)) if (new RegExp(`\\.auth\\.${m}\\(`).test(src)) called.add(m);
    }
    // resetPasswordForEmail (the failing press), signUp, signInWithPassword, resend at least.
    expect(called.size).toBeGreaterThan(2);
    expect(called.has("resetPasswordForEmail")).toBe(true);
    for (const m of called) {
      expect(gated(GUARDED_METHODS[m], "POST", JSON.stringify({ email: "x@example.com", gotrue_meta_security: {} })), `${m}: tokenless`).toBe(true);
      expect(gated(GUARDED_METHODS[m], "POST", JSON.stringify({ email: "x@example.com", gotrue_meta_security: { captcha_token: "tok" } })), `${m}: with a token`).toBe(false);
    }
  });

  it("never blocks what CAPTCHA does not guard", () => {
    expect(gated(`${AUTH}/token?grant_type=refresh_token`, "POST", JSON.stringify({ refresh_token: "r" }))).toBe(false);
    expect(gated(`${AUTH}/user`, "GET", null)).toBe(false);
    expect(gated(`${AUTH}/logout?scope=local`, "POST", null)).toBe(false);
    expect(gated(`${AUTH}/recover`, "GET", null)).toBe(false);
    expect(gated("https://fncmgoasalhdgfwzhsqa.supabase.co/rest/v1/recover", "POST", "{}")).toBe(false);
    // An unreadable body is refused by GoTrue too: fail closed.
    expect(gated(`${AUTH}/recover`, "POST", "not json")).toBe(true);
  });

  it("the harness aborts such a request and reports the press SKIP_CAPTCHA_GATED, a documented skip", () => {
    const src = blankComments(readFileSync(join(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    const open = src.indexOf('ctx.route("**' + '/auth/v1/**"');
    const close = open < 0 ? -1 : src.indexOf("\n      });", open);
    const route = open < 0 || close < 0 ? "" : src.slice(open, close);
    expect(route, "no **/auth/v1/** route in the harness").not.toBe("");
    expect(route).toMatch(/if \(isCaptchaGatedAuthRequest\(req\.url\(\), req\.method\(\), req\.postData\(\)\)\)/);
    expect(route).toMatch(/route\.abort\(/);
    expect(src).toMatch(/if \(captchaBlocked\.length > captcha0\) \{\s*rec\.pressed--; totalPressed--;\s*skip\(SKIP_CAPTCHA_GATED\);/);
    expect((harness.DOCUMENTED_SKIPS as Set<string>).has(safety.SKIP_CAPTCHA_GATED as string)).toBe(true);
  });
});
