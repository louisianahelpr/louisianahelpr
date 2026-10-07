#!/usr/bin/env node
/**
 * Item-level three-way merge of the queue files (docs/OPEN.md and
 * docs/archive/OPEN-done-*.md), for a rebase that stopped on them.
 *
 * WHY. Every landing files, notes or ticks items, and with seven lanes landing
 * at once (2026-10-07) every land.sh rebase stopped on these files and looped.
 * Git merges lines; the file's unit is the item. The rules below are what the
 * lead did by hand each time (~/.lh-tools/lead/resolve_open.py), written down.
 *
 * Sides, as git names them during a rebase: base = stage 1 (the replayed
 * commit's parent), ours = stage 2 (main plus what is already replayed),
 * theirs = stage 3 (the commit being replayed). An "item" is a top-level
 * `- [ ] / [~] / [x] **Q123` line.
 *
 *   - Lines that are not items merge as lines (git merge-file). Where both
 *     sides changed the same lines, BOTH are kept: ours, then the lines
 *     theirs added (a generated block is rewritten by the refresh anyway).
 *   - An item only one side changed takes that side's line.
 *   - An item BOTH sides changed: ours' line, with the status the further on
 *     ([x] over [~] over [ ]), and the text theirs added to it appended.
 *   - An item one side deleted (ticked into the archive) stays deleted: a
 *     tick wins. Text the other side added to it is returned as an archive
 *     note, which the caller appends to the archived line.
 *   - Items both sides added are all kept (a number used twice is moved by
 *     scripts/open-renumber.mjs, which land.sh runs right after the rebase).
 *   - The generated queue-count line keeps ours (the refresh rewrites it).
 * It returns null only when the input is not a queue file it can read.
 *
 *   node scripts/lib/openItemMerge.mjs [file]   # during a stopped rebase; exit 0 = resolved and written
 *
 * Guards: src/test/openItemMerge.test.ts, src/test/landRebaseResolve.test.ts.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ITEM = /^- \[([ x~.])\] \*\*(Q\d+)\b/;
const QUEUE_COUNT = /^\*\*Queue: \d+ items/;
const PH_ITEM = "@@lh-open-item@@ "; // plain text: git merge-file treats a NUL as binary
const PH_COUNT = "@@lh-open-count@@";
/** How far on a status is: a tick wins, then partly done, then open. */
const RANK = { x: 3, "~": 2, ".": 1, " ": 0 };

/**
 * An item that base has is keyed by its number on every side; one base does
 * not have is keyed by its whole line, so two different items that both sides
 * filed under one number stay two items (open-renumber moves one), and the
 * same line filed twice stays one.
 */
function scan(text, baseQs = null) {
  const lines = text.split("\n");
  const items = new Map();
  let count = null;
  const ph = lines.map((line) => {
    const m = ITEM.exec(line);
    if (m) {
      let key = baseQs === null || baseQs.has(m[2]) ? m[2] : `new ${line}`;
      // the same number twice on one side: keep both, keyed apart
      for (let n = 2; items.has(key); n++) key = `${m[2]}#${n}`;
      items.set(key, line);
      return PH_ITEM + key;
    }
    if (QUEUE_COUNT.test(line)) {
      count = line;
      return PH_COUNT;
    }
    return line;
  });
  return { items, count, ph: ph.join("\n") };
}

/** The text `after` inserted into `before` (common prefix and suffix removed). */
export function insertedText(before, after) {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return after.slice(p, after.length - s).trim();
}

/** Both sides changed one item: ours' text, the further status, theirs' additions appended. */
export function mergeItemLine(base, ours, theirs) {
  const so = ITEM.exec(ours)[1];
  const st = ITEM.exec(theirs)[1];
  let line = ours;
  if (RANK[st] > RANK[so]) line = line.replace(/^- \[[ x~.]\]/, `- [${st}]`);
  // theirs' new text, measured against base with the status box ignored
  const body = (l) => l.replace(/^- \[[ x~.]\] /, "");
  const added = insertedText(body(base ?? ""), body(theirs));
  if (added && !line.includes(added)) line = `${line.replace(/\s+$/, "")} ${added}`;
  return line;
}

/** git merge-file on the placeholder texts; conflicts resolved as ours + what theirs added. */
function mergeLines(base, ours, theirs) {
  const dir = mkdtempSync(join(tmpdir(), "open-merge-"));
  try {
    const [b, o, t] = ["base", "ours", "theirs"].map((n) => join(dir, n));
    writeFileSync(b, base);
    writeFileSync(o, ours);
    writeFileSync(t, theirs);
    let out;
    try {
      out = execFileSync("git", ["merge-file", "-p", "--diff3", o, b, t], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    } catch (e) {
      // exit status = number of conflicts; the merged text is still on stdout
      if (typeof e.status === "number" && e.status > 0 && typeof e.stdout === "string") out = e.stdout;
      else throw e;
    }
    const lines = out.split("\n");
    const res = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("<<<<<<< ")) {
        res.push(lines[i]);
        continue;
      }
      const sec = { ours: [], base: [], theirs: [] };
      let cur = "ours";
      for (i++; i < lines.length && !lines[i].startsWith(">>>>>>> "); i++) {
        if (lines[i].startsWith("||||||| ")) cur = "base";
        else if (lines[i] === "=======") cur = "theirs";
        else sec[cur].push(lines[i]);
      }
      const keep = new Set(sec.ours);
      const gone = new Set(sec.base);
      res.push(...sec.ours, ...sec.theirs.filter((l) => !keep.has(l) && (!gone.has(l) || l.trim() === "")));
    }
    return res.join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {{ base: string, ours: string, theirs: string }} sides the three file texts
 * @returns {{ text: string, archiveNotes: { q: string, note: string }[] } | null}
 */
export function mergeQueueText({ base, ours, theirs }) {
  const B = scan(base);
  const baseQs = new Set([...B.items.keys()].filter((k) => /^Q\d+$/.test(k)));
  const O = scan(ours, baseQs), T = scan(theirs, baseQs);
  if (!O.items.size && !T.items.size) return null;
  const merged = mergeLines(B.ph, O.ph, T.ph).split("\n");
  const archiveNotes = [];
  const seen = new Set();
  const out = [];
  for (const line of merged) {
    if (line === PH_COUNT) {
      out.push(O.count ?? T.count ?? "");
      continue;
    }
    if (!line.startsWith(PH_ITEM)) {
      out.push(line);
      continue;
    }
    const key = line.slice(PH_ITEM.length);
    if (seen.has(key)) continue;
    seen.add(key);
    const b = B.items.get(key), o = O.items.get(key), t = T.items.get(key);
    if (b !== undefined && (o === undefined || t === undefined)) {
      // one side ticked it away: the tick wins; the other side's addition goes to the archive
      const kept = o ?? t;
      const note = kept !== undefined && kept !== b ? insertedText(b, kept) : "";
      if (note) archiveNotes.push({ q: key.replace(/#\d+$/, ""), note });
      continue;
    }
    if (o === undefined) out.push(t);
    else if (t === undefined || t === b || o === t) out.push(o);
    else if (o === b) out.push(t);
    else out.push(mergeItemLine(b, o, t));
  }
  // An item the line merge dropped because one side deleted it (a tick): if the
  // other side had added to it, that addition goes to the archive too.
  for (const [key, b] of B.items) {
    if (seen.has(key)) continue;
    const o = O.items.get(key), t = T.items.get(key);
    if ((o === undefined) === (t === undefined)) continue;
    const kept = o ?? t;
    const note = kept !== b ? insertedText(b, kept) : "";
    if (note) archiveNotes.push({ q: key.replace(/#\d+$/, ""), note });
  }
  return { text: out.join("\n"), archiveNotes };
}

/** Back-compat name (land.sh before 2026-10-07): the merged text, or null. */
export function mergeOpenItems(sides) {
  return mergeQueueText(sides)?.text ?? null;
}

/** Append each note to its archived item line; returns the notes it could not place. */
export function appendArchiveNotes(archiveText, notes) {
  const lines = archiveText.split("\n");
  const unplaced = [];
  for (const { q, note } of notes) {
    const i = lines.findIndex((l) => new RegExp(`^- \\[x\\] \\*\\*${q}\\b`).test(l));
    if (i === -1) unplaced.push({ q, note });
    else if (!lines[i].includes(note)) lines[i] = `${lines[i].replace(/\s+$/, "")} ${note}`;
  }
  return { text: lines.join("\n"), unplaced };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const file = process.argv[2] ?? "docs/OPEN.md";
  const show = (stage) => {
    try {
      return execFileSync("git", ["show", `:${stage}:${file}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    } catch {
      return ""; // a side that has no such file (added on one side only)
    }
  };
  const r = mergeQueueText({ base: show(1), ours: show(2), theirs: show(3) });
  if (r === null) {
    console.error(`openItemMerge: ${file} is not a queue file this can merge; resolve it by hand`);
    process.exit(1);
  }
  writeFileSync(file, r.text);
  if (r.archiveNotes.length) writeFileSync(`${file}.archive-notes.json`, JSON.stringify(r.archiveNotes));
  console.log(`openItemMerge: ${file} merged item by item${r.archiveNotes.length ? ` (${r.archiveNotes.length} note(s) for archived items)` : ""}`);
}
