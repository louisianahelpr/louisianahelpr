/**
 * A NARROWED LOADING-STATE RUN NEVER REPLACES THE CATALOG.
 *
 * docs/audit/loading-states/measurements.json is the evidence for every route
 * src/App.tsx declares (check-loading-state-shape.mjs fails COVERAGE on any it
 * does not hold). measure-loading-states.mjs's ROUTES=… mode used to write
 * ONLY its own surfaces to that file, so measuring three new routes (the
 * Declutter pages, 2026-10-14) would have thrown away the other 139 surfaces
 * and their 77 measured shapes. A narrowed run now merges: its surfaces replace
 * the same persona + route, every other surface stays as it was, and `at` stays
 * the catalog run's (check-staleness.mjs ages the file by it).
 *
 * @mutate scripts/audit/measure-loading-states.mjs | const surfaceId = (r) => `${r.persona} ${stableUrl(r.url)}`; | const surfaceId = (r) => r.url;
 * @mutate scripts/audit/measure-loading-states.mjs | results.push(...incoming.values()); | results.length += 0;
 * @mutate scripts/audit/measure-loading-states.mjs |     ...prev,\n    results, |     ...partial,\n    results,
 * @mutate scripts/audit/measure-loading-states.mjs | if (JSON.stringify(prev[k]) !== JSON.stringify(partial[k])) { | if (false) {
 * @mutate scripts/audit/measure-loading-states.mjs |     if (only) {\n      try {\n        catalog = JSON.parse( |     if (false) {\n      try {\n        catalog = JSON.parse(
 * @mutate scripts/audit/measure-loading-states.mjs | const doc = catalog ? mergeMeasurements(catalog, run) : run; | const doc = run;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeMeasurements } from "../../scripts/audit/measure-loading-states.mjs";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const settings = { viewport: { width: 375, height: 812 }, capture: "staged-gate", settleMs: 600, chunkDelay: 400 };
const r = (persona: string, url: string, status: string) => ({ persona, url, status });

const catalog = {
  base: "http://127.0.0.1:4173",
  ...settings,
  at: "2026-10-07T22:12:12.965Z",
  results: [
    r("customer", "/home", "measured"),
    r("helper", "/home", "measured"),
    r("customer", "/jobs/aaaa", "measured"),
    r("anon", "/login", "no-placeholder"),
  ],
};

describe("loading-state evidence: a narrowed run merges into the catalog", () => {
  it("replaces the same persona + route in place, appends new ones, keeps the rest untouched", () => {
    const partial = {
      base: "http://127.0.0.1:4500",
      ...settings,
      at: "2026-10-14T20:00:00.000Z",
      results: [r("customer", "/home", "no-placeholder"), r("anon", "/declutter", "no-placeholder"), r("customer", "/jobs/bbbb", "redirected")],
    };
    const doc = mergeMeasurements(catalog, partial);
    expect(doc.results).toEqual([
      r("customer", "/home", "no-placeholder"),
      catalog.results[1],
      r("customer", "/jobs/bbbb", "redirected"),
      catalog.results[3],
      r("anon", "/declutter", "no-placeholder"),
    ]);
    // the other persona's /home is a different surface and is kept
    expect(doc.results[1]).toBe(catalog.results[1]);
    // the catalog's age is kept; the partial run is recorded beside it
    expect(doc.at).toBe(catalog.at);
    expect(doc.base).toBe(catalog.base);
    expect(doc.merged).toEqual([{
      at: partial.at,
      base: partial.base,
      surfaces: ["customer /home", "anon /declutter", "customer /jobs/:id"],
      replaced: ["customer /home", "customer /jobs/:id"],
    }]);
    // the input is not mutated
    expect(catalog.results).toHaveLength(4);
  });

  it("refuses a partial run measured under other settings", () => {
    const partial = { ...settings, settleMs: 300, at: "x", results: [r("anon", "/declutter", "no-placeholder")] };
    expect(() => mergeMeasurements(catalog, partial)).toThrow(/settleMs differs/);
  });

  it("refuses an empty partial run, a missing catalog, and a surface measured twice", () => {
    expect(() => mergeMeasurements(catalog, { ...settings, results: [] })).toThrow(/no results/);
    expect(() => mergeMeasurements(undefined as never, { ...settings, results: [r("anon", "/x", "measured")] })).toThrow(/no catalog/);
    const twice = { ...settings, results: [r("anon", "/x", "measured"), r("anon", "/x", "measured")] };
    expect(() => mergeMeasurements(catalog, twice)).toThrow(/twice/);
  });

  it("the run writes a ROUTES=… run through the merge, never over the catalog", () => {
    const src = blankComments(readFileSync(resolve(REPO, "scripts/audit/measure-loading-states.mjs"), "utf8"));
    const write = src.slice(src.indexOf("const run = { base: BASE"), src.indexOf("writeFileSync(evidence,"));
    expect(write.length, "the evidence write in main() was not found: guard rotted").toBeGreaterThan(50);
    // Read-and-catch ENOENT, never exists-then-read (noCheckThenActInTooling.test.ts).
    expect(write).toMatch(/if \(only\) \{\s*try \{\s*catalog = JSON\.parse\(readFileSync\(evidence, "utf8"\)\);/);
    expect(write).toMatch(/const doc = catalog \? mergeMeasurements\(catalog, run\) : run;/);
  });

  it("the committed evidence holds one result per surface, and every merged surface is in it", () => {
    const ev = JSON.parse(readFileSync(resolve(REPO, "docs/audit/loading-states/measurements.json"), "utf8")) as {
      results: { persona: string; url: string }[];
      merged?: { surfaces: string[] }[];
    };
    expect(ev.results.length).toBeGreaterThan(100);
    const ids = ev.results.map((x) => `${x.persona} ${x.url.replace(/^\/jobs\/[^/?#]+/, "/jobs/:id")}`);
    expect(new Set(ids).size, "a surface appears twice in measurements.json").toBe(ids.length);
    for (const m of ev.merged ?? []) for (const s of m.surfaces) expect(ids).toContain(s);
  });
});
