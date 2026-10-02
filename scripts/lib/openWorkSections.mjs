/**
 * docs/OPEN.md is the ONE open-work list (owner, 2026-09-27; again 2026-10-02:
 * "things are tracked in multiple places"). Any other doc may DESCRIBE open
 * work, but a section headed as open work ("Still open", "Follow-ups", "Open
 * questions", "Backlog", ...) must point at the OPEN.md item that owns it: a
 * Q number, an audit-bus id (mirrored into OPEN.md by its `feed: bus` tag) or
 * a link to docs/OPEN.md. A section that cites none of them is a second list
 * nobody counts. Guard: src/test/openWorkSectionsCiteQueue.test.ts.
 */

const HEADING = /^(#{1,6}) (.*)$/;
// Headings that announce a list of work still to do. "remaining" only with a
// work noun ("The remaining explanation" is prose); "not done" only as "not
// done yet"/"not yet done" ("A fix is not done until..." is a rule); "pending"
// not as part of a route or word ("/signup-pending").
export const OPEN_WORK_HEADING =
  /\b(next steps?|still open|remaining (work|items|steps|issues|gaps)|left to do|not done yet|not yet done|follow-?ups?|to-?do|open (items|work|questions|issues)|outstanding|backlog|unresolved)\b|(?<![\w/-])pending\b/i;
// What counts as a pointer into the one list.
export const QUEUE_REF = /\bQ\d+\b|\b[A-Z]{2,}-\d{2,}\b|OPEN\.md/;
// A section whose heading says it is closed is a record, not a list.
const RESOLVED = /\(resolved\b/i;

/**
 * Open-work sections of one markdown text that cite nothing in the queue.
 * Returns [{ line, heading }] (1-based line of the heading).
 */
export function uncitedOpenSections(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING.exec(lines[i]);
    if (!m || !OPEN_WORK_HEADING.test(m[2]) || RESOLVED.test(m[2])) continue;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const h = HEADING.exec(lines[j]);
      if (h && h[1].length <= m[1].length) break;
    }
    const section = lines.slice(i, j).join("\n");
    if (!QUEUE_REF.test(section)) out.push({ line: i + 1, heading: lines[i] });
  }
  return out;
}
