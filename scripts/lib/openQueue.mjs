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
import { execFileSync } from "node:child_process";
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

/** OPEN.md followed by every archive: the text every queue tool must read.
 * `list` names the archives; gitRefReader() supplies both for a git ref. */
export function queueText(root, read = (p) => readFileSync(join(root, p), "utf8"), list = () => archiveFiles(root)) {
  return [read(OPEN), ...list().map((p) => read(p) ?? "")].join("\n");
}

/**
 * Read the queue as it is on a git ref (origin/main), not in this working tree.
 * A checkout on a stale branch printed "111 open" at session start while
 * origin/main had 182 (2026-10-02): every status line that claims to be "the
 * queue" reads the ref. Returns { sha, read(path) -> text|null, list() -> archive paths }.
 */
export function gitRefReader(repo, ref = "origin/main") {
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  const sha = git("rev-parse", "--verify", "-q", `${ref}^{commit}`).trim();
  const read = (p) => { try { return git("show", `${sha}:${p}`); } catch { return null; } };
  const list = () => git("ls-tree", "--name-only", sha, `${ARCHIVE_DIR}/`).split("\n").map((l) => l.trim())
    .filter((l) => ARCHIVE_RE.test(l.slice(ARCHIVE_DIR.length + 1))).sort();
  return { sha, read, list };
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

/**
 * One item under two numbers (found 2026-10-03). open-renumber met the SAME
 * item twice under one number (ticked into an archive by the branch, still
 * open in OPEN.md on main), took the pair for a number collision and gave the
 * ticked copy a new number. f38b17024 made Q456 -> Q919, Q877 -> Q920,
 * Q878 -> Q921, Q897 -> Q922, Q899 -> Q923 and Q900 -> Q924: Q456 stayed open
 * while done as Q919, and five done items were counted twice.
 *
 * itemOriginKey(line) says where an item came from, so two numbers for one
 * item can be found: a feed item's "Mirrored|Filed <date> from <source>" (an
 * alert that fires again later is mirrored on a later date, a NEW item with a
 * different key), else the first 100 characters of its text, when it has at
 * least 100 (a shorter head says too little to call two items one, and a
 * prefix no longer than the shortest head keeps a DONE note appended to the
 * ticked copy out of the key).
 */
const QUEUE_HEAD = /^- \[([ x~])\] \*\*(Q\d+)\b(.*)$/;
const FEED_SOURCE = String.raw`(?:nightly-red issue #\d+|alert-ledger row [0-9a-f]{12}|audit-bus finding [A-Z]+-\d+|issue #\d+)`;
const FEED_ORIGIN = new RegExp(String.raw`\b(?:Mirrored|Filed) (\d{4}-\d{2}-\d{2}) from (${FEED_SOURCE}(?: and ${FEED_SOURCE})?)`);

/** The text of a queue head line after its number: no bold, no severity, lower case, one space. */
export function itemHeadText(line) {
  const m = QUEUE_HEAD.exec(line);
  if (!m) return null;
  return m[3].replace(/\*\*/g, "").replace(/^\s*(CRITICAL|URGENT|HIGH|MEDIUM|LOW)\b/i, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

export function itemOriginKey(line) {
  const text = itemHeadText(line);
  if (text === null) return null;
  const o = FEED_ORIGIN.exec(line);
  if (o) return `origin ${o[1]} ${o[2].toLowerCase()}`;
  return text.length >= 100 ? `text ${text.slice(0, 100)}` : null;
}

/**
 * Items that appear under two or more numbers, across the queue text
 * (queueText: OPEN.md + archives). Returns [{ key, items: [{ id, state }] }].
 */
export function duplicateItems(md) {
  const byKey = new Map();
  for (const line of md.split("\n")) {
    const m = QUEUE_HEAD.exec(line);
    if (!m) continue;
    const key = itemOriginKey(line);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, new Map());
    byKey.get(key).set(m[2], m[1]);
  }
  return [...byKey].filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => ({ key, items: [...ids].map(([id, state]) => ({ id, state })) }));
}

/**
 * Hand-written lines inside a generated block are deleted by the next refresh
 * (2026-10-03: 8f3dae96a, land.sh's refresh after a rebase, deleted the nine
 * questions held for the owner, written between the queue-count markers, and
 * the answers that came back had nowhere to land). A block writer calls this
 * first and refuses to write while the block holds a line its generator could
 * not have written. `shapes` are regexes for the lines the generator writes;
 * blank lines and HTML comments are always allowed. Returns the foreign lines.
 */
export function foreignLines(blockText, shapes) {
  return String(blockText ?? "").split("\n")
    .filter((l) => l.trim() && !isCommentLine(l) && !shapes.some((re) => re.test(l)));
}

/** One whole `<!-- ... -->` on one line (the markers). String checks, not an HTML regex. */
function isCommentLine(l) {
  const t = l.trim();
  return t.startsWith("<!--") && t.endsWith("-->");
}
