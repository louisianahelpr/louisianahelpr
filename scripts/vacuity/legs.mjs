/**
 * Q1270 (2026-10-07): the Playwright registrations run in LEGS that each hold
 * the shared-account lock under an hour (sharedAccountLockJobsAreShort).
 *
 * Measured: the full e2e set is 99 registrations over 76 guards, and vacuity
 * 37288574126 took 77.6 min for 10 of them (a guard's baseline ~5 min, a
 * mutated run 44 s to 13 min). The weekly full set is therefore hours, not
 * the 157 min once estimated, and no locked job of 60 minutes can hold it.
 *
 * So a leg is RESUMABLE, not a fixed shard (nothing measured says what each
 * registration costs): it skips what earlier legs already ran (`--done`),
 * runs whole guard groups until its time budget is spent (`--budget-min`),
 * and hands the cumulative list to the next leg (`--done-out`). The last leg
 * (`--last-leg`) fails if anything is still left, so a set too big for its
 * legs is red, never a quiet partial pass.
 *
 * Guard: src/test/vacuityLegs.test.ts.
 */
import fs from "node:fs";

/** One registration's identity, the same key index.mjs uses for survivors. */
export const mutationKey = (m) => `${m.guard}|${m.target}|${m.find}`;

/** The scoped registrations no earlier leg has run, in their original order. */
export function remainingAfter(scoped, doneKeys) {
  const done = new Set(doneKeys);
  return scoped.filter((m) => !done.has(mutationKey(m)));
}

/** Registrations grouped by guard (a guard's baseline is paid once per group), first-seen order. */
export function groupByGuard(list) {
  const by = new Map();
  for (const m of list) {
    if (!by.has(m.guard)) by.set(m.guard, []);
    by.get(m.guard).push(m);
  }
  return [...by.values()];
}

/**
 * The weekly run's share of the e2e set (Q1270). A scheduled run waits in the
 * prod-load FIFO and every later cron waits behind it, so it gets the Sunday
 * window before db-drift (5 legs), not the whole day; the set is cut into `k`
 * slices of similar size that rotate by ISO week, so each registration is
 * proven every `k` weeks. Guards stay whole (one baseline each); the biggest
 * group goes to the lightest slice first, ties to the lowest index.
 */
export function sliceOf(list, i, k) {
  if (!(Number.isInteger(k) && k > 0 && Number.isInteger(i) && i >= 0 && i < k)) throw new Error(`--slice ${i}/${k}: want i/k with 0 <= i < k`);
  const groups = groupByGuard(list).sort((a, b) => b.length - a.length || (a[0].guard < b[0].guard ? -1 : 1));
  const load = Array(k).fill(0);
  const mine = new Set();
  for (const g of groups) {
    const to = load.indexOf(Math.min(...load));
    load[to] += g.length;
    if (to === i) mine.add(g[0].guard);
  }
  return list.filter((m) => mine.has(m.guard));
}

/** "2/4" -> { i: 2, k: 4 }; anything else throws. */
export function parseSlice(text) {
  const m = /^(\d+)\/(\d+)$/.exec(String(text ?? ""));
  if (!m) throw new Error(`--slice ${text}: want i/k, e.g. 2/4`);
  return { i: Number(m[1]), k: Number(m[2]) };
}

export const NOT_REACHED = "not-reached";
const NOT_REACHED_WHY = "this leg's time budget was spent; the next leg runs it";

/**
 * Run whole guard groups until `deadline`. A group that starts before the
 * deadline runs its baseline; `run` (runMutations) marks any of its
 * mutations past the deadline NOT_REACHED. Groups not started are NOT_REACHED.
 */
export function runWithinBudget(list, { deadline, run, onResult, now = Date.now }) {
  const results = [];
  const groups = groupByGuard(list);
  for (let i = 0; i < groups.length; i++) {
    if (now() >= deadline) {
      for (const m of groups.slice(i).flat()) {
        results.push({ ...m, verdict: NOT_REACHED, why: NOT_REACHED_WHY });
        onResult?.(results.at(-1));
      }
      break;
    }
    results.push(...run(groups[i], { onResult, deadline }));
  }
  return results;
}

/** Should runMutations stop before this mutation? */
export const pastDeadline = (deadline, now = Date.now) => typeof deadline === "number" && now() >= deadline;
export const notReached = (m) => ({ ...m, verdict: NOT_REACHED, why: NOT_REACHED_WHY });

/**
 * The previous leg's list. Fail closed: a leg told to resume from a list that
 * is not there would re-run (or, worse, skip) work it cannot see.
 */
export function readDone(file) {
  if (!fs.existsSync(file)) throw new Error(`--done ${file}: the previous leg's list is missing`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.done)) throw new Error(`--done ${file}: no "done" array`);
  return parsed.done;
}

/** The cumulative list for the next leg: everything earlier legs ran plus what this one ran. */
export function nextDone(doneBefore, results) {
  const ran = results.filter((r) => r.verdict !== NOT_REACHED).map(mutationKey);
  return [...new Set([...doneBefore, ...ran])];
}

/**
 * dist/ as the preview serves it. A baseline (and a mutation whose target is
 * not bundle-affecting) must see the CLEAN bundle; a bundle-affecting
 * mutation rebuilds dist/ from mutated source and leaves it dirty after the
 * source is restored. Before this, the next guard's baseline or a non-bundle
 * mutation after a rebuilt one ran against the previous mutation's bundle.
 * The clean build is copied aside once per process and copied back, instead
 * of rebuilding (~60-90 s) for every guard group.
 */
export function makeDistKeeper({ dist, snapshot, build, fsx = fs }) {
  let state = "unknown"; // unknown -> clean <-> mutated
  return {
    clean() {
      if (state === "clean") return { ok: true, out: "" };
      if (state === "mutated" && fsx.existsSync(snapshot)) {
        fsx.rmSync(dist, { recursive: true, force: true });
        fsx.cpSync(snapshot, dist, { recursive: true });
        state = "clean";
        return { ok: true, out: "dist/ restored from the clean build" };
      }
      const b = build();
      if (!b.ok) {
        state = "unknown";
        return b;
      }
      fsx.rmSync(snapshot, { recursive: true, force: true });
      fsx.cpSync(dist, snapshot, { recursive: true });
      state = "clean";
      return b;
    },
    mutated() {
      state = "mutated";
    },
    get state() {
      return state;
    },
  };
}
