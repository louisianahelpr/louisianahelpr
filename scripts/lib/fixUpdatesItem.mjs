/**
 * Work that names an open docs/OPEN.md item updates that item in the same
 * landing (docs/OPEN.md Q1150; owner, 2026-10-03: "make sure done work is
 * ticked off ... make sure it doesn't happen again").
 *
 * Measured 2026-10-03: seven items were already fixed on main by commits that
 * named them while their lines still said `- [ ]` (e952452d7 "anon storage
 * listing errors (Q572); web social sign-in notices without a marker (Q445)"
 * left Q572 and Q445 open for a day), so the open count the owner was given
 * overstated the real work. Nothing tied a fix to its line: the commit said
 * Q572, the line was never read again.
 *
 * The rule: for every commit in a landing whose subject (or a `Fixes:` /
 * `Closes:` trailer) names Qn, if Qn is still an open item (`- [ ]` or `- [~]`)
 * in docs/OPEN.md after the landing, Qn's block must differ from what it was
 * before the landing. Ticking it `[x]` (archive-done then moves it out of
 * OPEN.md), marking it `[~]` with a done-when marker, or a dated STATUS note
 * all count. An item the landing never touched is reported.
 *
 * CLI: scripts/check-fixes-update-their-items.mjs. Guard: src/test/fixUpdatesItem.test.ts.
 */

const ITEM = /^- \[([ ~x])\] \*\*(Q\d+)\b/;
const BLOCK_END = /^(- \[|#)/;
/** A range wider than this is a bookkeeping sweep (a renumber), not a claim of work. */
export const MAX_RANGE = 60;

/**
 * Map of Qn -> { open, text } for every top-level item; a block runs to the
 * next item or heading. A number held by two items (a renumber collision)
 * keeps both: `open` while either is open, `text` is both blocks.
 */
export function itemBlocks(md) {
  const lines = (md ?? "").split("\n");
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM.exec(lines[i]);
    if (!m) continue;
    const block = [lines[i]];
    while (i + 1 < lines.length && !BLOCK_END.test(lines[i + 1])) block.push(lines[++i]);
    const text = block.join("\n").replace(/\s+/g, " ").trim();
    const prev = out.get(m[2]);
    out.set(m[2], { open: (prev?.open ?? false) || m[1] !== "x", text: prev ? `${prev.text}\n${text}` : text });
  }
  return out;
}

const RANGE = /\bQ(\d+)\s*(?:[-–—]|\.\.\.?|…)\s*Q?(\d+)\b/g;
const ONE = /\bQ(\d+)/g;

/** Every item id a line names: Q572, Q1135/Q1137, Q210b (-> Q210), Q333–Q335 (expanded). */
export function namedIn(text) {
  const ids = new Set();
  for (const m of (text ?? "").matchAll(ONE)) ids.add(`Q${Number(m[1])}`);
  for (const m of (text ?? "").matchAll(RANGE)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (hi > lo && hi - lo <= MAX_RANGE) for (let n = lo; n <= hi; n++) ids.add(`Q${n}`);
  }
  return [...ids];
}

const TRAILER = /^(?:Fixes|Closes):\s*(.+)$/gim;

/** The items a commit claims work on: its subject plus any `Fixes:` / `Closes:` trailer. */
export function claimedItems({ subject, body }) {
  const ids = new Set(namedIn(subject));
  for (const m of (body ?? "").matchAll(TRAILER)) for (const id of namedIn(m[1])) ids.add(id);
  return [...ids];
}

/**
 * The commits of one landing that name an item the landing left untouched.
 * `before` / `after` are docs/OPEN.md at the landing's merge base and head;
 * `tip` is the target branch's tip (defaults to `before`). A block counts as
 * changed by the landing only when it differs from BOTH: a branch that merged
 * main in carries main's edits to an item, and those are not this landing's.
 * Returns [{ sha, subject, id }], one row per (commit, item).
 */
export function unrecordedItems(commits, before, after, tip = before) {
  const was = itemBlocks(before);
  const onTip = itemBlocks(tip);
  const now = itemBlocks(after);
  const rows = [];
  for (const c of commits) {
    for (const id of claimedItems(c)) {
      const item = now.get(id);
      if (!item?.open) continue;
      if (was.get(id)?.text !== item.text && onTip.get(id)?.text !== item.text) continue;
      rows.push({ sha: c.sha, subject: c.subject, id });
    }
  }
  return rows;
}

/** Parse `git log --format=%H%x1f%s%x1f%b%x1f%P%x1f%ct%x1e` output (the last two fields are optional). */
export function parseCommits(raw) {
  return (raw ?? "").split("\x1e").map((r) => r.replace(/^\n+/, "")).filter(Boolean).map((r) => {
    const [sha, subject, body, parents, committed] = r.split("\x1f");
    return { sha: sha.trim(), subject: (subject ?? "").trim(), body: body ?? "", parent: (parents ?? "").trim().split(" ")[0] || null, committed: (committed ?? "").trim() };
  });
}

/**
 * Split main's first-parent history (newest first, as git log prints it) into
 * landings. land.sh merges with REBASE, and GitHub stamps every commit of one
 * rebase merge with the same committer time (measured 2026-10-03: #2186's five
 * commits all 01:34:16-05:00, #2187's three all 01:55:46), so a landing is a
 * run of consecutive commits sharing that time. Returns oldest landing first:
 * [{ base, head, commits }], `base` being the parent of its oldest commit.
 */
export function groupLandings(commits) {
  const landings = [];
  for (const c of commits) {
    const cur = landings[landings.length - 1];
    if (cur && cur.committed === c.committed) cur.commits.push(c);
    else landings.push({ committed: c.committed, commits: [c] });
  }
  return landings.reverse().map((l) => ({ base: l.commits[l.commits.length - 1].parent, head: l.commits[0].sha, commits: l.commits }));
}
