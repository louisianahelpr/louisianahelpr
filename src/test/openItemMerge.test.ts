// @mutate scripts/lib/openItemMerge.mjs |   if (RANK[st] > RANK[so]) line = | if (false) line =
// @mutate scripts/lib/openItemMerge.mjs |   if (added && !line.includes(added)) line = | if (false) line =
// @mutate scripts/lib/openItemMerge.mjs |     if (note) archiveNotes.push({ q: key.replace(/#\d+$/, ""), note });\n  }\n  return { text | \n  }\n  return { text
// @mutate scripts/lib/openItemMerge.mjs |       res.push(...sec.ours, ...sec.theirs.filter( |       res.push(...sec.ours, ...[].filter(
// @mutate scripts/lib/openItemMerge.mjs |       let key = baseQs === null \|\| baseQs.has(m[2]) ? m[2] : `new ${line}`; |       let key = m[2];
/*
 * GUARD: a land.sh rebase that stops on docs/OPEN.md (or an archive file) is
 * merged item by item, keeping both sides (scripts/lib/openItemMerge.mjs).
 *
 * 2026-10-03: five land.sh runs stopped on OPEN.md in one evening. 2026-10-07:
 * with seven lanes landing, every rebase stopped on it, often on an item BOTH
 * sides had noted or ticked, which the first version left for a person and so
 * looped. The rules below are the lead's hand resolution
 * (~/.lh-tools/lead/resolve_open.py), written down.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs module, no declaration file
import { mergeOpenItems, mergeQueueText, appendArchiveNotes } from "../../scripts/lib/openItemMerge.mjs";

const doc = (...lines: string[]) => ["# OPEN", "", "**Queue: 3 items — 1 done, 0 partly done (fixed, protection pending), 2 open.**", "", ...lines, "", "## Archive", ""].join("\n");
const A = "- [ ] **Q1 LOW alpha**";
const B = "- [ ] **Q2 MEDIUM beta**";

describe("OPEN.md rebase conflicts merge item by item (land.sh)", () => {
  it("takes the branch's edit of an item main left alone, and keeps main's own edits", () => {
    const base = doc(A, B);
    const ours = doc(A, B + " main note");
    const theirs = doc(A + " branch note", B);
    expect(mergeOpenItems({ base, ours, theirs })).toBe(doc(A + " branch note", B + " main note"));
  });

  it("keeps both sides' new items (main's first)", () => {
    const base = doc(A, B);
    const ours = doc(A, B, "- [ ] **Q3 LOW main's new one**");
    const theirs = doc(A, B, "- [ ] **Q4 LOW branch's new one**");
    expect(mergeOpenItems({ base, ours, theirs })).toBe(doc(A, B, "- [ ] **Q3 LOW main's new one**", "- [ ] **Q4 LOW branch's new one**"));
  });

  it("two different items filed under one number are both kept (open-renumber moves one)", () => {
    const m = "- [ ] **Q7 LOW main's Q7**";
    const t = "- [ ] **Q7 LOW branch's Q7**";
    expect(mergeOpenItems({ base: doc(A), ours: doc(A, m), theirs: doc(A, t) })).toBe(doc(A, m, t));
  });

  it("keeps an item's indented continuation lines with it", () => {
    const cont = "  **STATUS 2026-10-03:** continued";
    const base = doc(A, B);
    const ours = doc(A, B, cont);
    const theirs = doc(A, B, "- [ ] **Q5 LOW new**");
    expect(mergeOpenItems({ base, ours, theirs })).toBe(doc(A, B, cont, "- [ ] **Q5 LOW new**"));
  });

  it("deletes an item the branch ticked away, if main left it alone", () => {
    expect(mergeOpenItems({ base: doc(A, B), ours: doc(A, B), theirs: doc(B) })).toBe(doc(B));
  });

  it("an item BOTH sides changed: main's text, the further status, the branch's note appended", () => {
    const ours = A + " **STATUS:** main's note";
    const theirs = "- [x] **Q1 LOW alpha** **DONE:** branch fixed it";
    expect(mergeOpenItems({ base: doc(A, B), ours: doc(ours, B), theirs: doc(theirs, B) })).toBe(
      doc("- [x] **Q1 LOW alpha** **STATUS:** main's note **DONE:** branch fixed it", B),
    );
    // a [~] on main is not undone by an open [ ] on the branch
    const r = mergeOpenItems({ base: doc(A), ours: doc("- [~] **Q1 LOW alpha** built"), theirs: doc(A + " note") });
    expect(r).toBe(doc("- [~] **Q1 LOW alpha** built note"));
  });

  it("a tick wins: main ticked an item away while the branch noted it; the note goes to the archive", () => {
    const r = mergeQueueText({ base: doc(A, B), ours: doc(B), theirs: doc(A + " **NOTE:** late", B) });
    expect(r.text).toBe(doc(B));
    expect(r.archiveNotes).toEqual([{ q: "Q1", note: "**NOTE:** late" }]);
    const archive = "# Archive\n- [x] **Q1 LOW alpha** **DONE:** shipped\n";
    expect(appendArchiveNotes(archive, r.archiveNotes)).toEqual({ text: "# Archive\n- [x] **Q1 LOW alpha** **DONE:** shipped **NOTE:** late\n", unplaced: [] });
  });

  it("non-item lines: one side's change is taken; both sides' changes at one place are both kept", () => {
    const base = doc(A, B);
    expect(mergeOpenItems({ base, ours: base, theirs: base.replace("## Archive", "## Archive (renamed)") })).toBe(base.replace("## Archive", "## Archive (renamed)"));
    const ours = base.replace(B, B + "\n  **STATUS:** main's note");
    const theirs = base.replace(B, B + "\n  **STATUS:** branch's note");
    expect(mergeOpenItems({ base, ours, theirs })).toBe(base.replace(B, B + "\n  **STATUS:** main's note\n  **STATUS:** branch's note"));
    const counted = base.replace("2 open.", "3 open.");
    expect(mergeOpenItems({ base, ours: base, theirs: counted })).toBe(base);
  });

  it("does not duplicate an item main already carries word for word", () => {
    const n = "- [ ] **Q6 LOW same on both**";
    expect(mergeOpenItems({ base: doc(A), ours: doc(A, n), theirs: doc(A, n) })).toBe(doc(A, n));
  });

  it("an archive file: both sides' ticked items kept", () => {
    const base = "# Done\n\n- [x] **Q1 LOW a**\n";
    const ours = base + "- [x] **Q2 LOW b**\n";
    const theirs = base + "- [x] **Q3 LOW c**\n";
    expect(mergeOpenItems({ base, ours, theirs })).toBe(base + "- [x] **Q2 LOW b**\n- [x] **Q3 LOW c**\n");
  });
});
