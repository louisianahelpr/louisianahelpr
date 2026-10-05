// @mutate scripts/check-generated-current.mjs | return after.every((text, k) => text === before[k]); | return false;
// @mutate scripts/check-generated-current.mjs | problems.every((p) => p.startsWith("STALE ")) | problems.every(() => true)
// @mutate scripts/check-generated-current.mjs |     if (a !== b) { |     if (false) {
/*
 * Every committed inventory is current (OPEN.md Q36; owner, 2026-09-23:
 * "nothing at all should ever be stale") — ON MAIN (owner, 2026-10-05).
 *
 * scripts/check-generated-current.mjs re-runs each CI-runnable generator and
 * diffs its output against the committed copy. Branches never commit those
 * outputs (scripts/check-branch-generated.mjs), so the full check is main's
 * (staleness-watch.yml, which lands the regeneration as
 * bot/refresh/inventories); a branch is judged only on the registry scans
 * (--coverage). This guard proves the checker itself can fail on a planted
 * stale output (never on the committed copies, which a branch leaves stale by
 * design), and the registry-coverage scans red on planted gaps in both
 * directions.
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  firstDiff,
  generatorFailed,
  isPureDrift,
  normalise,
  // @ts-expect-error — plain .mjs script, no declaration file
} from "../../scripts/check-generated-current.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

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

  // Owner, 2026-10-05: one writer of every generated file, the bot on main.
  it("the full regenerate-and-diff runs on main only; a branch runs the registry scan", () => {
    // code lines only: the header comment tells the history of the old refresh
    const land = read("scripts/land.sh").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(land).not.toMatch(/check-generated-current\.mjs --fix|inventories:refresh|--skip-post-merge/);
    expect(land).toMatch(/^\s*node scripts\/check-generated-current\.mjs --coverage$/m);
    const test = read(".github/workflows/test.yml");
    expect(test).not.toMatch(/check:generated|--attribute|--skip-post-merge/);
    expect(test).toMatch(/node scripts\/check-generated-current\.mjs --coverage/);
    const watch = read(".github/workflows/staleness-watch.yml");
    expect(watch).toMatch(/npm run -s check:generated/);
    expect(watch).toMatch(/regenerate: npm run inventories:refresh/);
    const self = read("scripts/check-generated-current.mjs");
    expect(self).not.toMatch(/postMerge|skip-post-merge|attributeDrift/);
  });

  describe("the checker goes red on a stale output and leaves the tree as it was", () => {
    const rel = `test-results/checkgen-${process.pid}.txt`;
    const abs = join(ROOT, rel);
    const gen = (content: string) => ({
      id: "planted",
      cmd: [process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(abs)}, ${JSON.stringify(content)})`],
      outputs: [rel],
    });
    afterEach(() => rmSync(abs, { force: true }));

    it("STALE when the generator now produces something else; the committed bytes are restored", () => {
      mkdirSync(join(ROOT, "test-results"), { recursive: true });
      writeFileSync(abs, "guards: 1285\n");
      const p = checkGenerator(gen("guards: 1286\n")) as string[];
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(/^STALE test-results\/checkgen-/);
      expect(isPureDrift(p)).toBe(true);
      expect(readFileSync(abs, "utf8")).toBe("guards: 1285\n");
    });

    it("current when it produces the committed bytes", () => {
      mkdirSync(join(ROOT, "test-results"), { recursive: true });
      writeFileSync(abs, "guards: 1285\n");
      expect(checkGenerator(gen("guards: 1285\n"))).toEqual([]);
      expect(existsSync(abs)).toBe(true);
    });
  });

  it("--coverage passes on this tree (a branch's registry check)", () => {
    const r = spawnSync(process.execPath, ["scripts/check-generated-current.mjs", "--coverage"], { cwd: ROOT, encoding: "utf8" });
    expect(`${r.stdout}${r.stderr}`).toMatch(/registries complete/);
    expect(r.status).toBe(0);
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

describe("drift is its own exit code (staleness-watch lands it)", () => {
  it("exit 3 only when every problem is a stale output", () => {
    expect(isPureDrift(["STALE docs/a.md — differs", "STALE docs/b.json — differs"])).toBe(true);
    expect(isPureDrift(["STALE docs/a.md — differs", "docs/x.md: generator crashed"])).toBe(false);
    expect(isPureDrift([])).toBe(false);
  });
});
