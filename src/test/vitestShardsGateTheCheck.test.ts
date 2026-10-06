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

describe("the required Vitest check passes only when every shard passed", () => {
  const entries = Object.entries(wf.jobs);
  const gate = entries.find(([, j]) => j.name === "Vitest unit tests");
  const shardJobs = entries.filter(([, j]) => (j.steps ?? []).some((s) => /vitest run[^\n]*--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.test(s.run ?? "")));

  it("has one shard job and one gate job named for branch protection", () => {
    expect(gate, "a job named 'Vitest unit tests'").toBeTruthy();
    expect(shardJobs).toHaveLength(1);
  });

  it("the shards cover the whole suite: 1..N for --shard=…/N", () => {
    const [, job] = shardJobs[0];
    const run = (job.steps ?? []).map((s) => s.run ?? "").join("\n");
    const n = Number(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.exec(run)![1]);
    expect(job.strategy?.matrix?.shard).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect((job as { strategy?: { "fail-fast"?: boolean } }).strategy?.["fail-fast"]).toBe(false);
  });

  it("the gate needs the shards, always runs, and fails unless their result is success", () => {
    const [, g] = gate!;
    const needs = Array.isArray(g.needs) ? g.needs : [g.needs];
    expect(needs).toContain(shardJobs[0][0]);
    expect(g.if).toMatch(/always\(\)/);
    const run = (g.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(run).toMatch(/test "\$SHARDS" = "success"/);
  });
});
