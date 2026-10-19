/**
 * THE ONE ALLOCATOR FOR docs/OPEN.md QUEUE NUMBERS (owner, 2026-10-05).
 *
 * Every writer that mints a new `**Q<n>**` takes its numbers from here:
 * scripts/open-sync-trackers.mjs (via applyFeeds in scripts/lib/openFeeds.mjs),
 * scripts/open-renumber.mjs, and the "next free" that scripts/queue-count.mjs
 * prints for lanes filing by hand. Nothing else may do arithmetic on a Q number
 * (src/test/queueAllocatorIsTheOnlyMinter.test.ts reads every script).
 * ~/.lh-tools/open_apply_branch.py (local only, not in this repo) mints its own
 * and is outside that guard.
 *
 * The rule: next free = max(every **Q<n>** on origin/main's OPEN.md + archives,
 * every **Q<n>** in this tree's OPEN.md + archives, i.e. any number this branch
 * already uses) + 1.
 *
 * What the allocator cannot see is another UNLANDED branch. Bot PR #2372
 * (bot/refresh/open-auto-tick, 2026-10-05) minted Q1378-Q1380 for feed items
 * while main was at Q1377; a lane then landed the crew items as Q1378-Q1380.
 * branchCollisions() names exactly that: a number this branch ADDED (not on the
 * fork point) that main ALSO added since, for a different item. land.sh repairs
 * it (open-renumber.mjs); queue-count.mjs reports it; openRenumber.test.ts fails
 * on it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gitRefReader, queueText } from "./openQueue.mjs";

const ANY_Q = /\*\*Q(\d+)\b/g;
const HEAD = /^- \[[ x~]\] \*\*(Q\d+)\b/;

/** The highest **Q<n>** anywhere in `text` (0 when none). */
export function maxQ(text) {
  let max = 0;
  for (const m of (text ?? "").matchAll(ANY_Q)) max = Math.max(max, Number(m[1]));
  return max;
}

/** The next unused queue id in ONE text: take it from here, never from memory. */
export function nextFreeId(md) {
  return `Q${maxQ(md) + 1}`;
}

/** The queue text (OPEN.md + archives) as it is on a git ref; null when the ref is unreadable. */
export function refQueueText(root, ref) {
  try {
    const g = gitRefReader(root, ref);
    return queueText(root, (p) => g.read(p) ?? "", g.list);
  } catch {
    return null; // no such ref (shallow CI checkout, no remote): the caller says what it falls back to
  }
}

/**
 * The first number free on BOTH this tree (every number the branch already
 * uses) and `ref` (origin/main). Falls back to this tree alone when the ref is
 * unreadable.
 */
export function nextFreeNumber(root, ref = "origin/main") {
  const tree = maxQ(queueText(root));
  const base = refQueueText(root, ref);
  return Math.max(tree, base === null ? 0 : maxQ(base)) + 1;
}

/** nextFreeNumber as an id ("Q123"). */
export function nextFreeAcross(root, ref = "origin/main") {
  return `Q${nextFreeNumber(root, ref)}`;
}

/** Hands out ids from `start` upward, one per call: the only place a Q number is incremented. */
export function qCounter(start) {
  if (!Number.isInteger(start) || start < 1) throw new Error(`qCounter: start must be a positive integer, got ${start}`);
  let n = start;
  return () => `Q${n++}`;
}

function heads(text) {
  const out = new Map();
  for (const l of (text ?? "").split("\n")) {
    const m = HEAD.exec(l);
    if (m) out.set(m[1], [...(out.get(m[1]) ?? []), l]);
  }
  return out;
}

/**
 * Numbers this branch added that main also added since the fork, for a
 * DIFFERENT item. `sameItem(a, b)` says two head lines are one item (an item
 * that landed on both sides is not a collision); defaults to identical lines.
 * Returns [{ id, branch: [head lines], main: [head lines] }], sorted by number.
 */
export function branchCollisions({ forkText, mainText, treeText }, sameItem = (a, b) => a === b) {
  const fork = heads(forkText), main = heads(mainText), tree = heads(treeText);
  const out = [];
  for (const [id, branchLines] of tree) {
    if (fork.has(id)) continue;
    const mainLines = main.get(id);
    if (!mainLines) continue;
    const branchOnly = branchLines.filter((b) => !mainLines.some((m) => m === b || sameItem(m, b)));
    if (branchOnly.length) out.push({ id, branch: branchOnly, main: mainLines });
  }
  return out.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/**
 * branchCollisions for this tree against `ref`, using the fork point
 * (`git merge-base HEAD ref`). Returns null when the ref or the fork point is
 * unreadable (a shallow checkout): the land-time renumber still runs.
 */
export function treeCollisions(root, ref = "origin/main", sameItem) {
  let fork;
  try {
    fork = execFileSync("git", ["-C", root, "merge-base", "HEAD", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null; // no fork point to compare against
  }
  const forkText = refQueueText(root, fork);
  const mainText = refQueueText(root, ref);
  if (forkText === null || mainText === null) return null;
  return branchCollisions({ forkText, mainText, treeText: queueText(root) }, sameItem);
}

// ---- Cross-worktree reservations (q-reserve) ------------------------------
// Lanes on one Mac each read "next free" from their own, often stale, base and
// filed the same numbers (Q2154-Q2161 by three lanes at once, 2026-10-18). A
// reservation ledger OUTSIDE every worktree makes the numbers a lane claims
// visible to the others: `node scripts/queue-count.mjs --reserve <lane> <n>`.

export const RESERVATION_TTL_DAYS = 3;

/** Where reservations live: shared by every worktree on this Mac. */
export function ledgerPath() {
  return process.env.LH_Q_LEDGER || join(homedir(), ".lh-tools", "q-reservations.json");
}

/** Numbers (as integers) that appear as a head or reference on `text`. */
export function qNumbersIn(text) {
  const out = new Set();
  for (const m of (text ?? "").matchAll(ANY_Q)) out.add(Number(m[1]));
  return out;
}

/**
 * Pure core. Drops reservations that are expired or whose number now appears
 * on main (`mainNumbers`), then hands `count` numbers above max(`floor`, every
 * live reservation). Returns { entries, numbers } with the new ones appended.
 */
export function planReservation(entries, { lane, count, floor, mainNumbers = new Set(), now = Date.now(), ttlDays = RESERVATION_TTL_DAYS }) {
  if (!lane || !/^[\w.-]+$/.test(lane)) throw new Error(`reserve: lane must be a short name (letters, digits, - _ .), got ${JSON.stringify(lane)}`);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error(`reserve: count must be 1..100, got ${count}`);
  const ttl = ttlDays * 86400000;
  const live = (entries ?? []).filter((e) => Number.isInteger(e.number) && now - Date.parse(e.time) < ttl && !mainNumbers.has(e.number));
  const take = qCounter(Math.max(floor, ...live.map((e) => e.number)) + 1);
  const numbers = Array.from({ length: count }, () => Number(take().slice(1)));
  const time = new Date(now).toISOString();
  return { entries: [...live, ...numbers.map((number) => ({ number, lane, time }))], numbers };
}

/** mkdir is atomic on every filesystem: the lock is a directory next to the ledger. */
function withLedgerLock(path, fn) {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + 15000;
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > 30000) rmSync(lock, { recursive: true, force: true }); } catch { /* released between stat and rm */ }
      if (Date.now() > deadline) throw new Error(`reserve: ${lock} held for 15s; remove it if no queue-count is running`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

export function readLedger(path = ledgerPath()) {
  if (!existsSync(path)) return [];
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch { return []; /* torn or hand-edited ledger: start empty rather than block filing */ }
}

/**
 * Atomically reserve `count` numbers for `lane`, above everything on this tree,
 * origin/main and every live reservation. Returns ["Q2162", ...].
 */
export function reserveNumbers(root, lane, count, { ledger = ledgerPath(), ref = "origin/main", now = Date.now(), ttlDays } = {}) {
  const base = refQueueText(root, ref);
  const mainNumbers = qNumbersIn(base);
  const floor = nextFreeNumber(root, ref) - 1;
  return withLedgerLock(ledger, () => {
    const plan = planReservation(readLedger(ledger), { lane, count, floor, mainNumbers, now, ttlDays });
    const tmp = `${ledger}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(plan.entries, null, 2) + "\n");
    renameSync(tmp, ledger);
    return plan.numbers.map((n) => `Q${n}`);
  });
}
