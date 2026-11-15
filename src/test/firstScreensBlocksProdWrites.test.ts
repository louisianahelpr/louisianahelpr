/**
 * Owner rule: test data never reaches the owner. e2e/web-vitals/first-screens.spec.ts loads every first screen on PROD
 * data, signed in as the shared poster, and until 11-14 it opened its pages with ctx.newPage() and no block at all: a
 * screen that writes on load reached the real database, and every error a throttled load raised went to Sentry.
 *
 * Every context it makes now gets cwv-lab's write block (installLabWriteBlock: non-GETs to Supabase and Stripe aborted
 * except declared reads, *.sentry.io always aborted, proven live by the lab's probe before any page opens), and every
 * page is opened with newBlockedPage. The block itself is held by src/test/cwvLabBlocksProdWrites.test.ts.
 */
// @mutate e2e/web-vitals/first-screens.spec.ts |   await installLabWriteBlock(ctx, { reads: LAB_READS, browserName: browser.browserType().name() }); |
// @mutate scripts/perf/cwv-lab.mjs |   const proof = probeWriteBlock(ctx, blocked); |   const proof = Promise.resolve();
// @mutate e2e/web-vitals/first-screens.spec.ts | const LAB_READS = { rpcs: declaredReadRpcSet(), refresh: false }; | const LAB_READS = null;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("the first-screens spec never writes to prod or reports to Sentry", () => {
  const spec = code("e2e/web-vitals/first-screens.spec.ts");

  it("every context it makes installs the lab's block before returning", () => {
    const fn = /async function labContext\([\s\S]*?\n\}/.exec(spec)?.[0] ?? "";
    expect(fn).toMatch(/serviceWorkers: "block"/);
    expect(fn).toMatch(/await installLabWriteBlock\(ctx, \{ reads: LAB_READS, browserName: browser\.browserType\(\)\.name\(\) \}\);\s*return ctx;/);
    // Contexts come only from labContext.
    expect(spec.match(/browser\.newContext\(/g)).toHaveLength(1);
    expect(spec.match(/await labContext\(/g)?.length ?? 0).toBeGreaterThan(2);
  });

  it("every page is opened behind the block, none with ctx.newPage()", () => {
    expect(spec).not.toMatch(/\.newPage\(\)/);
    expect(spec.match(/await newBlockedPage\(ctx\)/g)?.length ?? 0).toBeGreaterThan(2);
  });

  it("the reads it lets through are the migrations' STABLE/IMMUTABLE functions, and the helper proves the block", () => {
    expect(spec).toMatch(/const LAB_READS = \{ rpcs: declaredReadRpcSet\(\), refresh: false \};/);
    const lab = code("scripts/perf/cwv-lab.mjs");
    const helper = /export async function installLabWriteBlock\([\s\S]*?\n\}/.exec(lab)?.[0] ?? "";
    expect(helper).toMatch(/await installWriteBlock\(ctx, clock, reads, allowed, browserName\);\s*const proof = probeWriteBlock\(ctx, blocked\);[\s\S]*?await proof;/);
    expect(lab).toMatch(/const SENTRY_HOST = \/\(\^\|\\\.\)sentry\\\.io\$\/;/);
  });
});
