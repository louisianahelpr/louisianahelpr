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
import { gitRefReader, queueText } from "./lib/openQueue.mjs";

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

/** The next unused queue number: take it from here, never from memory. */
export function nextFreeId(md) {
  let max = 0;
  for (const m of md.matchAll(/\*\*Q(\d+)\b/g)) max = Math.max(max, Number(m[1]));
  return `Q${max + 1}`;
}

/**
 * The next number free on BOTH this tree and origin/main. A branch that numbers
 * from its own base collides with whatever main filed since (Q904/Q905,
 * Q909-Q914, 2026-09-30..10-01); scripts/open-renumber.mjs repairs any that
 * still slip through, at land time. Falls back to this tree when the ref is
 * unreadable.
 */
export function nextFreeAcross(root, ref = "origin/main") {
  let best = Number(nextFreeId(queueText(root)).slice(1));
  try {
    const g = gitRefReader(root, ref);
    best = Math.max(best, Number(nextFreeId(queueText(root, (p) => g.read(p) ?? "", g.list)).slice(1)));
  } catch { /* no ref: this tree's number */ }
  return `Q${best}`;
}

export function countLine(c) {
  const un = c.unnumbered ?? 0;
  return `**Queue: ${c.total} items — ${c.done} done, ${c.partial} partly done (fixed, protection pending), ${c.open} open${un ? `; plus ${un} unnumbered open line${un === 1 ? "" : "s"} still to number` : ""}.**`;
}

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
    writeFileSync(path, md.slice(0, a + START.length) + "\n" + line + "\n" + md.slice(b));
  }
  console.log(line);
  const dupes = duplicateIds(all);
  if (dupes.length) { console.error(`DUPLICATE queue numbers: ${dupes.join(", ")} — run node scripts/open-renumber.mjs`); process.exitCode = 1; }
  console.log(`next free: ${nextFreeAcross(".")} (the higher of this tree and origin/main; git fetch first)`);
}
