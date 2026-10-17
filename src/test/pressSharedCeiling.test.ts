/**
 * The two shards of a press leg share ONE request ceiling, and together they
 * never pass it (lead ruling 2026-10-17, after press 39014836855 leg 6 ran out
 * of time).
 *
 * Measured from 39014836855 / 38536821617 (scripts/audit/press-row-times.mjs):
 * shard time 543.2 / 543.1 min, 314.5 / 370.6 of it waiting on the request
 * ceiling, while the shards' meters averaged 83 / 87 requests a minute: each
 * paced to a fixed half of 400 x 0.85 with a burst estimate of at least 100, so
 * any minute past ~70 requests waited for the next even with its sibling idle.
 * Now both pace against one leg meter (pressSharedCeiling.mjs, PRESS_PACE_DIR
 * from press-wave.sh). The total the leg may send is unchanged.
 *
 * This guard holds:
 *   - a sibling's count and reservation for this minute count against a shard,
 *     an earlier minute's do not;
 *   - two shard PROCESSES hammering one leg meter at once stay at or under the
 *     ceiling in every minute, and the heavy one uses more than half of it
 *     while its sibling is light (the split is gone);
 *   - the leg lock excludes: a second process waits while it is held;
 *   - the harness paces through the shared meter whenever PRESS_PACE_DIR is set,
 *     at the leg's whole ceiling, and press-wave.sh sets it per wave.
 *
 * @mutate scripts/audit/pressSharedCeiling.mjs | if (s && s.minute === minute) n += (s.used ?? 0) + (s.reserved ?? 0); | if (s && s.minute === minute) n += 0;
 * @mutate scripts/audit/pressSharedCeiling.mjs |     writeFileSync(`${file}.tmp`, JSON.stringify({ minute, used: own, reserved: go ? reserve : 0 })); |     writeFileSync(`${file}.tmp`, JSON.stringify({ minute, used: own, reserved: 0 }));
 * @mutate scripts/audit/pressSharedCeiling.mjs |       mkdirSync(lock);\n      break; |       break;
 * @mutate scripts/audit/press-wave.sh | export PRESS_PACE_DIR="${PRESS_PACE_DIR:-test-results/press-pace/$RUN_BASE-wave-$1}" | export PRESS_PACE_DIR_UNUSED=""
 * @mutate scripts/audit/press-every-control.mjs |       const legCeiling = Math.floor(LOAD_CEILING * PACE_HEADROOM); |       const legCeiling = Math.floor(LOAD_CEILING * PACE_HEADROOM * 2);
 */
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sharedCeilingDecision, siblingsUsed } from "../../scripts/audit/pressSharedCeiling.mjs";
import { blankComments } from "./helpers/blankNonCode";

const run = promisify(execFile);
const ROOT = resolve(__dirname, "../..");
const MODULE = resolve(ROOT, "scripts/audit/pressSharedCeiling.mjs");
const WORKER = resolve(ROOT, "src/test/fixtures/pressSharedCeiling/worker.mjs");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
type Decide = (o: { dir: string; shard: string; used: (m: number) => number; ceiling: number; burst: number; now?: () => number; minuteMs?: number }) => { waitMs: number; minute: number };
const decide = sharedCeilingDecision as Decide;

describe("press legs pace against one shared ceiling", () => {
  it("a sibling's count and reservation for this minute count; an earlier minute's do not", () => {
    const dir = mkdtempSync(join(tmpdir(), "press-pace-"));
    try {
      const t = 1000 * 60_000 + 5_000;
      // Shard 1 has sent 200 this minute and goes with a 100 burst: 300 of 340.
      expect(decide({ dir, shard: "1", used: () => 200, ceiling: 340, burst: 100, now: () => t }).waitMs).toBe(0);
      expect(siblingsUsed(dir, "2", 1000)).toBe(300);
      // Shard 2, nothing sent yet, cannot add another 100 on top of shard 1's 300.
      const w = decide({ dir, shard: "2", used: () => 0, ceiling: 340, burst: 100, now: () => t + 1_000 }).waitMs;
      expect(w).toBeGreaterThan(50_000);
      // A smaller burst fits beside it.
      expect(decide({ dir, shard: "2", used: () => 0, ceiling: 340, burst: 40, now: () => t + 2_000 }).waitMs).toBe(0);
      // Next minute shard 1's file is stale and counts nothing.
      expect(siblingsUsed(dir, "2", 1001)).toBe(0);
      expect(decide({ dir, shard: "2", used: () => 0, ceiling: 340, burst: 300, now: () => 1001 * 60_000 + 1 }).waitMs).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two shard processes hammering one leg meter never pass the ceiling together", async () => {
    const dir = mkdtempSync(join(tmpdir(), "press-pace-"));
    const ceiling = 60, burst = 12, minuteMs = 200, runMs = 2_400;
    try {
      const outs = ["heavy", "light"].map((n) => join(dir, `${n}.out.json`));
      await Promise.all([
        run(process.execPath, [WORKER, MODULE, join(dir, "leg"), "1", outs[0], String(ceiling), String(burst), "1", String(runMs), String(minuteMs)]),
        run(process.execPath, [WORKER, MODULE, join(dir, "leg"), "2", outs[1], String(ceiling), String(burst), "5", String(runMs), String(minuteMs)]),
      ]);
      const [heavy, light] = outs.map((o) => JSON.parse(readFileSync(o, "utf8")) as Record<string, number>);
      const minutes = new Set([...Object.keys(heavy), ...Object.keys(light)]);
      expect(minutes.size).toBeGreaterThan(5); // the run spanned many fake minutes
      for (const m of minutes) expect((heavy[m] ?? 0) + (light[m] ?? 0), `minute ${m}`).toBeLessThanOrEqual(ceiling);
      // The heavy shard takes what its light sibling leaves: more than a fixed half.
      expect(Math.max(...Object.values(heavy))).toBeGreaterThan(ceiling / 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("the leg lock excludes a second process while it is held", async () => {
    const dir = mkdtempSync(join(tmpdir(), "press-pace-"));
    try {
      const leg = join(dir, "leg");
      mkdirSync(join(leg, ".lock"), { recursive: true }); // held, fresh
      const out = join(dir, "out.json");
      const child = run(process.execPath, [WORKER, MODULE, leg, "9", out, "60", "12", "1", "300", "200"]);
      await new Promise((r) => setTimeout(r, 700));
      expect(existsSync(join(leg, "shard-9.json"))).toBe(false); // still waiting on the lock
      rmSync(join(leg, ".lock"), { recursive: true, force: true });
      await child;
      expect(existsSync(join(leg, "shard-9.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("the harness paces through the leg meter at the leg's whole ceiling, and every wave gets one", () => {
    const src = blankComments(read("scripts/audit/press-every-control.mjs"));
    expect(src).toContain('const PACE_DIR = process.env.PRESS_PACE_DIR || "";');
    const pace = src.slice(src.indexOf("const paceToCeiling = async (page) => {"), src.indexOf("cycleStartTotal = requestMeter.total;\n  };"));
    expect(pace.length).toBeGreaterThan(200);
    expect(pace).toContain("const legCeiling = Math.floor(LOAD_CEILING * PACE_HEADROOM);");
    expect(pace).toMatch(/sharedCeilingWaitMs\(\{ dir: PACE_DIR, shard: PACE_SHARD, used: \(minute\) => requestMeter\.minutes\[minute\] \?\? 0, ceiling: legCeiling, burst: cycleBurstEstimate\(recentCycles\) \}\)/);
    const wave = read("scripts/audit/press-wave.sh").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(wave).toMatch(/^export PRESS_PACE_DIR="\$\{PRESS_PACE_DIR:-test-results\/press-pace\/\$RUN_BASE-wave-\$1\}"$/m);
  });
});
