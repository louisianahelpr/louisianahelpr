/*
 * CLASS GUARD (code scanning, js/file-access-to-http, 2026-10-05): a monitoring
 * script that reads a credential (Supabase access token, Stripe key, Vercel or
 * Sentry token, screenshots plus a model API key) never sends it to a host named
 * by an environment variable, unless that host is a loopback test stub.
 *
 * The `LH_*_API_BASE` variables exist so a test can point a script at a stub on
 * this machine. Read raw (`env.LH_X_API_BASE ?? "https://api..."`) they would
 * send the real token wherever the environment says. They all go through
 * scripts/lib/apiBase.mjs `apiBase()`, which accepts only http(s) on
 * 127.0.0.1 / localhost / ::1 and throws otherwise. scripts/state-review.mjs
 * (REVIEW_API_BASE, a real third-party model endpoint) allows https or loopback.
 *
 * Measured over every git-tracked scripts/ source with comments blanked:
 *   1. no `LH_*_API_BASE` is read without `apiBase(` on the same line (floor 0),
 *   2. exactly APIBASE_CALL_SITES `apiBase(` calls outside the helper (exact
 *      floor: adding a seam means raising it, removing one lowers it),
 *   3. the helper refuses what it must refuse (unit),
 *   4. state-review.mjs gates REVIEW_API_BASE through isLoopbackBase.
 * The Supabase project URL those scripts read from `.env` (VITE_SUPABASE_URL and
 * friends) is the other place a service-role / access / anon key is sent. The
 * wrapped scripts read it through `supabaseBase()`, which accepts only
 * https://<project>.supabase.co or a loopback stub: exactly SUPABASEBASE_CALL_SITES
 * calls outside the helper (exact floor), and the helper is unit-tested.
 * check-stripe-webhook-events.mjs keeps its own older loopback-or-supabase.co
 * refusal for LH_SUPABASE_FUNCTIONS_BASE and is not an API_BASE seam.
 *
 * Extended 2026-10-11 (PR #2711, code scanning js/file-access-to-http at
 * scripts/lib/testAccountEnrolment.mjs:67/69): a shared helper that takes the
 * Supabase URL and the service-role key from its CALLER pins the URL itself
 * (e2e/journeys/fixtures.ts passes PLAYWRIGHT_SUPABASE_URL unchecked), and
 * every scripts/ source that holds a service-role key and makes an HTTP call
 * goes through supabaseBase()/apiBase(), except the exact
 * KNOWN_UNPINNED_KEY_SENDERS (two-way: a pinned entry fails as stale).
 */
// @mutate scripts/check-quota-usage.mjs | const VERCEL = apiBase(env.LH_VERCEL_API_BASE, "https://api.vercel.com"); | const VERCEL = env.LH_VERCEL_API_BASE ?? "https://api.vercel.com";
// @mutate scripts/lib/apiBase.mjs | if (!isLoopbackBase(override)) { | if (false) {
// @mutate scripts/state-review.mjs | !isLoopbackBase(base)) { | false) {
// @mutate scripts/lib/apiBase.mjs | if (!hosted && !isLoopbackBase(value)) { | if (false) {
// @mutate scripts/launch-go.mjs | const SUPABASE_URL = supabaseBase(env.VITE_SUPABASE_URL); | const SUPABASE_URL = env.VITE_SUPABASE_URL;
// @mutate scripts/lib/testAccountEnrolment.mjs | const base = supabaseBase(String(supabaseUrl)).replace( | const base = String(supabaseUrl).replace(
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { apiBase, isLoopbackBase, supabaseBase } from "../../scripts/lib/apiBase.mjs";
import { ensureTestAccountsEnrolled } from "../../scripts/lib/testAccountEnrolment.mjs";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const APIBASE_CALL_SITES = 24; // measured 2026-10-12: 17 single-seam scripts (+ check-native-sign-in-config, Q1323; + check-job-access-notes-live, Q1461; + check-performance-advisor, perf-advisor lane) + quota 3 + stripe-balance 2 + opsAlertLedger 1 + stripe-test-topup 1
const SUPABASEBASE_CALL_SITES = 13; // measured 2026-10-11: pressProdSafety, prod-seed, check-test-account-strikes, prod-audit-sweeper, create-app-review-demo-account, launch-go, load-test, probes/lib/prodEnv, test-signin-link, audit-capture, probe-state-matrix, lib/adminSession (Q1314), lib/testAccountEnrolment (PR #2711)
// Scripts that hold a service-role key and make an HTTP call WITHOUT supabaseBase()/apiBase(),
// measured 2026-10-11. Exact and two-way: a new unpinned sender fails, and an entry that gains
// the pin (or stops sending) fails as stale until it is removed here.
// @two-way src/test/toolingApiBaseIsLoopbackOnly.test.ts:stale KNOWN_UNPINNED_KEY_SENDERS entry
const KNOWN_UNPINNED_KEY_SENDERS = new Set([
  "scripts/aasa-link-census.mjs",
  "scripts/audit/pressRouteProbe.mjs",
  "scripts/backfill-identity-fingerprints.mjs",
  "scripts/check-storage-refs.mjs",
  "scripts/check-stripe-webhook-events.mjs", // own loopback-or-supabase.co refusal (see header)
  "scripts/e2e/browseFixture.mjs",
  "scripts/probes/message-attachments-authz.prod.mjs",
  "scripts/storage-backup.mjs",
  "scripts/storage-orphan-sweep.mjs",
  "scripts/supabase-usage-check.mjs",
]);
const MIN_FILES = 250; // measured 2026-10-05: 290 git-tracked scripts/ sources (a scan that finds far fewer is broken, not clean)

function scriptSources(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "scripts"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((f) => /\.(mjs|cjs|js|ts)$/.test(f));
}

const sources = scriptSources().map((f) => {
  try {
    return { f, text: blankComments(readFileSync(resolve(REPO, f), "utf8")) };
  } catch {
    return { f, text: "" };
  }
});

describe("credential-bearing scripts only send to loopback overrides", () => {
  it("no LH_*_API_BASE is read raw", () => {
    const raw: string[] = [];
    for (const { f, text } of sources) {
      text.split("\n").forEach((line, i) => {
        if (/\bLH_[A-Z]+_API_BASE\b/.test(line) && !/apiBase\(/.test(line)) raw.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(raw, "wrap the read in apiBase(env.LH_X_API_BASE, defaultUrl) from scripts/lib/apiBase.mjs").toEqual([]);
  });

  it("the exact number of apiBase call sites (floor, both directions)", () => {
    let n = 0;
    for (const { f, text } of sources) {
      if (f === "scripts/lib/apiBase.mjs") continue;
      n += (text.match(/\bapiBase\(/g) ?? []).length;
    }
    expect(sources.length).toBeGreaterThan(MIN_FILES);
    expect(n).toBe(APIBASE_CALL_SITES);
  });

  it("apiBase keeps the default, accepts loopback, refuses everything else", () => {
    const d = "https://api.example.com";
    expect(apiBase(undefined, d)).toBe(d);
    expect(apiBase("", d)).toBe(d);
    expect(apiBase("http://127.0.0.1:4567/fail", d)).toBe("http://127.0.0.1:4567/fail");
    expect(apiBase("http://localhost:1/", d)).toBe("http://localhost:1");
    expect(apiBase("http://[::1]:9/x", d)).toBe("http://[::1]:9/x");
    for (const bad of [
      "https://evil.example",
      "http://evil.example:80",
      "http://127.0.0.1.evil.example",
      "http://user:pw@127.0.0.1:1",
      "ftp://127.0.0.1",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(() => apiBase(bad, d), bad).toThrow(/Refusing to send credentials/);
    }
    expect(isLoopbackBase("http://127.0.0.1:1")).toBe(true);
    expect(isLoopbackBase("https://api.supabase.com")).toBe(false);
  });

  it("state-review gates REVIEW_API_BASE through isLoopbackBase (https or loopback only)", () => {
    const s = sources.find((x) => x.f === "scripts/state-review.mjs")?.text ?? "";
    expect(s).toMatch(/REVIEW_API_BASE[\s\S]{0,300}!\/\^https:[\s\S]{0,40}&& !isLoopbackBase\(base\)\) \{/);
  });

  it("the exact number of supabaseBase call sites (floor, both directions)", () => {
    let n = 0;
    for (const { f, text } of sources) {
      if (f === "scripts/lib/apiBase.mjs") continue;
      n += (text.match(/\bsupabaseBase\(/g) ?? []).length;
    }
    expect(n).toBe(SUPABASEBASE_CALL_SITES);
  });

  it("every script that holds a service-role key and makes an HTTP call pins its host (exact, two-way)", () => {
    const holdsKey = /SERVICE_ROLE_KEY|\bserviceKey\b/;
    const sends = /\b(?:fetch|fetchImpl)\(/;
    const pinned = /\b(?:supabaseBase|apiBase)\(/;
    const senders = sources.filter(({ text }) => holdsKey.test(text) && sends.test(text)).map(({ f }) => f);
    expect(senders.length).toBeGreaterThan(15); // measured 2026-10-11: 24 (a scan that finds far fewer is broken)
    expect(senders).toContain("scripts/lib/testAccountEnrolment.mjs");
    const unpinned = senders.filter((f) => !pinned.test(sources.find((x) => x.f === f)?.text ?? "")).sort();
    const fresh = unpinned.filter((f) => !KNOWN_UNPINNED_KEY_SENDERS.has(f));
    const stale = [...KNOWN_UNPINNED_KEY_SENDERS].filter((f) => !unpinned.includes(f));
    expect(fresh, "read the Supabase URL through supabaseBase() (or apiBase()) from scripts/lib/apiBase.mjs").toEqual([]);
    expect(stale, "stale KNOWN_UNPINNED_KEY_SENDERS entry: it is pinned now (or no longer sends a key), remove it").toEqual([]);
  });

  it("ensureTestAccountsEnrolled refuses to send the service-role key to a non-Supabase host (no request leaves)", async () => {
    for (const bad of ["https://evil.example", "https://x.supabase.co.evil.example", "http://x.supabase.co"]) {
      const urls: string[] = [];
      const fetchImpl = (async (url: string) => {
        urls.push(url);
        return new Response("[]", { status: 200 });
      }) as unknown as typeof fetch;
      await expect(
        ensureTestAccountsEnrolled({ supabaseUrl: bad, serviceKey: "k", userIds: ["u1"], note: "t", fetchImpl }),
        bad,
      ).rejects.toThrow(/Refusing to send credentials/);
      expect(urls, bad).toEqual([]);
    }
  });

  it("supabaseBase passes empty, accepts a hosted project or loopback, refuses everything else", () => {
    expect(supabaseBase(undefined)).toBeUndefined();
    expect(supabaseBase("")).toBe("");
    expect(supabaseBase("https://fncmgoasalhdgfwzhsqa.supabase.co")).toBe("https://fncmgoasalhdgfwzhsqa.supabase.co");
    expect(supabaseBase("https://abc-1.supabase.co/")).toBe("https://abc-1.supabase.co/");
    expect(supabaseBase("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    for (const bad of [
      "https://evil.example",
      "https://x.supabase.co.evil.example",
      "https://supabase.co",
      "http://x.supabase.co",
      "https://user:pw@x.supabase.co",
      "https://evil.example/x.supabase.co",
      "ftp://x.supabase.co",
      "not a url",
    ]) {
      expect(() => supabaseBase(bad), bad).toThrow(/Refusing to send credentials/);
    }
  });
});
