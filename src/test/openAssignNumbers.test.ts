/*
 * GUARD (lead, 2026-10-12): queue numbers are assigned at LANDING time.
 * Lanes took "next free" from their own base, collided, and land.sh moved the
 * branch's item, but a commit subject naming the old number ("file Q1652")
 * then named main's different item, so check-fixes-update-their-items went
 * red after the renumber (fix-land/open-1011, fix-land/proof-ticks,
 * local-mac/q252, measured by the queue doctor).
 *   1. A new item is filed as `**Q?<tag>`; scripts/open-assign-numbers.mjs,
 *      run by land.sh after the rebase, gives every tag the next number free
 *      on the tree and origin/main and rewrites every occurrence.
 *   2. check-fixes-update-their-items ignores a number the commit itself
 *      FILED (its patch adds that head line), so a renumbered new item's old
 *      number in a subject is not read as a claim on main's item.
 * Red first: on origin/main the assigner does not exist, land.sh does not run
 * it, and unrecordedItems() flags the filed number.
 */
// @mutate scripts/open-assign-numbers.mjs |       if (assigned.has(m[1])) continue; |
// @mutate scripts/open-assign-numbers.mjs |     const text = f.text.replace(PLACEHOLDER, (_, tag) => assigned.get(tag)); |     const text = f.text;
// @mutate scripts/land.sh |   node scripts/open-assign-numbers.mjs --base origin/main |   true
// @mutate scripts/lib/fixUpdatesItem.mjs |       if (c.filed?.has(id)) continue; |
// @mutate scripts/lib/fixUpdatesItem.mjs |   return new Set([...added].filter((q) => !removed.has(q))); |   return new Set([...added]);
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { assignPlaceholders, PLACEHOLDER } from "../../scripts/open-assign-numbers.mjs";
// @ts-expect-error — plain .mjs module, no declaration file
import { filedIn, namedIn, unrecordedItems } from "../../scripts/lib/fixUpdatesItem.mjs";

const ROOT = join(__dirname, "..", "..");

describe("queue numbers are assigned at landing (Q?<tag> placeholders)", () => {
  const open = [
    "# Open",
    "- [ ] **Q1700 LOW already numbered.** see Q?fill-rate for the follow-up",
    "- [ ] **Q?fill-rate LOW The Fill Rate card reads a failed load as no data.** body",
    "- [ ] **Q?side-effects MEDIUM Two side effects.** also Q?fill-rate",
  ].join("\n");
  const archive = "- [x] **Q?done-here LOW filed and ticked in one branch.** done\n";

  it("each tag gets the next free number, in order of first appearance, everywhere it is cited", () => {
    const { files, assigned } = assignPlaceholders(
      [{ path: "docs/OPEN.md", text: open }, { path: "docs/archive/OPEN-done-2026-10.md", text: archive }],
      1701,
    );
    expect([...assigned.entries()]).toEqual([["fill-rate", "Q1701"], ["side-effects", "Q1702"], ["done-here", "Q1703"]]);
    expect(files[0].text).not.toMatch(PLACEHOLDER);
    expect(files[0].text).toContain("see Q1701 for the follow-up");
    expect(files[0].text).toContain("- [ ] **Q1701 LOW The Fill Rate card");
    expect(files[0].text).toContain("- [ ] **Q1702 MEDIUM Two side effects.** also Q1701");
    expect(files[1].text).toBe("- [x] **Q1703 LOW filed and ticked in one branch.** done\n");
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((f) => f.changed)).toBe(true);
  });

  it("no placeholder: nothing changes and no number is taken", () => {
    const { files, assigned } = assignPlaceholders([{ path: "docs/OPEN.md", text: "- [ ] **Q5 LOW x.**" }], 6);
    expect(assigned.size).toBe(0);
    expect(files[0].changed).toBe(false);
  });

  it("a placeholder in a commit subject names no item, so check-fixes reads no claim from it", () => {
    expect(namedIn("docs(open): file Q?fill-rate, the Fill Rate gap")).toEqual([]);
  });

  it("a number the commit itself filed is not a claim on main's item of that number", () => {
    // The doctor's case: the branch filed Q1652, land.sh moved it to Q1665,
    // and main's Q1652 (open-auto-tick) is a different, untouched item.
    const mainOpen = "- [ ] **Q1652 LOW open-auto-tick never runs test markers.** main's item";
    const patch = "+- [ ] **Q1652 LOW No service fee for posters.** the branch's new item\n";
    const filer = { sha: "abc", subject: "chore(open): file Q1652 (no poster fee)", body: "", filed: filedIn(patch) };
    expect(unrecordedItems([filer], mainOpen, mainOpen)).toEqual([]);
    // A commit that only CLAIMS work on main's item is still caught.
    const claimer = { sha: "def", subject: "fix(ci): open-auto-tick (Q1652)", body: "", filed: filedIn("") };
    expect(unrecordedItems([claimer], mainOpen, mainOpen).map((r: { id: string }) => r.id)).toEqual(["Q1652"]);
  });

  it("an item the patch moves or edits (both sides) is not counted as filed", () => {
    const moved = "-- [ ] **Q10 LOW x.** a\n+- [~] **Q10 LOW x.** a, now partly done\n+- [ ] **Q11 LOW new.** b\n";
    expect([...filedIn(moved)]).toEqual(["Q11"]);
  });

  it("land.sh assigns the numbers after the rebase, before the renumber, and check-fixes passes what each commit filed", () => {
    const land = readFileSync(join(ROOT, "scripts", "land.sh"), "utf8");
    const assign = land.indexOf("\n  node scripts/open-assign-numbers.mjs --base origin/main");
    const renumber = land.indexOf("\n  node scripts/open-renumber.mjs --base origin/main");
    expect(assign).toBeGreaterThan(-1);
    expect(assign).toBeLessThan(renumber);
    const cli = readFileSync(join(ROOT, "scripts", "check-fixes-update-their-items.mjs"), "utf8");
    expect(cli).toMatch(/filed: filedIn\(git\(\["show", "--format=", "-U0", c\.sha, "--", OPEN, "docs\/archive"\]\)\)/);
  });
});
