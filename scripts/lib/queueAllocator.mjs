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
