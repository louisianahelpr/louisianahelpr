#!/usr/bin/env node
/**
 * The queue's score line in docs/OPEN.md, computed from the items themselves.
 * Owner, 2026-09-23: "add it to the list count when you mark it done so we can
 * keep current track of numbers." src/test/queueItemsNameTheirGuard.test.ts
 * fails when the stored line and the items disagree.
 *
 *   node scripts/queue-count.mjs          # print the line
 *   node scripts/queue-count.mjs --write  # rewrite it in docs/OPEN.md
 */
import { readFileSync, writeFileSync } from "node:fs";

export const START = "<!-- generated: queue-count (node scripts/queue-count.mjs --write) -->";
export const END = "<!-- /generated: queue-count -->";

export function queueCounts(md) {
  const ids = new Map();
  for (const m of md.matchAll(/^- \[([ x~])\] \*\*(Q\d+)\b/gm)) ids.set(m[2], m[1]);
  const states = [...ids.values()];
  return {
    total: ids.size,
    done: states.filter((s) => s === "x").length,
    partial: states.filter((s) => s === "~").length,
    open: states.filter((s) => s === " ").length,
  };
}

export function countLine(c) {
  return `**Queue: ${c.total} items — ${c.done} done, ${c.partial} partly done (fixed, protection pending), ${c.open} open.**`;
}

export function storedLine(md) {
  const a = md.indexOf(START), b = md.indexOf(END);
  return a >= 0 && b > a ? md.slice(a + START.length, b).trim() : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = "docs/OPEN.md";
  const md = readFileSync(path, "utf8");
  const line = countLine(queueCounts(md));
  if (process.argv.includes("--write")) {
    if (storedLine(md) === null) throw new Error(`no ${START} marker in ${path}`);
    const a = md.indexOf(START), b = md.indexOf(END);
    writeFileSync(path, md.slice(0, a + START.length) + "\n" + line + "\n" + md.slice(b));
  }
  console.log(line);
}
