/**
 * Q317 (docs/OPEN.md, 2026-09-23): the press-every-control matrix ran all four
 * shards against prod at once. Beside the other prod suites that took prod to
 * 56 of 60 Postgres connections (57 usable; 3 are reserved for superusers),
 * and pg_cron, which opens a fresh connection per job
 * (cron.use_background_workers = off), was refused 14 times at 19:00Z:
 * "remaining connection slots are reserved for roles with the SUPERUSER
 * attribute".
 *
 * The fix is `max-parallel: 2` on the press matrix. This guard holds it there,
 * and holds the two things that change with it:
 *   - the per-job timeout still covers one shard (its clock starts when the
 *     shard starts, not while it waits for a slot);
 *   - the clean-up job's window reaches back to the FIRST wave. Two waves take
 *     up to 2 x timeout-minutes, so the old fixed "-3 hours" missed wave one.
 *
 * @mutate .github/workflows/press-every-control.yml |       max-parallel: 2 |       max-parallel: 4
 * @mutate .github/workflows/press-every-control.yml |       max-parallel: 2 |       # max-parallel: 2
 * @mutate .github/workflows/press-every-control.yml | SINCE=$(date -u -d '-6 hours' | SINCE=$(date -u -d '-3 hours'
 * @mutate .github/workflows/press-every-control.yml | --jq .run_started_at | --jq .created_at_typo
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const FILE = resolve(__dirname, "../../.github/workflows/press-every-control.yml");
const MAX_PARALLEL_CAP = 2;

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = {
  "timeout-minutes"?: number;
  strategy?: { "max-parallel"?: number; matrix?: { shard?: unknown[] } };
  permissions?: Record<string, string>;
  steps?: Step[];
};

const wf = parse(readFileSync(FILE, "utf8")) as { jobs: Record<string, Job> };
const press = wf.jobs.press;
const shards = press.strategy?.matrix?.shard ?? [];

describe("Q317: press-every-control never floods prod's connection slots", () => {
  it("the press matrix exists and has shards (inventory floor)", () => {
    expect(press).toBeDefined();
    expect(shards.length).toBeGreaterThan(1);
  });

  it(`declares max-parallel, and it is <= ${MAX_PARALLEL_CAP}`, () => {
    const mp = press.strategy?.["max-parallel"];
    // Absent means "all shards at once" — the original bug.
    expect(mp, "press matrix has no max-parallel: every shard runs at once").toBeTypeOf("number");
    expect(mp as number).toBeGreaterThan(0);
    expect(mp as number).toBeLessThanOrEqual(MAX_PARALLEL_CAP);
  });

  it("the per-shard timeout still exceeds the sweep's own time budget", () => {
    const step = press.steps?.find((s) => s.env?.TIME_BUDGET_MIN);
    const budget = Number(step?.env?.TIME_BUDGET_MIN);
    expect(budget).toBeGreaterThan(0);
    expect(press["timeout-minutes"] ?? 0).toBeGreaterThan(budget);
  });

  it("the clean-up window reaches back to the first wave", () => {
    const mp = press.strategy?.["max-parallel"] ?? shards.length;
    const waves = Math.ceil(shards.length / mp);
    const worstCaseMin = waves * (press["timeout-minutes"] ?? 360);
    const sweep = wf.jobs.cleanup?.steps?.find((s) => s.name === "Sweep");
    expect(sweep?.run, "cleanup Sweep step not found").toBeTruthy();
    const run = sweep!.run!;
    // Primary: the run's own start time, which needs actions: read + a token.
    expect(run).toMatch(/actions\/runs\/\$GITHUB_RUN_ID"? --jq \.run_started_at/);
    expect(wf.jobs.cleanup.permissions?.actions).toBe("read");
    expect(sweep!.env?.GH_TOKEN).toBeTruthy();
    // Fallback: a fixed window at least as long as every wave together.
    const hours = [...run.matchAll(/date -u -d '-(\d+) hours'/g)].map((m) => Number(m[1]));
    expect(hours.length).toBeGreaterThan(0);
    for (const h of hours) expect(h * 60).toBeGreaterThanOrEqual(worstCaseMin);
    expect(run).toMatch(/CLEANUP_SINCE="\$SINCE"/);
  });
});
