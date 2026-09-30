/**
 * NIGHTLY JOURNEYS NEVER PAY LIVE, AND NEVER ASSERT AGAINST AN OWNER DECISION.
 *
 * Stripe went live on prod 2026-09-27. The owner's decision: nightly journeys
 * create checkouts but never pay one, so a live pay step is the ONE justified
 * skip (`skipLivePay`, e2e/prod-audit/fundedOpenJob.ts). `fund()` already takes
 * it. Three journeys paid a Checkout by hand instead and fell over in run
 * 36561180641 (nightly-red #1719), each in a different way:
 *
 *  - 02-marketplace J2 went on to look for its unfunded job in My Posts, which
 *    hides never-paid jobs by design: "missing from My Posts > Needs You".
 *  - time-travel's funded countdown then tore the job down with a jobs DELETE,
 *    which the DELETE policy refuses once create-payment stamped a
 *    stripe_session_id: "the unfunded job was not deleted".
 *  - 04-money-outcomes' tip leg would have opened a live tip Checkout.
 *
 * And 04-admin-safety's ban journey asserted a banned account LOSES sign-in,
 * gated on a grep of supabase/migrations for "banned_until" that matched the
 * comment explaining why it is never set. The owner decided the opposite
 * (Q281/Q294: banned accounts keep sign-in, DB gates refuse every write).
 *
 * Classes, each read from the e2e tree itself:
 *  1. every hand-rolled pay call (`payCheckoutSession(` /
 *     `payCheckoutUrlInChromium(`) is preceded by a `skipLivePay(`;
 *  2. a teardown that knows the job may be funded (it calls cancel_escrow)
 *     never DELETEs the job row;
 *  3. no spec decides what to assert by reading supabase/migrations text;
 *  4. the ban journey asserts the session SURVIVES.
 *
 * @mutate e2e/journeys/time-travel.spec.ts | if (mode === "live") skipLivePay( | if (false) skipLivePay(
 * @mutate e2e/journeys/02-marketplace.spec.ts |         skipLivePay(S.livePay);\n |
 * @mutate e2e/journeys/04-money-outcomes.spec.ts | if (tipMode === "live") skipLivePay( | if (false) skipLivePay(
 * @mutate e2e/journeys/time-travel.spec.ts | request.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, { | request.delete(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
 * @mutate e2e/journeys/04-admin-safety.spec.ts | against the owner's Q281 decision: ${await refresh.text()}`).toBe(true); | against the owner's Q281 decision: ${await refresh.text()}`).toBe(false);
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const E2E = resolve(ROOT, "e2e");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(E2E).map((p) => ({ rel: relative(ROOT, p), code: blankComments(readFileSync(p, "utf8")) }));

describe("nightly journeys and live Stripe", () => {
  it("every hand-rolled pay call is preceded by skipLivePay", () => {
    const LOOKBACK = 15;
    const sites: string[] = [];
    const unguarded: string[] = [];
    for (const f of files) {
      const lines = f.code.split("\n");
      lines.forEach((line, i) => {
        if (!/\b(?:payCheckoutSession|payCheckoutUrlInChromium)\(/.test(line)) return;
        if (/\bfunction\s+pay/.test(line)) return; // the definitions
        if (f.rel === "e2e/journeys/fixtures.ts") return; // payCheckoutSession's own body
        const site = `${f.rel}:${i + 1}`;
        sites.push(site);
        const before = lines.slice(Math.max(0, i - LOOKBACK), i).join("\n");
        /* The skip must be taken ON the live mode, not merely be present: a
           switched-off condition (`if (false) skipLivePay(`) pays live again. */
        if (!/if\s*\(\s*[\w.]+\s*(?:===\s*"live"|!==\s*"test")\s*\)\s*(?:\{[\s\S]{0,800}?)?\bskipLivePay\(/.test(before)) unguarded.push(site);
      });
    }
    // time-travel, 02-marketplace, 04-money-outcomes on 2026-09-30.
    expect(sites.length, `pay call inventory: ${sites.join(", ")}`).toBeGreaterThan(2);
    expect(unguarded, "a journey that pays a Checkout by hand must skipLivePay first (owner, 2026-09-27)").toEqual([]);
  });

  it("a teardown that may meet a funded job never DELETEs the job row", () => {
    const blocks: string[] = [];
    const offending: string[] = [];
    for (const f of files) {
      const starts = [...f.code.matchAll(/journey\.cleanup\(/g)].map((m) => m.index!);
      starts.forEach((s, k) => {
        const end = starts[k + 1] ?? f.code.indexOf("test.step(", s);
        const body = f.code.slice(s, end > s ? end : undefined);
        if (!body.includes("cancel_escrow")) return;
        blocks.push(`${f.rel}@${s}`);
        if (/\.delete\(\s*`[^`]*\/rest\/v1\/jobs\?/.test(body)) offending.push(`${f.rel}@${s}`);
      });
    }
    expect(blocks.length, "no funded-job journey teardown found").toBeGreaterThan(0);
    expect(offending, "the jobs DELETE policy refuses a row with a stripe_session_id; use poster_cancel_job").toEqual([]);
  });

  it("no spec decides what to assert from migration text", () => {
    const readers = files.filter((f) => /readdirSync\([^)]*migrations|["'`][^"'`]*supabase\/migrations/.test(f.code)).map((f) => f.rel);
    expect(files.length).toBeGreaterThan(50);
    expect(readers, "a migration file is not the live database; its comments matched a ban grep").toEqual([]);
  });

  it("the ban journey asserts a banned account keeps sign-in (Q281)", () => {
    const f = files.find((x) => x.rel === "e2e/journeys/04-admin-safety.spec.ts");
    expect(f, "04-admin-safety.spec.ts is gone").toBeTruthy();
    const m = f!.code.match(/expect\(refresh\.ok\(\)[\s\S]*?\)\.toBe\((true|false)\)/);
    expect(m, "the ban journey no longer checks the refresh").toBeTruthy();
    expect(m![1]).toBe("true");
  });
});
