/**
 * The required `Vitest unit tests` check is an aggregate over sharded runs
 * (vitest.yml, 2026-10-04: the suite runs in parallel shards (six since 2026-10-05) so a landing
 * waits ~1/4 as long). The aggregate must FAIL unless every shard passed: a
 * failed, cancelled or skipped shard must never read as green, and the shards
 * must cover the whole suite (1/N..N/N).
 */
// @mutate .github/workflows/vitest.yml |           test "$SHARDS" = "success" |           true
// @mutate .github/workflows/vitest.yml |     if: ${{ always() }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 5 |     runs-on: ubuntu-latest\n    timeout-minutes: 5
// @mutate .github/workflows/vitest.yml |         shard: [1, 2, 3, 4, 5, 6] |         shard: [1, 2, 3, 4, 5]
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

type Job = { name?: string; needs?: string | string[]; if?: string; strategy?: { matrix?: { shard?: number[] } }; steps?: { run?: string }[] };
const wf = parse(readFileSync(join(__dirname, "..", "..", ".github", "workflows", "vitest.yml"), "utf8")) as { jobs: Record<string, Job> };

// Two sharded runs, each with its own gate (2026-10-29, issue #3685: the coverage run was sharded too,
// because the unsharded one outgrew its 45-minute limit). Each gate needs exactly its own shard job.
const PAIRS = [
  { gate: "Vitest unit tests", shardJob: "vitest-shard", resultVar: "SHARDS" },
  { gate: "Coverage floor", shardJob: "coverage-shard", resultVar: "COV_SHARDS" },
];
// @mutate .github/workflows/vitest.yml |           test "$COV_SHARDS" = "success" |           true
// @mutate .github/workflows/vitest.yml |         shard: [1, 2, 3, 4] |         shard: [1, 2, 3]
// @mutate .github/workflows/vitest.yml |     needs: coverage-shard\n    if: ${{ always() && github.event_name != 'merge_group' }} |     needs: coverage-shard
describe("each sharded check passes only when every one of its shards passed", () => {
  const entries = Object.entries(wf.jobs);
  const shardJobs = entries.filter(([, j]) => (j.steps ?? []).some((s) => /vitest run[^\n]*--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.test(s.run ?? "")));

  it("finds both shard jobs and both gates (floor: 2 pairs)", () => {
    expect(shardJobs.length).toBeGreaterThan(1);
    expect(shardJobs.map(([id]) => id).sort()).toEqual(PAIRS.map((p) => p.shardJob).sort());
    for (const p of PAIRS) expect(entries.find(([, j]) => j.name === p.gate), `a job named '${p.gate}'`).toBeTruthy();
  });

  for (const p of PAIRS) {
    it(`${p.shardJob}: the shards cover the whole suite: 1..N for --shard=…/N`, () => {
      const job = wf.jobs[p.shardJob];
      const run = (job.steps ?? []).map((s) => s.run ?? "").join("\n");
      const n = Number(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.exec(run)![1]);
      expect(n).toBeGreaterThan(1);
      expect(job.strategy?.matrix?.shard).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect((job as { strategy?: { "fail-fast"?: boolean } }).strategy?.["fail-fast"]).toBe(false);
    });

    it(`'${p.gate}' needs ${p.shardJob}, always runs, and fails unless their result is success`, () => {
      const [, g] = entries.find(([, j]) => j.name === p.gate)!;
      const needs = Array.isArray(g.needs) ? g.needs : [g.needs];
      expect(needs).toEqual([p.shardJob]);
      expect(g.if).toMatch(/always\(\)/);
      const run = (g.steps ?? []).map((s) => s.run ?? "").join("\n");
      expect(run).toContain(`test "$${p.resultVar}" = "success"`);
    });
  }
});
