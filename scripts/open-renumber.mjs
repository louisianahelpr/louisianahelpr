#!/usr/bin/env node
/**
 * Collision-safe queue numbers, repaired at land time.
 *
 * Every lane takes "next free" from its own base, so two lanes that branch
 * from the same main file the same Q number. It happened over and over:
 * Q743 (8c8d298fa), Q904/Q905 (7c34385dc), Q909-Q914 (fdfc99a0d, 53e823a96,
 * a08fb9606) — each pair silently merged by every count keyed on the number.
 *
 * scripts/land.sh runs this right after `git rebase origin/main`: for every
 * number used by more than one item (OPEN.md + done archives), the item whose
 * head line is on the base keeps it, and the branch's item is moved to the next
 * number free on BOTH the tree and the base (queue-count nextFreeAcross). Only
 * that head line is rewritten; other mentions of the old number are listed so
 * the lane can fix them by hand. When both copies are on the base already
 * (main itself has the duplicate) nothing is moved and it exits 1.
 *
 *   node scripts/open-renumber.mjs [--base origin/main] [--dry-run]
 *
 * Guard: src/test/openRenumber.test.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPEN, archiveFiles, gitRefReader, queueText } from "./lib/openQueue.mjs";
import { nextFreeAcross } from "./queue-count.mjs";

const HEAD = /^- \[[ x~]\] \*\*(Q\d+)\b/;

/**
 * files: [{ path, text }] — OPEN.md and the archives as they are in the tree.
 * baseText: the base's queue text (its head lines decide who keeps a number).
 * nextFree: first number (integer) safe to hand out.
 * Returns { files: [{path, text}] (changed only), renames: [{from, to, path, line}], stuck: [id], mentions: [{id, path, line}] }.
 */
export function renumberPlan(files, baseText, nextFree) {
  const baseHeads = new Set(baseText.split("\n").filter((l) => HEAD.test(l)));
  const occ = new Map();
  files.forEach((f, fi) => f.text.split("\n").forEach((l, li) => {
    const m = HEAD.exec(l);
    if (m) occ.set(m[1], [...(occ.get(m[1]) ?? []), { fi, li, line: l }]);
  }));
  const lines = files.map((f) => f.text.split("\n"));
  const renames = [], stuck = [], mentions = [];
  let next = nextFree;
  for (const [id, list] of [...occ].sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))) {
    if (list.length < 2) continue;
    const onBase = list.filter((o) => baseHeads.has(o.line));
    if (onBase.length > 1) { stuck.push(id); continue; }
    const keep = onBase[0] ?? list[0];
    for (const o of list) {
      if (o === keep) continue;
      const to = `Q${next++}`;
      lines[o.fi][o.li] = lines[o.fi][o.li].replace(`**${id}`, `**${to}`);
      renames.push({ from: id, to, path: files[o.fi].path, line: o.li + 1 });
    }
    const re = new RegExp(`\\b${id}\\b`);
    lines.forEach((ls, fi) => ls.forEach((l, li) => {
      if (!HEAD.test(l) && re.test(l)) mentions.push({ id, path: files[fi].path, line: li + 1 });
    }));
  }
  const changed = files.map((f, fi) => ({ path: f.path, text: lines[fi].join("\n") })).filter((f, fi) => f.text !== files[fi].text);
  return { files: changed, renames, stuck, mentions };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(opt("root") ?? ".");
  const base = opt("base") ?? "origin/main";
  const paths = [OPEN, ...archiveFiles(root)];
  const files = paths.map((p) => ({ path: p, text: readFileSync(join(root, p), "utf8") }));
  let baseText = "";
  try { const g = gitRefReader(root, base); baseText = queueText(root, (p) => g.read(p) ?? "", g.list); }
  catch { console.error(`open-renumber: ${base} unreadable; every duplicate keeps its FIRST occurrence`); }
  const plan = renumberPlan(files, baseText, Number(nextFreeAcross(root, base).slice(1)));
  for (const r of plan.renames) console.log(`renumbered ${r.from} -> ${r.to}  (${r.path}:${r.line}; ${r.from} stays with the item already on ${base})`);
  for (const m of plan.mentions) console.log(`  check by hand: ${m.path}:${m.line} mentions ${m.id}`);
  if (!argv.includes("--dry-run")) for (const f of plan.files) writeFileSync(join(root, f.path), f.text);
  if (plan.stuck.length) { console.error(`open-renumber: ${plan.stuck.join(", ")} duplicated on ${base} itself — renumber one by hand`); process.exitCode = 1; }
  if (!plan.renames.length && !plan.stuck.length) console.log("open-renumber: no duplicate queue numbers");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
