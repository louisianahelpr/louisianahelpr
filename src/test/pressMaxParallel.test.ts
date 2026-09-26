/**
 * Q317 (docs/OPEN.md, 2026-09-23): the press-every-control matrix ran all four
 * shards against prod at once. Beside the other prod suites that took prod to
 * 56 of 60 Postgres connections (57 usable; 3 are reserved for superusers),
 * and pg_cron, which opens a fresh connection per job
 * (cron.use_background_workers = off), was refused 14 times at 19:00Z:
 * "remaining connection slots are reserved for roles with the SUPERUSER
 * attribute".
 *
 * The first fix was `max-parallel: 2` on the press matrix. Since 2026-09-26
 * (Q326) the shards run inside ONE job that holds the shared-accounts lock, in
 * WAVES of scripts/audit/press-wave.sh; the cap is now the wave size. This
 * guard holds it there, and holds what changes with it:
 *   - every shard runs in exactly one wave, and no wave runs more than two;
 *   - the job timeout covers every wave's own time budget (each shard stops
 *     itself at TIME_BUDGET_MIN) with room for set-up and the restore;
 *   - the clean-up window starts BEFORE the first wave (recorded by the
 *     snapshot step), so rows made by wave one are the run's own too. The old
 *     fixed "-3 hours" window missed wave one.
 *
 * @mutate .github/workflows/press-every-control.yml | bash scripts/audit/press-wave.sh 1 2 | bash scripts/audit/press-wave.sh 1 2 3
 * @mutate .github/workflows/press-every-control.yml | bash scripts/audit/press-wave.sh 3 4 | bash scripts/audit/press-wave.sh 3
 * @mutate .github/workflows/press-every-control.yml |     timeout-minutes: 330 |     timeout-minutes: 200
 * @mutate .github/workflows/press-every-control.yml | echo "PRESS_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_ENV" | true
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../..");
const FILE = resolve(ROOT, ".github/workflows/press-every-control.yml");
const MAX_PARALLEL_CAP = 2;

type Step = { id?: string; name?: string; run?: string; if?: string; env?: Record<string, string> };
type Job = {
  "timeout-minutes"?: number;
  strategy?: unknown;
  env?: Record<string, string>;
  steps?: Step[];
};

const wf = parse(readFileSync(FILE, "utf8")) as { jobs: Record<string, Job> };
const press = wf.jobs.press;
const steps = press?.steps ?? [];
const waveAt = steps.map((s, i) => ({ s, i })).filter(({ s }) => /press-wave\.sh/.test(s.run ?? ""));
const waves = waveAt.map(({ s }) => (/press-wave\.sh ([\d ]+)/.exec(s.run ?? "")?.[1] ?? "").trim().split(/\s+/).map(Number));
// The shard count the wave script divides the route list by (SHARD="$n/<total>").
const total = Number(/SHARD="\$n\/(\d+)"/.exec(readFileSync(resolve(ROOT, "scripts/audit/press-wave.sh"), "utf8"))?.[1]);

describe("Q317: press-every-control never floods prod's connection slots", () => {
  it("the press job runs its shards in waves (inventory floor)", () => {
    expect(press).toBeDefined();
    expect(waves.length).toBeGreaterThan(1);
    expect(total).toBeGreaterThan(1);
  });

  it("no matrix: the shards share the one job that holds the account lock", () => {
    expect(press.strategy, "a matrix cannot hold the job-level account lock (Q326)").toBeUndefined();
  });

  it(`no wave runs more than ${MAX_PARALLEL_CAP} shards`, () => {
    for (const w of waves) expect(w.length).toBeLessThanOrEqual(MAX_PARALLEL_CAP);
  });

  it("every shard runs in exactly one wave", () => {
    const all = waves.flat().sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: total }, (_, i) => i + 1));
  });

  it("the job timeout covers every wave's time budget plus set-up and restore", () => {
    const budget = Number(press.env?.TIME_BUDGET_MIN);
    expect(budget).toBeGreaterThan(0);
    expect(press["timeout-minutes"] ?? 0).toBeGreaterThanOrEqual(waves.length * budget + 30);
    // GitHub-hosted runners stop any job at 360 minutes whatever it asks for.
    expect(press["timeout-minutes"] ?? 0).toBeLessThanOrEqual(360);
  });

  it("the clean-up window starts before the first wave", () => {
    const snapAt = steps.findIndex((s) => /PRESS_STARTED_AT=\$\(date -u/.test(s.run ?? ""));
    expect(snapAt, "no step records PRESS_STARTED_AT").toBeGreaterThanOrEqual(0);
    expect(snapAt).toBeLessThan(waveAt[0].i);
    const restoreAt = steps.findIndex((s) => /CLEANUP_SINCE="\$PRESS_STARTED_AT"/.test(s.run ?? ""));
    expect(restoreAt, "the restore does not read PRESS_STARTED_AT").toBeGreaterThan(waveAt[waveAt.length - 1].i);
    expect(steps[restoreAt].if).toBe("always()");
  });
});
