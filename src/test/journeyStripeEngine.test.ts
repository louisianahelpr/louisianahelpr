/*
 * CLASS GUARD: a journey never drives Stripe's hosted Checkout inside an engine
 * the product never shows it in.
 *
 * nightly-red #1719 (e2e-journeys 36164148002, 2026-09-25): journeys-webkit
 * skipped the whole 02-marketplace money chain (post, apply, hire, do-the-job)
 * as UNJUSTIFIED because Stripe's hosted page answered Playwright's WebKit with
 * its own "Something went wrong" twice across a reload. It did so on 3 of 3
 * journeys-webkit runs (35796081270, 35905284660, 36164148002) while Chromium
 * paid a session minted the same way in the same run. The app never renders
 * Stripe in its WKWebView: native hands Checkout to SFSafariViewController
 * (src/lib/openExternalUrl.ts), and a phone browser is Safari, not Linux WebKit.
 *
 * THE CLASS, three rules read from source:
 *   1. No journey file but fixtures.ts calls `payOnStripeCheckout(` itself:
 *      a spec pays through `payCheckoutSession` (engine-aware) or
 *      `payCheckoutUrlInChromium`. Inventory floor: at least two such calls.
 *   2. `payCheckoutSession` pays in place only on chromium and otherwise goes
 *      through `payCheckoutUrlInChromium` -> `payInChromium`
 *      (e2e/journeys/stripeInChromium.ts), which launches `chromium`.
 *   3. Every e2e-journeys.yml job that runs a journeys project installs the
 *      chromium browser, so rule 2 has an engine to launch.
 */

// @mutate e2e/journeys/02-marketplace.spec.ts | await payCheckoutSession(page); | await payOnStripeCheckout(page);
// @mutate e2e/journeys/fixtures.ts | if (engineOf(page) === "chromium") { | if (engineOf(page) !== "") {
// @mutate .github/workflows/e2e-journeys.yml | install --with-deps webkit chromium | install --with-deps webkit
// @mutate e2e/journeys/stripeInChromium.ts | const browser = await chromium.launch(); | const browser = await webkit.launch();

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");
const JOURNEYS = join(root, "e2e/journeys");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(JOURNEYS).map((p) => ({ rel: relative(root, p), code: blankComments(readFileSync(p, "utf8")) }));
const fixtures = files.find((f) => f.rel === "e2e/journeys/fixtures.ts")?.code ?? "";
const stripeInChromium = files.find((f) => f.rel === "e2e/journeys/stripeInChromium.ts")?.code ?? "";

/** The body of `export async function <name>(`, up to the next top-level `}`. */
function fnBody(src: string, name: string): string {
  const m = new RegExp(`export async function ${name}\\([\\s\\S]*?\\n}\\n`).exec(src);
  return m?.[0] ?? "";
}

describe("journeys pay Stripe in the engine the product shows it in", () => {
  it("no journey spec drives Stripe's page itself (floor: specs pay through the engine-aware helpers)", () => {
    expect(files.length).toBeGreaterThan(5);
    const direct = files
      .filter((f) => f.rel !== "e2e/journeys/fixtures.ts" && f.rel !== "e2e/journeys/stripeInChromium.ts")
      .flatMap((f) => (f.code.match(/\bpayOnStripeCheckout\(/g) ?? []).map(() => f.rel));
    expect(direct, "a journey spec pays on Stripe's page in its own engine; use payCheckoutSession / payCheckoutUrlInChromium").toEqual([]);
    const routed = files.flatMap((f) => f.code.match(/\b(?:payCheckoutSession|payCheckoutUrlInChromium)\(/g) ?? []);
    // Two definitions in fixtures.ts are excluded by requiring an `await` call site.
    const calls = files.flatMap((f) => f.code.match(/await (?:payCheckoutSession|payCheckoutUrlInChromium)\(/g) ?? []);
    expect(routed.length).toBeGreaterThan(2);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("payCheckoutSession pays in place only on chromium, and the second engine is a launched chromium", () => {
    const session = fnBody(fixtures, "payCheckoutSession");
    expect(session, "payCheckoutSession is gone from fixtures.ts").not.toBe("");
    expect(session).toMatch(/if \(engineOf\(page\) === "chromium"\) \{\s*await payOnStripeCheckout\(page\);\s*return;/);
    expect(session).toMatch(/await payCheckoutUrlInChromium\(page\.url\(\)\)/);
    expect(fnBody(fixtures, "payCheckoutUrlInChromium")).toMatch(/return payInChromium\(checkoutUrl, payOnStripeCheckout\)/);
    const inChromium = fnBody(stripeInChromium, "payInChromium");
    expect(inChromium, "payInChromium is gone from e2e/journeys/stripeInChromium.ts").not.toBe("");
    expect(inChromium).toMatch(/await chromium\.launch\(/);
    expect(inChromium).toMatch(/await pay\(page\)/);
  });

  it("every journeys job in e2e-journeys.yml installs chromium", () => {
    const wf = readFileSync(join(root, ".github/workflows/e2e-journeys.yml"), "utf8");
    const jobs = wf.split(/\n {2}(?=[\w-]+:\n)/).filter((b) => /npx playwright test --project=journeys/.test(b));
    expect(jobs.length).toBeGreaterThan(1);
    for (const job of jobs) {
      const name = /^([\w-]+):/.exec(job.trimStart())?.[1] ?? "?";
      const install = /npx playwright install --with-deps ([^\n]+)/.exec(job)?.[1] ?? "";
      expect(install.split(/\s+/), `${name} does not install chromium, which payCheckoutSession launches`).toContain("chromium");
    }
  });
});
