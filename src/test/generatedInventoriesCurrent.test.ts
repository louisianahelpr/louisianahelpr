// @mutate scripts/check-generated-current.mjs |   const active = GENERATED.filter((g) => !(skipPostMerge && g.postMerge)); |   const active = GENERATED;
// @mutate scripts/check-generated-current.mjs | return after.every((text, k) => text === before[k]); | return false;
// @mutate scripts/check-generated-current.mjs | return { ok: own.length === 0, own, inherited, other: [] }; | return { ok: true, own, inherited, other: [] };
// @mutate scripts/check-generated-current.mjs | if (head.other.length) return | if (false) return
// @mutate scripts/check-generated-current.mjs | problems.every((p) => p.startsWith("STALE ")) | problems.every(() => true)
// @mutate scripts/check-generated-current.mjs | if (m) stale.add(m[1]); | if (m) other.push(line);
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
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
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
  attributeDrift,
  firstDiff,
  generatorFailed,
  isPureDrift,
  normalise,
  parseCheckOutput,
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

  // Owner, 2026-10-04: whole-tree totals are generated after merge, not in every
  // PR (every landing touched the same lines and conflicted). Branches skip
  // them; staleness-watch.yml regenerates main per push, and main's own check
  // (push + nightly) is strict. Exact list, both ways.
  it("the whole-tree totals are post-merge, exactly these, and land.sh / PR attribution skip them", () => {
    const post = (GENERATED as (Gen & { postMerge?: boolean })[]).filter((g) => g.postMerge).map((g) => g.id).sort();
    expect(post).toEqual(["burndown", "coverage", "queue-count", "rollup", "scoreboard", "surface", "vacuity-report"]);
    const land = readFileSync(join(__dirname, "..", "..", "scripts", "land.sh"), "utf8");
    expect(land).toMatch(/check-generated-current\.mjs --fix --skip-post-merge/);
    expect(land).not.toMatch(/npm run -s inventories:refresh/);
    const self = readFileSync(join(__dirname, "..", "..", "scripts", "check-generated-current.mjs"), "utf8");
    expect(self).toMatch(/\["scripts\/check-generated-current\.mjs", "--skip-post-merge"\]/);
    const watch = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "staleness-watch.yml"), "utf8");
    expect(watch).not.toMatch(/--skip-post-merge/);
  });

  it("--skip-post-merge really leaves a post-merge total unchecked, and the plain check still checks it", () => {
    const run = (args: string[]) => spawnSync(process.execPath, ["scripts/check-generated-current.mjs", ...args], { cwd: join(__dirname, "..", ".."), encoding: "utf8" });
    const skipped = run(["--only", "burndown", "--skip-post-merge"]);
    expect(`${skipped.stdout}${skipped.stderr}`).not.toMatch(/GUARD-BURNDOWN|burndown/);
    const checked = run(["--only", "burndown"]);
    expect(`${checked.stdout}${checked.stderr}`).toMatch(/GUARD-BURNDOWN|burndown/);
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

// 2026-09-27: vacuity-report opts into a non-zero exit (the gate being red),
// and a crash with no node_modules also exits 1 — refresh called it
// "unchanged" and Staleness watch went red on main instead.
describe("a generator that crashes is a failure even when it may exit non-zero", () => {
  const opted = { allowNonZeroExit: true };
  const strict = {};
  it("exit 0 is never a failure", () => {
    expect(generatorFailed(strict, { status: 0 }, ["a"], ["a"])).toBe(false);
  });
  it("a non-zero exit fails a generator that did not opt in", () => {
    expect(generatorFailed(strict, { status: 1 }, ["a"], ["b"])).toBe(true);
  });
  it("an opted-in generator that rewrote its output passes", () => {
    expect(generatorFailed(opted, { status: 1 }, ["old"], ["new"])).toBe(false);
  });
  it("an opted-in generator that wrote nothing (a crash) fails", () => {
    expect(generatorFailed(opted, { status: 1 }, ["same"], ["same"])).toBe(true);
  });
});

/*
 * Drift attribution (2026-10-01, PR #2051). Aggregate counts merge cleanly to
 * the wrong number when two non-strict PRs each change them, so a stale merge
 * ref is not proof the PR is at fault. Fixtures are the real #2051 output:
 * its head 9173aa294 left both files stale (current at merge base d81c16a5c),
 * so it is red; a PR whose own head is current is not.
 */
describe("drift on a PR's merge ref is attributed to whoever caused it", () => {
  const PR2051_HEAD = [
    "::error::STALE docs/audit/vacuity-report.json — the committed copy differs from what its generator produces now",
    "      committed:     \"guards\": 1284,",
    "::error::STALE docs/GUARD-BURNDOWN.md — the committed copy differs from what its generator produces now",
  ].join("\n");

  it("parses every version's ::error:: lines into stale outputs and other problems", () => {
    const p = parseCheckOutput(`${PR2051_HEAD}\n::error::REGISTRY scripts/x.mjs writes docs/x.md but is not registered`);
    expect(p.stale).toEqual(["docs/GUARD-BURNDOWN.md", "docs/audit/vacuity-report.json"]);
    expect(p.other).toEqual(["REGISTRY scripts/x.mjs writes docs/x.md but is not registered"]);
    expect(parseCheckOutput("all current\n")).toEqual({ stale: [], other: [] });
  });

  it("exit 3 only when every problem is a stale output", () => {
    expect(isPureDrift(["STALE docs/a.md — differs", "STALE docs/b.json — differs"])).toBe(true);
    expect(isPureDrift(["STALE docs/a.md — differs", "docs/x.md: generator crashed"])).toBe(false);
    expect(isPureDrift([])).toBe(false);
  });

  it("#2051: stale at the PR head, current at its merge base = the PR's own, red", () => {
    const v = attributeDrift(parseCheckOutput(PR2051_HEAD), { stale: [], other: [] });
    expect(v.ok).toBe(false);
    expect(v.own).toEqual(["docs/GUARD-BURNDOWN.md", "docs/audit/vacuity-report.json"]);
  });

  it("current at the PR head = drift from main's other merges, green", () => {
    expect(attributeDrift({ stale: [], other: [] }, { stale: [], other: [] }).ok).toBe(true);
  });

  it("stale at the head only because it was stale at the base = inherited, green", () => {
    const base = parseCheckOutput(PR2051_HEAD);
    const v = attributeDrift(parseCheckOutput(PR2051_HEAD), base);
    expect(v.ok).toBe(true);
    expect(v.inherited).toEqual(["docs/GUARD-BURNDOWN.md", "docs/audit/vacuity-report.json"]);
  });

  it("a crash or registry gap at the PR head is never excused as drift", () => {
    const v = attributeDrift({ stale: [], other: ["docs/x.md: generator crashed"] }, { stale: [], other: [] });
    expect(v.ok).toBe(false);
    expect(v.other).toEqual(["docs/x.md: generator crashed"]);
  });
});
