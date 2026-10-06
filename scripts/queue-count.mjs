#!/usr/bin/env node
/**
 * The queue's score line in docs/OPEN.md, computed from the items themselves.
 * Counted over OPEN.md AND its done archives (scripts/lib/openQueue.mjs, Q16).
 * Owner, 2026-09-23: "add it to the list count when you mark it done so we can
 * keep current track of numbers." src/test/queueItemsNameTheirGuard.test.ts
 * fails when the stored line and the items disagree.
 *
 * It also counts UNNUMBERED open lines (`- [ ] ` with no **Q<n>**): on
 * 2026-10-02 origin/main held 265 of them that no count showed. They are named
 * in the line and ratcheted by src/test/openUnnumberedRatchet.test.ts.
 *
 *   node scripts/queue-count.mjs          # print the line
 *   node scripts/queue-count.mjs --write  # rewrite it in docs/OPEN.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { foreignLines, queueText } from "./lib/openQueue.mjs";
import { nextFreeAcross, treeCollisions } from "./lib/queueAllocator.mjs";
import { sameItemHead } from "./open-renumber.mjs";

// The numbering lives in ONE allocator (scripts/lib/queueAllocator.mjs); these
// names stay importable from here for the tools and tests that already use them.
export { nextFreeId, nextFreeAcross } from "./lib/queueAllocator.mjs";

export const START = "<!-- generated: queue-count (node scripts/queue-count.mjs --write) -->";
export const END = "<!-- /generated: queue-count -->";

/** Not-done top-level checkbox lines that carry no **Q<n>** number. */
const OPEN_LINE = /^- \[[ ~]\] /;
const NUMBERED_LINE = /^- \[[ ~]\] \*\*Q\d+\b/;
export function unnumberedLines(md) {
  return md.split("\n").filter((l) => OPEN_LINE.test(l) && !NUMBERED_LINE.test(l));
}

export function queueCounts(md) {
  const ids = new Map();
  for (const m of md.matchAll(/^- \[([ x~])\] \*\*(Q\d+)\b/gm)) ids.set(m[2], m[1]);
  const states = [...ids.values()];
  return {
    total: ids.size,
    done: states.filter((s) => s === "x").length,
    partial: states.filter((s) => s === "~").length,
    open: states.filter((s) => s === " ").length,
    unnumbered: unnumberedLines(md).length,
  };
}

/** Queue numbers used by more than one item. Parallel lanes picked the same
 * next number three times on 2026-09-23, and queueCounts (keyed by number)
 * silently merged each pair, so the count under-reported too. */
export function duplicateIds(md) {
  const seen = new Map();
  for (const m of md.matchAll(/^- \[[ x~]\] \*\*(Q\d+)\b/gm)) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id).sort();
}

export function countLine(c) {
  const un = c.unnumbered ?? 0;
  return `**Queue: ${c.total} items — ${c.done} done, ${c.partial} partly done (fixed, protection pending), ${c.open} open${un ? `; plus ${un} unnumbered open line${un === 1 ? "" : "s"} still to number` : ""}.**`;
}

/** The only line the queue-count block may hold (foreignLines). */
export const COUNT_LINE_SHAPE = /^\*\*Queue: \d+ items — .*\*\*$/;

export function storedLine(md) {
  const a = md.indexOf(START), b = md.indexOf(END);
  return a >= 0 && b > a ? md.slice(a + START.length, b).trim() : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = "docs/OPEN.md";
  const md = readFileSync(path, "utf8");
  // Counts, duplicates and the next number read OPEN.md + its done archives (Q16).
  const all = queueText(".");
  const line = countLine(queueCounts(all));
  if (process.argv.includes("--write")) {
    if (storedLine(md) === null) throw new Error(`no ${START} marker in ${path}`);
    const a = md.indexOf(START), b = md.indexOf(END);
    const foreign = foreignLines(md.slice(a + START.length, b), [COUNT_LINE_SHAPE]);
    if (foreign.length) {
      console.error(`queue-count: ${foreign.length} hand-written line(s) inside the generated block in ${path}; --write would delete them. Move them outside the markers:\n${foreign.map((l) => `  ${l.slice(0, 160)}`).join("\n")}`);
      process.exit(1);
    }
    writeFileSync(path, md.slice(0, a + START.length) + "\n" + line + "\n" + md.slice(b));
  }
  console.log(line);
  const dupes = duplicateIds(all);
  if (dupes.length) { console.error(`DUPLICATE queue numbers: ${dupes.join(", ")} — run node scripts/open-renumber.mjs`); process.exitCode = 1; }
  console.log(`next free: ${nextFreeAcross(".")} (the higher of this tree and origin/main; git fetch first)`);
  // A number this branch added that main also added since, for another item
  // (bot PR #2372's Q1378-Q1380 vs main's crew Q1378-Q1380, 2026-10-05).
  const clash = treeCollisions(".", "origin/main", sameItemHead);
  if (clash?.length) {
    console.error(`COLLIDES with origin/main: ${clash.map((c) => c.id).join(", ")} — this branch and main each filed a different item under it; run node scripts/open-renumber.mjs --base origin/main`);
    process.exitCode = 1;
  }
}
