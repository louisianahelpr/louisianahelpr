#!/usr/bin/env node
/**
 * No landing may LOSE or OVERWRITE an item that is on the base (owner,
 * 2026-10-04). That day a batch merge kept the branches' new items under
 * numbers main already used for other items, and main's Q1208, Q1209 and Q1210
 * (Q454's money follow-ups) were silently replaced by unrelated text: the
 * count did not move, so nothing looked wrong. open-renumber.mjs repairs a
 * DUPLICATE number; this catches a REPLACED one.
 *
 * For every item head line on the base (docs/OPEN.md + the done archives), the
 * tree must still hold an item with that number (open or archived) whose head
 * shares enough words with the base's (word overlap >= 0.12: a tick, a status
 * suffix or a reworded title keep plenty; an unrelated item shares almost none).
 *
 *   node scripts/check-open-items-kept.mjs [--base origin/main]
 *
 * Guard: src/test/openItemsKept.test.ts. Run by scripts/land.sh.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gitRefReader, queueText } from "./lib/openQueue.mjs";

const HEAD = /^- \[[ x~]\] \*\*(Q\d+)\b/;

/** Words of a head line's text after its number (first 400 chars). */
export function headWords(line) {
  const body = line.replace(/^- \[.\] \*\*Q\d+\**/, "").slice(0, 400).toLowerCase();
  return new Set(body.match(/[a-z_][a-z0-9_.]{3,}/g) ?? []);
}

export function sameItem(a, b) {
  const A = headWords(a);
  const B = headWords(b);
  if (!A.size || !B.size) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both) >= 0.12;
}

const heads = (text) => {
  const m = new Map();
  for (const l of text.split("\n")) {
    const q = HEAD.exec(l)?.[1];
    if (q) (m.get(q) ?? m.set(q, []).get(q)).push(l);
  }
  return m;
};

/** Base items missing from the tree, or present only as a different item. */
export function lostItems(baseText, treeText) {
  const base = heads(baseText);
  const tree = heads(treeText);
  const out = [];
  for (const [q, lines] of base) {
    const now = tree.get(q);
    if (!now) out.push(`${q} is on the base and gone from the tree: ${lines[0].slice(0, 120)}`);
    // A tick may rewrite the head ("DONE <date> ..."), so a done [x] line keeps
    // its number; a REPLACEMENT shows up as a different open or partly-done item.
    else if (!now.some((t) => /^- \[x\] /.test(t)) && !lines.some((b) => now.some((t) => sameItem(b, t))))
      out.push(`${q} now names a DIFFERENT item. base: ${lines[0].slice(0, 100)} | tree: ${now[0].slice(0, 100)}`);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--base");
  const base = i >= 0 ? argv[i + 1] : "origin/main";
  const root = process.cwd();
  const ref = gitRefReader(root, base);
  const lost = lostItems(queueText(root, ref.read, ref.list), queueText(root));
  if (lost.length) {
    console.error(`land: ${lost.length} item(s) on ${base} were lost or overwritten (restore main's line; give the branch's item a new number):`);
    for (const l of lost) console.error(`  ${l}`);
    process.exit(1);
  }
  console.log(`open-items-kept: every item on ${base} is still there as itself.`);
}
