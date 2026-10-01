/**
 * Q317 (docs/OPEN.md, 2026-09-23): the press-every-control matrix ran all four
 * shards against prod at once. Beside the other prod suites that took prod to
 * 56 of 60 Postgres connections (57 usable; 3 are reserved for superusers),
 * and pg_cron, which opens a fresh connection per job
 * (cron.use_background_workers = off), was refused 14 times at 19:00Z:
 * "remaining connection slots are reserved for roles with the SUPERUSER
 * attribute".
 *
 * The first fix was `max-parallel: 2` on the press matrix. From 2026-09-26
 * (Q326) the shards ran inside ONE job that held the shared-accounts lock, in
 * WAVES of scripts/audit/press-wave.sh; that job held the lock for up to 330
 * minutes. Since 2026-10-01 each wave is its own LEG job (press-1..press-N),
 * each taking the lock for under an hour (sharedAccountLockJobsAreShort). The
 * cap is still the wave size. This guard holds it there, and holds what
 * changes with it:
 *   - every shard runs in exactly one leg, and no leg runs more than two;
 *   - each leg's timeout covers its own time budget (each shard stops itself
 *     at TIME_BUDGET_MIN) with room for set-up and the restore, and stays
 *     within the 60-minute lock cap;
 *   - each leg's clean-up window starts BEFORE its wave (recorded by its own
 *     snapshot step), and its restore runs always() after the wave, so every
 *     leg restores and sweeps its own rows.
 *
 * @mutate .github/workflows/press-every-control.yml | bash scripts/audit/press-wave.sh 1 2 | bash scripts/audit/press-wave.sh 1 2 3
 * @mutate .github/workflows/press-every-control.yml | bash scripts/audit/press-wave.sh 3 4 | bash scripts/audit/press-wave.sh 3
 * @mutate .github/workflows/press-every-control.yml |     timeout-minutes: 57 # press leg 2 |     timeout-minutes: 40 # press leg 2
 * @mutate .github/workflows/press-every-control.yml | echo "PRESS_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_ENV" # leg 3 | true
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../..");
const FILE = resolve(ROOT, ".github/workflows/press-every-control.yml");
const MAX_PARALLEL_CAP = 2;
const LOCK_CAP_MIN = 60;

type Step = { id?: string; name?: string; run?: string; if?: string; env?: Record<string, string> };
type Job = {
  "timeout-minutes"?: number;
  strategy?: unknown;
  env?: Record<string, string>;
  steps?: Step[];
};

const wf = parse(readFileSync(FILE, "utf8")) as { jobs: Record<string, Job> };
const legs = Object.entries(wf.jobs)
  .filter(([, j]) => (j.steps ?? []).some((s) => /press-wave\.sh/.test(s.run ?? "")))
  .map(([key, job]) => {
    const steps = job.steps ?? [];
    const waveAt = steps.map((s, i) => ({ s, i })).filter(({ s }) => /press-wave\.sh/.test(s.run ?? ""));
    const waves = waveAt.map(({ s }) =>
      (/press-wave\.sh ([\d ]+)/.exec(s.run ?? "")?.[1] ?? "").trim().split(/\s+/).map(Number),
    );
    return { key, job, steps, waveAt, waves };
  });
// The shard count the wave script divides the route list by (SHARD="$n/<total>").
const total = Number(/SHARD="\$n\/(\d+)"/.exec(readFileSync(resolve(ROOT, "scripts/audit/press-wave.sh"), "utf8"))?.[1]);

describe("Q317: press-every-control never floods prod's connection slots", () => {
  it("the shards run in leg jobs (inventory floor)", () => {
    expect(legs.length).toBeGreaterThan(1);
    expect(total).toBeGreaterThan(1);
  });

  it("no matrix: each leg is its own job holding the account lock", () => {
    for (const l of legs) expect(l.job.strategy, `${l.key}: a matrix cannot hold the job-level account lock (Q326)`).toBeUndefined();
  });

  it(`each leg runs one wave of no more than ${MAX_PARALLEL_CAP} shards`, () => {
    for (const l of legs) {
      expect(l.waves, l.key).toHaveLength(1);
      expect(l.waves[0].length, l.key).toBeLessThanOrEqual(MAX_PARALLEL_CAP);
    }
  });

  it("every shard runs in exactly one leg", () => {
    const all = legs.flatMap((l) => l.waves.flat()).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: total }, (_, i) => i + 1));
  });

  it(`each leg's timeout covers its time budget plus set-up and restore, within the ${LOCK_CAP_MIN}-minute lock cap`, () => {
    for (const l of legs) {
      const budget = Number(l.job.env?.TIME_BUDGET_MIN);
      expect(budget, l.key).toBeGreaterThan(0);
      expect(l.job["timeout-minutes"] ?? 0, l.key).toBeGreaterThanOrEqual(budget + 10);
      expect(l.job["timeout-minutes"] ?? Infinity, l.key).toBeLessThanOrEqual(LOCK_CAP_MIN);
    }
  });

  it("each leg's clean-up window starts before its wave, and its restore always runs after it", () => {
    for (const l of legs) {
      const snapAt = l.steps.findIndex((s) => /PRESS_STARTED_AT=\$\(date -u/.test(s.run ?? ""));
      expect(snapAt, `${l.key}: no step records PRESS_STARTED_AT`).toBeGreaterThanOrEqual(0);
      expect(snapAt, l.key).toBeLessThan(l.waveAt[0].i);
      const restoreAt = l.steps.findIndex((s) => /CLEANUP_SINCE="\$PRESS_STARTED_AT"/.test(s.run ?? ""));
      expect(restoreAt, `${l.key}: the restore does not read PRESS_STARTED_AT`).toBeGreaterThan(l.waveAt[l.waveAt.length - 1].i);
      expect(l.steps[restoreAt].if, l.key).toBe("always()");
    }
  });
});
