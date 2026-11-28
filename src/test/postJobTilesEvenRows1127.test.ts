/**
 * Polish audit 11-27 #41 (~/.lh-shots/polish-audit-1127/FINDINGS.md, jobs/combo-post2.png): the "What kind of home
 * job?" tiles had uneven heights (72 vs 74px) because a label that wraps made its own row taller. Both tile grids of
 * Post a job (the category tiles .pj-tiles and the group tiles .pj-group-tiles) now give every row the same height.
 * Inventory: every grid class the category picker draws its tiles in.
 *
 * @mutate src/index.css | .pj-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; } | .pj-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const css = blankCssComments(readFileSync(join(ROOT, "src/index.css"), "utf8"));
const picker = blankComments(readFileSync(join(ROOT, "src/components/postjob/JobCategoryGroups.tsx"), "utf8"));

/** The tile grids: every `pj-…tiles` class the picker puts on a grid. */
const grids = [...new Set([...picker.matchAll(/className="(pj-[a-z-]*tiles) grid/g)].map((m) => m[1]))];

/** The top-level (not @container) rule body of `.cls`. */
function topRule(cls: string): string {
  const top = css.replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const m = top.match(new RegExp(`(^|[\\s}])\\.${cls}\\s*\\{([^}]*)\\}`));
  return m ? m[2] : "";
}

describe("#41: Post a job's tiles sit in rows of one height", () => {
  it("finds both tile grids (inventory floor)", () => {
    expect(grids.sort()).toEqual(["pj-group-tiles", "pj-tiles"]);
    expect(grids.length).toBeGreaterThan(1);
  });
  it.each(grids)(".%s gives every row the same height", (cls) => {
    expect(topRule(cls)).toMatch(/grid-auto-rows:\s*1fr/);
  });
});
