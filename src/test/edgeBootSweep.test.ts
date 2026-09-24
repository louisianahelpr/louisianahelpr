/**
 * EF-028: the weekly edge smoke must probe every deployed function, not just
 * health-check, and a 5xx from any of them must fail it.
 *
 * @mutate scripts/probes/edge-boot-sweep.mjs |   return code === 0 \|\| code >= 500; |   return code === 0;
 * @mutate .github/workflows/edge-function-smoke.yml |         run: node scripts/probes/edge-boot-sweep.mjs |         run: echo skipped
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error plain .mjs script
import { functionSlugs, isBroken } from "../../scripts/probes/edge-boot-sweep.mjs";

const ROOT = resolve(__dirname, "../..");

describe("edge smoke boot-probes every function (EF-028)", () => {
  it("the sweep's list is every function directory", () => {
    const slugs: string[] = functionSlugs();
    const dirs = readdirSync(resolve(ROOT, "supabase/functions")).filter((f) => !f.startsWith("_") && !f.startsWith("."));
    // Inventory floor: 73 functions measured 2026-09-24.
    expect(slugs.length).toBeGreaterThanOrEqual(60);
    expect(slugs).toContain("health-check");
    expect(slugs).toContain("stripe-webhook");
    expect(slugs.length).toBe(dirs.filter((d) => slugs.includes(d)).length);
  });

  it("a 5xx or no response is broken; a 4xx answer is a booted worker", () => {
    for (const c of [0, 500, 503, 546]) expect(isBroken(c), String(c)).toBe(true);
    for (const c of [200, 204, 401, 404, 405]) expect(isBroken(c), String(c)).toBe(false);
  });

  it("the scheduled smoke workflow runs the sweep", () => {
    const wf = readFileSync(resolve(ROOT, ".github/workflows/edge-function-smoke.yml"), "utf8");
    expect(wf).toMatch(/^\s+run: node scripts\/probes\/edge-boot-sweep\.mjs$/m);
  });
});
