// @mutate scripts/lib/openItemMerge.mjs |     if (oi.get(q) !== bi.get(q)) return null; |     if (false) return null;
// @mutate scripts/lib/openItemMerge.mjs |     if (m && deleted.has(m[1])) continue; |     if (false) continue;
// @mutate scripts/lib/openItemMerge.mjs |     return null;\n  }\n  const theirsLines = new Set(T); |     continue;\n  }\n  const theirsLines = new Set(T);
// @mutate scripts/land.sh |       if [ -z "$REST" ] \|\| { [ "$REST" = "docs/OPEN.md" ] && node scripts/lib/openItemMerge.mjs && git add docs/OPEN.md; }; then |       if [ -z "$REST" ]; then
/*
 * GUARD: land.sh merges a docs/OPEN.md rebase conflict item by item, and
 * stops for a person on anything it cannot judge (scripts/lib/openItemMerge.mjs).
 *
 * 2026-10-03: five land.sh runs stopped on OPEN.md in one evening, each one
 * two landings appending or noting items at the same place, each resolved by
 * hand the same way. The rules below are that hand resolution, written down.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { mergeOpenItems } from "../../scripts/lib/openItemMerge.mjs";

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

  it("appends the branch's new items after main's last item, main's new items kept", () => {
    const base = doc(A, B);
    const ours = doc(A, B, "- [ ] **Q3 LOW main's new one**");
    const theirs = doc(A, B, "- [ ] **Q4 LOW branch's new one**");
    expect(mergeOpenItems({ base, ours, theirs })).toBe(doc(A, B, "- [ ] **Q3 LOW main's new one**", "- [ ] **Q4 LOW branch's new one**"));
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

  it("stops for a person when both sides changed the same item", () => {
    expect(mergeOpenItems({ base: doc(A, B), ours: doc(A + " main", B), theirs: doc(A + " branch", B) })).toBeNull();
    expect(mergeOpenItems({ base: doc(A, B), ours: doc(A + " main", B), theirs: doc(B) })).toBeNull();
  });

  it("stops for a person when the branch changed a line that is not an item (the count line excepted)", () => {
    const base = doc(A, B);
    expect(mergeOpenItems({ base, ours: base, theirs: base.replace("## Archive", "## Archive (renamed)") })).toBeNull();
    // a line only ADDED (a continuation note under an item, a new heading) is a change too
    expect(mergeOpenItems({ base, ours: base, theirs: base.replace(B, B + "\n  **STATUS:** a note") })).toBeNull();
    const counted = base.replace("2 open.", "3 open.");
    expect(mergeOpenItems({ base, ours: base, theirs: counted })).toBe(base);
  });

  it("does not duplicate an item main already carries word for word", () => {
    const n = "- [ ] **Q6 LOW same on both**";
    expect(mergeOpenItems({ base: doc(A), ours: doc(A, n), theirs: doc(A, n) })).toBe(doc(A, n));
  });

  it("land.sh runs it only when docs/OPEN.md is the one conflicted file, and stops otherwise", () => {
    const land = readFileSync(join(__dirname, "..", "..", "scripts", "land.sh"), "utf8");
    // Generated files are taken from main first (branchesNeverEditGenerated);
    // what is left must be docs/OPEN.md alone, merged item by item.
    expect(land).toMatch(/UNMERGED=\$\(git diff --name-only --diff-filter=U\)/);
    expect(land).toMatch(/REST=\$\(grep -vxF -f <\(printf '%s\\n' \$GEN_UNMERGED\) <<<"\$UNMERGED" \|\| true\)/);
    expect(land).toMatch(/if \[ -z "\$REST" \] \|\| \{ \[ "\$REST" = "docs\/OPEN\.md" \] && node scripts\/lib\/openItemMerge\.mjs && git add docs\/OPEN\.md; \}; then/);
    expect(land).toMatch(/GIT_EDITOR=true git rebase --continue[^\n]*\|\| true\n\s+fi\n\s+continue\n\s+fi\n\s+echo "land: the rebase onto origin\/main stopped on a conflict/);
  });
});
