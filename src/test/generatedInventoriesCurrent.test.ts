// @mutate scripts/burndown-score.mjs | r.files++; | r.files += 2;
/*
 * Every committed inventory is current (OPEN.md Q36; owner, 2026-09-23:
 * "nothing at all should ever be stale").
 *
 * scripts/check-generated-current.mjs re-runs each CI-runnable generator and
 * diffs its output against the committed copy. This guard proves the checker
 * itself can fail: the registered mutation makes the burn-down generator count
 * differently, and the real regenerate-and-diff below must go red on it. The
 * registry-coverage scans are shown red on planted gaps in both directions.
 */
import { describe, it, expect } from "vitest";
import {
  GENERATED,
  EVIDENCE,
  TWO_WAY,
  HISTORICAL,
  WRITES_NOT_COMMITTED,
  checkGenerator,
  coverageProblems,
  discoverDeclaredGenerated,
  discoverWriters,
  firstDiff,
  normalise,
  // @ts-expect-error — plain .mjs script, no declaration file
} from "../../scripts/check-generated-current.mjs";

type Gen = { id: string; outputs: string[] };
const byId = (id: string) => (GENERATED as Gen[]).find((g) => g.id === id);

describe("generated inventories are current", () => {
  it("the inventories are real (floors: a scan that finds nothing must fail)", () => {
    expect(GENERATED.length).toBeGreaterThanOrEqual(7);
    expect(EVIDENCE.length).toBeGreaterThanOrEqual(4);
    const writers = discoverWriters() as string[];
    expect(writers.length).toBeGreaterThanOrEqual(38);
    expect(writers).toContain("scripts/audit-surface.mjs");
    const declared = discoverDeclaredGenerated() as string[];
    expect(declared.length).toBeGreaterThanOrEqual(6);
    expect(declared).toContain("docs/GUARD-BURNDOWN.md");
  });

  it("the committed burn-down score is exactly what its generator produces now", () => {
    expect(checkGenerator(byId("burndown"))).toEqual([]);
  });

  it("the committed form inventory is exactly what its generator produces now", () => {
    expect(checkGenerator(byId("form-inventory"))).toEqual([]);
  });

  it("every writer, generated file and timestamped JSON is registered — both directions", () => {
    expect(coverageProblems()).toEqual([]);
  });

  it("is RED on an unregistered writer, a stale registry entry, and an unregistered generated file", () => {
    const writers = [...(discoverWriters() as string[]), "scripts/new-inventory.mjs"].filter(
      (w) => w !== "scripts/gateLock.mjs",
    );
    const p = coverageProblems({ writers, declared: [...(discoverDeclaredGenerated() as string[]), "docs/NEW.md"], evidence: ["x/new.json"] }) as string[];
    expect(p.some((s) => s.includes("scripts/new-inventory.mjs writes files but is in no registry"))).toBe(true);
    expect(p.some((s) => s.includes("WRITES_NOT_COMMITTED entry scripts/gateLock.mjs no longer writes"))).toBe(true);
    expect(p.some((s) => s.includes("docs/NEW.md declares itself generated"))).toBe(true);
    expect(p.some((s) => s.includes("x/new.json carries a measurement timestamp"))).toBe(true);
  });

  it("normalises only the declared volatile timestamp, so a changed number still fails", () => {
    const vol = [/^\s*"generated": "[^"]*",?$/];
    const a = '{\n  "generated": "2026-09-20T00:00:00Z",\n  "guards": 715\n}';
    const b = '{\n  "generated": "2026-09-23T00:00:00Z",\n  "guards": 715\n}';
    const c = '{\n  "generated": "2026-09-23T00:00:00Z",\n  "guards": 716\n}';
    expect(normalise(a, vol)).toBe(normalise(b, vol));
    expect(normalise(a, vol)).not.toBe(normalise(c, vol));
    expect(firstDiff(normalise(a, vol), normalise(c, vol))).toMatchObject({ line: 3 });
  });

  it("registries hold reasons, not blanks", () => {
    for (const r of [TWO_WAY, HISTORICAL, WRITES_NOT_COMMITTED]) {
      for (const [k, why] of Object.entries(r as Record<string, string>)) {
        expect(why.length, k).toBeGreaterThan(8);
      }
    }
  });
});
