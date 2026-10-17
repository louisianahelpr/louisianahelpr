/**
 * THE TWO SHARDS OF A LEG SHARE ONE REQUEST CEILING (lead ruling 2026-10-17).
 *
 * Each shard used to pace to its own half of the ceiling (paceToCeiling with
 * PRESS_WAVE_WIDTH): 400 x 0.85 / 2 = 170 a minute, with a burst estimate of at
 * least 100, so any minute past ~70 requests waited for the next one. Measured
 * (press-every-control 39014836855 / 38536821617): the shards' meters averaged
 * 83 / 87 requests a minute and waited 314.5 / 370.6 of their 543 minutes, the
 * half a light sibling left unused going to waste. The leg's total stays the
 * same (one 400 x 0.85 ceiling for both, judged by the same budget step); only
 * the split goes.
 *
 * How (file-based, one directory per leg, PRESS_PACE_DIR from press-wave.sh):
 * before each press cycle a shard takes the leg lock (an atomic mkdir), reads
 * every other shard's state file, and goes only if this minute's combined count
 * (its own metered requests, plus each sibling's count at its last cycle start
 * and the burst that sibling reserved for that cycle) leaves room for one more
 * burst. Going, it writes its own count and reservation (write + rename, so a
 * reader never sees half a file) before letting go of the lock, so two shards
 * can never both spend the same headroom. A state file from an earlier minute
 * counts nothing. A lock left by a dead shard is broken after LOCK_STALE_MS.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOCK_STALE_MS = 10_000;
const LOCK = ".lock";
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function withLegLock(dir, fn, { staleMs = LOCK_STALE_MS, spinMs = 3 } = {}) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, LOCK);
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
      const st = statSync(lock, { throwIfNoEntry: false });
      if (st && Date.now() - st.mtimeMs > staleMs) rmSync(lock, { recursive: true, force: true }); // its owner died holding it
      else sleepSync(spinMs);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The leg's count for `minute`, every shard but `shard`. */
export function siblingsUsed(dir, shard, minute) {
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!/^shard-.+\.json$/.test(f) || f === `shard-${shard}.json`) continue;
    let s;
    try { s = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; } // mid-rename never happens; a foreign file is not a shard
    if (s && s.minute === minute) n += (s.used ?? 0) + (s.reserved ?? 0);
  }
  return n;
}

/**
 * Whether this shard may start its next press cycle now: { waitMs: 0, minute }
 * when it may (its reservation is recorded), else the ms to the next minute.
 * `used(minute)` = its own metered requests in that minute; the minute is read
 * INSIDE the lock, so a shard that queued for the lock across a minute boundary
 * judges the minute it actually goes in. Same rule as ceilingWaitMs, on the
 * leg's combined count.
 */
export function sharedCeilingDecision({ dir, shard, used, ceiling, burst, now = () => Date.now(), minuteMs = 60_000 }) {
  if (!(ceiling > 0)) return { waitMs: 0, minute: Math.floor(now() / minuteMs) };
  return withLegLock(dir, () => {
    const t = now();
    const minute = Math.floor(t / minuteMs);
    const own = used(minute);
    const total = own + siblingsUsed(dir, shard, minute);
    const reserve = Math.min(burst, ceiling);
    const go = total === 0 || total + reserve <= ceiling;
    const file = join(dir, `shard-${shard}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ minute, used: own, reserved: go ? reserve : 0 }));
    renameSync(`${file}.tmp`, file);
    return { waitMs: go ? 0 : (minute + 1) * minuteMs - t + 50, minute };
  });
}

/** The ms to wait before the next press cycle (0 = go now). */
export function sharedCeilingWaitMs(opts) {
  return sharedCeilingDecision(opts).waitMs;
}
