/**
 * The queue is docs/OPEN.md PLUS its done-item archives (docs/OPEN.md Q16).
 *
 * OPEN.md is the one open-work list, and it had become unreadable: 2,982 lines
 * on 2026-09-26, 259 of its top-level items already ticked [x]. Done items are
 * therefore moved, verbatim, to a dated archive (docs/archive/OPEN-done-YYYY-MM.md)
 * by scripts/archive-done.mjs, which `npm run inventories:refresh` runs and
 * check:generated re-runs on every push (so an [x] left in OPEN.md fails CI
 * until it is archived). Nothing is deleted, and every tool that counts or
 * checks the queue reads BOTH files through queueText(): the score line and the
 * next free number (scripts/queue-count.mjs), the Everything-open block
 * (scripts/scoreboard.mjs), and the guard that every done item names its guard
 * (src/test/queueItemsNameTheirGuard.test.ts). Guard: src/test/openQueueArchive.test.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const OPEN = "docs/OPEN.md";
export const ARCHIVE_DIR = "docs/archive";
export const ARCHIVE_RE = /^OPEN-done-\d{4}-\d{2}\.md$/;

/** The dated archive a run on `date` (YYYY-MM-DD) appends to. */
export const archivePathFor = (date) => `${ARCHIVE_DIR}/OPEN-done-${date.slice(0, 7)}.md`;

/** Every done-item archive, oldest first, as repo-relative paths. */
export function archiveFiles(root) {
  let names = [];
  try { names = readdirSync(join(root, ARCHIVE_DIR)); } catch { /* no archive dir yet */ }
  return names.filter((n) => ARCHIVE_RE.test(n)).sort().map((n) => `${ARCHIVE_DIR}/${n}`);
}

/** OPEN.md followed by every archive: the text every queue tool must read. */
export function queueText(root, read = (p) => readFileSync(join(root, p), "utf8")) {
  return [read(OPEN), ...archiveFiles(root).map((p) => read(p))].join("\n");
}

const HEADING = /^#{1,6} /;
const DONE = /^- \[x\] /;

/**
 * Split OPEN.md into what stays and the done blocks that move. A block is a
 * top-level `- [x] ` line plus the indented, non-blank lines under it (measured
 * 2026-09-26: no done item continues past a blank line or an unindented line).
 * Each block carries the heading it sat under.
 */
export function splitDone(md) {
  const lines = md.split("\n");
  const kept = [];
  const moved = [];
  let heading = "(top of file)";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (HEADING.test(l)) heading = l.replace(HEADING, "").trim();
    if (!DONE.test(l)) { kept.push(l); continue; }
    const block = [l];
    while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) block.push(lines[++i]);
    moved.push({ heading, text: block.join("\n") });
  }
  return { kept: kept.join("\n"), moved };
}

export function archiveHeader(month) {
  return [
    `# Done queue items — archived from docs/OPEN.md (${month})`,
    "",
    "Historical record, not a work list. Every item here was ticked [x] in",
    "docs/OPEN.md and was moved verbatim by `node scripts/archive-done.mjs --write`",
    "(run by `npm run inventories:refresh`; docs/OPEN.md Q16). The queue tools still",
    "read this file with docs/OPEN.md: the score line and next free number",
    "(scripts/queue-count.mjs), the Everything-open block (scripts/scoreboard.mjs)",
    "and src/test/queueItemsNameTheirGuard.test.ts. To REOPEN an item, move its",
    "block back into docs/OPEN.md and untick it (a number in both files fails the",
    "duplicate-number check).",
    "",
  ].join("\n");
}

/** The archive text after appending `moved`, grouped by source heading, under a dated section. */
export function appendToArchive(existing, moved, date) {
  if (!moved.length) return existing;
  let out = existing && existing.trim() ? existing.replace(/\n*$/, "\n") : archiveHeader(date.slice(0, 7));
  let last = null;
  for (const m of moved) {
    if (m.heading !== last) {
      out += `\n## Archived ${date} — from "${m.heading}"\n\n`;
      last = m.heading;
    }
    out += m.text + "\n";
  }
  return out;
}
