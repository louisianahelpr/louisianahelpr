// @mutate scripts/check-coverage-floor.mjs | if (m.pct < floor) failures.push | if (m.pct < floor - 50) failures.push
// @mutate scripts/check-coverage-floor.mjs | else if (m.pct > floor + band) | else if (m.pct > floor + band + 50)
// @mutate scripts/check-coverage-floor.mjs | if (!m \|\| m.files === 0) { | if (!m) {
// @mutate .github/workflows/vitest.yml | run: node scripts/check-coverage-floor.mjs | run: echo skipped
/**
 * Q184 (owner, 2026-09-27): CI enforces a line-coverage floor for src/lib and
 * src/hooks. This proves the checker fails in both directions and on an empty
 * measurement, and that vitest.yml actually runs it after a --coverage run.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import { BAND, compareFloors, measureAreas } from "../../scripts/check-coverage-floor.mjs";

const summary = {
  total: { lines: { covered: 0, total: 0 } },
  "/repo/src/lib/a.ts": { lines: { covered: 60, total: 100 } },
  "/repo/src/lib/b.ts": { lines: { covered: 0, total: 100 } },
  "/repo/src/hooks/useX.ts": { lines: { covered: 50, total: 100 } },
};

const cfg0 = () => readFileSync("vitest.config.ts", "utf8");

describe("coverage floor (Q184)", () => {
  const m = measureAreas(summary, ["src/lib/", "src/hooks/"], "/repo");

  it("sums lines per area", () => {
    expect(m["src/lib/"]).toMatchObject({ covered: 60, total: 200, files: 2, pct: 30 });
    expect(m["src/hooks/"].pct).toBe(50);
  });

  it("passes at the floor and inside the band", () => {
    expect(compareFloors(m, { "src/lib/": 30, "src/hooks/": 50 - BAND })).toEqual([]);
  });

  it("fails when coverage falls below the floor", () => {
    expect(compareFloors(m, { "src/lib/": 30.5 }).join()).toMatch(/FELL/);
  });

  it("fails when coverage rises past floor + band (raise the floor)", () => {
    expect(compareFloors(m, { "src/hooks/": 48 }).join()).toMatch(/ROSE past the floor/);
  });

  it("fails when an area measured no files", () => {
    const empty = measureAreas(summary, ["src/nope/"], "/repo");
    expect(compareFloors(empty, { "src/nope/": 0 }).join()).toMatch(/no files measured/);
  });

  it("vitest.yml runs vitest with --coverage, then the floor check", () => {
    const wf = readFileSync(".github/workflows/vitest.yml", "utf8");
    expect(wf).toMatch(/npx vitest run --reporter=dot --coverage/);
    expect(cfg0()).toMatch(/reportOnFailure: true/);
    expect(wf).toMatch(/run: node scripts\/check-coverage-floor\.mjs/);
    const cfg = readFileSync("vitest.config.ts", "utf8");
    expect(cfg).toMatch(/provider: "v8"/);
    expect(cfg).toMatch(/"json-summary"/);
  });

  it("the committed floors are real measurements, not zero", () => {
    const floors = JSON.parse(readFileSync("scripts/coverage-baseline.json", "utf8")).areas;
    expect(Object.keys(floors).length).toBeGreaterThan(1);
    for (const v of Object.values(floors)) expect(v as number).toBeGreaterThan(10);
  });
});
