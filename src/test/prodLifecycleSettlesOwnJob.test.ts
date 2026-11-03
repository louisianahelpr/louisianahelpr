/*
 * Q2073: every failed run of e2e/prod-lifecycle.spec.ts left TWO hired+funded
 * "[E2E DO NOT ACCEPT] r…" rows in prod (the attempt and its Playwright retry;
 * 3e1d3779 + 4ed49d85 from run 41553087594), because its afterEach cleaned only
 * proof photos. The attempt knows the row is its own, so a failed attempt now
 * settles it forward itself. This guard reads the spec (comments blanked) and
 * fails if the job stops being recorded or the failed-attempt settle goes away.
 */
// @mutate e2e/prod-lifecycle.spec.ts | if (job?.id) attemptJob = { id: job.id, poster, helper }; | void job;
// @mutate e2e/prod-lifecycle.spec.ts | if (!READY \|\| !mine \|\| testInfo.status === testInfo.expectedStatus) return; | return;
// @mutate e2e/prod-lifecycle.spec.ts |       const out = await settleJobForward({ |       const out = await (async (_x: unknown) => ({ settled: true, steps: [] as string[], reason: "", status: null, paymentStatus: null }))({
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SPEC = join(__dirname, "..", "..", "e2e/prod-lifecycle.spec.ts");
const code = blankComments(readFileSync(SPEC, "utf8"));

/** The body of every `test.afterEach(` hook, by brace matching. */
function afterEachBodies(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf("test.afterEach(");
  while (at !== -1) {
    const open = src.indexOf("{", src.indexOf("=>", at));
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    out.push(src.slice(open, i + 1));
    at = src.indexOf("test.afterEach(", i);
  }
  return out;
}

describe("the money-loop spec settles its own job when an attempt fails (Q2073)", () => {
  const hooks = afterEachBodies(code);

  it("has afterEach hooks to read (inventory floor)", () => {
    expect(hooks.length).toBeGreaterThan(1);
  });

  it("records the job it created, with both seats", () => {
    expect(code).toMatch(/const \[job\] = await created\.json\(\);\s*if \(job\?\.id\) attemptJob = \{ id: job\.id, poster, helper \};/);
  });

  it("an afterEach settles that job forward when, and only when, the test did not pass", () => {
    const settle = hooks.filter((h) => /settleJobForward\(\{/.test(h));
    expect(settle.length, "exactly one afterEach settles the attempt's job").toBe(1);
    const h = settle[0];
    expect(h).toMatch(/testInfo\.status === testInfo\.expectedStatus\) return;/);
    expect(h).toMatch(/jobId: mine\.id/);
    expect(h).toMatch(/helperToken: mine\.helper\.access_token/);
    // The guard is the early return; the call must come after it.
    expect(h.indexOf("settleJobForward(")).toBeGreaterThan(h.indexOf("expectedStatus) return;"));
  });
});
