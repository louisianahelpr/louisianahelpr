/**
 * POST A JOB SCREEN 2 IS ORDERLY (owner, 2026-10-27, /post-job "What do you need done?" at 1440: "this needs
 * better organization"). Before: Home, Moving & errands and Trades had a grey line of examples (Home's wrapped
 * to 4 lines), Yard, Auto, Pets, Events and Something else had none, so tile heights differed (128 / 72 / 109px
 * at 1440), titles sat at different heights (13 to 53px from the tile top), and 8 tiles in 3 columns left an
 * empty cell beside "Something else". After: 2 columns x 4 rows at every width; at 1440 and 768 every tile
 * 69px with its title 13px from the top and one line of examples; at 375 every tile 118px (icon, title,
 * examples stacked), the last row ending at 792 of 812. Measured in WebKit: ~/.lh-shots/postjob-category-grid-1027/.
 *
 * The rules, over the app's own list of groups (JOB_CATEGORY_GROUPS, the one Post a job reads):
 *   1. every group tile has the same parts: an icon, a title, and ONE line of 2-3 examples, at most
 *      GROUP_EXAMPLES_MAX characters and clamped to two lines; a group of several categories names only its
 *      own categories;
 *   2. every tile in the grid is the same height (grid-auto-rows: 1fr);
 *   3. at every column count the grid uses, the groups fill whole rows (no ragged last row).
 * The groups and their order are unchanged.
 *
 * @mutate src/lib/jobCategoryGroups.ts |   yard: "Mowing, leaves, hedges", |   yard: "",
 * @mutate src/lib/jobCategoryGroups.ts |   home: "Cleaning, handyman, painting", |   home: "Cleaning, handyman, declutter help and more",
 * @mutate src/lib/jobCategoryGroups.ts |   trades: "Electrical, plumbing, HVAC", |   trades: "Electrical, plumbing, roofing, welding",
 * @mutate src/lib/jobCategoryGroups.ts |   moving_errands: "Moving, errands, delivery", |   moving_errands: "Moving, errands, painting",
 * @mutate src/components/postjob/JobCategoryGroups.tsx | <span data-tile-sub="" title={t(`postJob.groupEx.${g.id}` as MsgKey)} className="block min-w-0 line-clamp-2 | <span data-tile-sub="" title={t(`postJob.groupEx.${g.id}` as MsgKey)} className="block min-w-0
 * @mutate src/components/postjob/JobCategoryGroups.tsx | text-muted-foreground">{t(`postJob.groupEx.${g.id}` as MsgKey)}</span> | text-muted-foreground">{g.items.length > 1 ? t(`postJob.groupEx.${g.id}` as MsgKey) : null}</span>
 * @mutate src/index.css | .pj-group-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; } | .pj-group-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 1fr; }
 * @mutate src/index.css | .pj-group-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; } | .pj-group-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { blankCssComments } from "./helpers/blankNonCode";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { GROUP_EXAMPLES_MAX, JOB_CATEGORY_GROUPS } from "@/lib/jobCategoryGroups";
import { GROUP_EMOJI } from "@/lib/categoryEmoji";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));
afterEach(cleanup);

const css = blankCssComments(readFileSync(join(process.cwd(), "src/index.css"), "utf8"));

/** The declarations of `selector` at the top level (container = null) or inside `@container (<container>)`. */
function ruleBody(selector: string, container: string | null): string | null {
  const scope =
    container === null
      ? css.replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      : [...css.matchAll(/@container\s*\(([^)]*)\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)]
          .filter((m) => m[1].replace(/\s+/g, " ").trim() === container)
          .map((m) => m[2])
          .join("\n");
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = scope.match(new RegExp(`(^|[\\s}])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[2].replace(/\s+/g, " ").trim() : null;
}
const columns = (body: string | null) => Number(/grid-template-columns:\s*repeat\((\d+),/.exec(body ?? "")?.[1] ?? NaN);

describe("Post a job screen 2: every group tile has the same parts", () => {
  it("the groups and their order are unchanged (inventory)", () => {
    expect(JOB_CATEGORY_GROUPS.length).toBeGreaterThan(7);
    expect(JOB_CATEGORY_GROUPS.map((g) => g.id)).toEqual(["home", "yard", "moving_errands", "auto", "pets", "events", "trades", "other"]);
  });

  for (const g of JOB_CATEGORY_GROUPS) {
    it(`${g.id}: one short line of 2-3 examples${g.items.length > 1 ? ", all its own categories" : ""}`, () => {
      expect(g.examples.trim().length).toBeGreaterThan(0);
      expect(g.examples.length, g.examples).toBeLessThanOrEqual(GROUP_EXAMPLES_MAX);
      const parts = g.examples.split(/,\s*/);
      if (g.id !== "other") {
        expect(parts.length, g.examples).toBeGreaterThanOrEqual(2);
        expect(parts.length, g.examples).toBeLessThanOrEqual(3);
      }
      if (g.items.length > 1) {
        const own = g.items.map((it) => it.label.toLowerCase());
        for (const p of parts) expect(own, `${g.id}: "${p}" is not one of its categories`).toContain(p.toLowerCase());
      }
    });
  }

  it("rendered: every tile is icon, title, examples (one each), the examples clamped to two lines", () => {
    render(<JobCategoryGroups category="" setCategory={vi.fn()} group={null} setGroup={vi.fn()} onPicked={vi.fn()} />);
    const tiles = [...screen.getByRole("region", { name: "Category groups" }).querySelectorAll<HTMLElement>("button")];
    expect(tiles.length).toBe(JOB_CATEGORY_GROUPS.length);
    tiles.forEach((tile, i) => {
      const g = JOB_CATEGORY_GROUPS[i];
      const icons = tile.querySelectorAll("[aria-hidden]");
      expect(icons.length, g.id).toBe(1);
      expect(icons[0].textContent, g.id).toBe(GROUP_EMOJI[g.id]);
      expect(icons[0].hasAttribute("data-tile-icon"), g.id).toBe(true);
      expect(tile.querySelectorAll("[data-tile-title]").length, g.id).toBe(1);
      expect([...tile.children].map((c) => [...c.attributes].map((a) => a.name).find((n) => n.startsWith("data-tile-"))), g.id).toEqual(["data-tile-icon", "data-tile-title", "data-tile-sub"]);
      const subs = tile.querySelectorAll<HTMLElement>("[data-tile-sub]");
      expect(subs.length, g.id).toBe(1);
      expect(subs[0].textContent, g.id).toBe(g.examples);
      expect(subs[0].className.split(/\s+/), g.id).toContain("line-clamp-2");
      expect(tile.className.split(/\s+/), g.id).toContain("pj-group-tile");
    });
  });
});

describe("Post a job screen 2: equal heights and no ragged last row", () => {
  it("every row of the grid is the same height", () => {
    expect(ruleBody(".pj-group-tiles", null)).toMatch(/grid-auto-rows:\s*1fr/);
  });

  it("at every column count the grid uses, the groups fill whole rows", () => {
    const base = columns(ruleBody(".pj-group-tiles", null));
    const wide = ruleBody(".pj-group-tiles", "min-width: 560px");
    const counts = [base, wide === null ? base : columns(wide)];
    for (const n of counts) {
      expect(n).toBeGreaterThan(1);
      expect(JOB_CATEGORY_GROUPS.length % n, `${JOB_CATEGORY_GROUPS.length} groups in ${n} columns`).toBe(0);
    }
  });

  it("the grid is the group grid (not the 2/3-column category grid)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/postjob/JobCategoryGroups.tsx"), "utf8");
    // A3-3: the label is t("postJob.categoryGroups"), whose English is "Category groups" (the region test above).
    expect(src).toMatch(/<section aria-label=\{t\("postJob\.categoryGroups"\)\} className="pj-group-tiles grid gap-2\.5">/);
  });
});
