/**
 * POST A JOB FITS ITS OWN COLUMN (lead, 2026-10-25, site check at 1180 and phone).
 *
 * The bug: the form's grids were keyed to the SCREEN (lg:grid-cols-3,
 * md:grid-cols-2), but on desktop the form sits beside the 248px app rail, the
 * step list and the "What Helprs will see" card. Measured on the local build as
 * poster-e2e: the form column was about 370px at 1180 and 215px at 1024, so the
 * screen breakpoints put three category tiles in it ("Handym…", "Assembl…", a
 * sub-line run out of its tile) and a 155px calendar beside a 155px time card
 * (arrows over "October 2026", "SUMOTUWETHFRSA"). The sticky "Add the address to
 * continue" bar rode over the calendar and the time picker while greyed out, and
 * the title placeholder was cut ("e.g. Deep clean a 2-bedroom apartme").
 *
 * The rules, read from source:
 *   1. the tiles and the date/time grid are sized by container queries on their
 *      own wrapper (.pj-cq), never a screen breakpoint (index.css);
 *   2. the preview card joins at xl; from lg to xl it is the step list + form;
 *   3. the action bar floats (sticky) only while its button can be pressed;
 *   4. every title placeholder is at most TITLE_PLACEHOLDER_MAX characters (all
 *      25 measured to fit the field at 320: widest 208px of 212px) and its
 *      example is never longer than a title may be (TITLE_MAX).
 * Proof screenshots at 320/390/1024/1180/1280/1440: ~/.lh-shots/lane-a-posting/.
 *
 * @mutate src/index.css | .pj-cq { container-type: inline-size; } | .pj-cq { }
 * @mutate src/index.css | .pj-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } | .pj-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
 * @mutate src/index.css | .pj-when-grid { grid-template-columns: minmax(0, 1fr); } | .pj-when-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 * @mutate src/components/postjob/JobCategoryGroups.tsx |           <section aria-label={t("postJob.categoryGroups")} className="pj-group-tiles grid gap-2.5"> |           <section aria-label={t("postJob.categoryGroups")} className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
 * @mutate src/components/postjob/LogisticsSection.tsx |       <div className="pj-when-grid grid gap-5"> |       <div className="grid gap-5 md:grid-cols-2 md:items-stretch">
 * @mutate src/pages/post-job/FormStep.tsx |       <aside className="hidden xl:block sticky top-6"> |       <aside className="hidden lg:block sticky top-6">
 * @mutate src/pages/post-job/FormStep.tsx |             <div className="xl:hidden"><PostJobPreviewCard |             <div className="lg:hidden"><PostJobPreviewCard
 * @mutate src/pages/post-job/FormStep.tsx | className={`${barFloats ? "sticky bottom-safe-nav" : "relative"} z-10 | className={`${"sticky bottom-safe-nav"} z-10
 * @mutate src/pages/post-job/FormStep.tsx | !lastPage ? pagePressable : !submitDisabled; | !lastPage ? true : true;
 * @mutate src/components/postjob/detailsSection/detailsSectionConstants.ts |   cleaning: "e.g. Deep clean 2 bedrooms", |   cleaning: "e.g. Deep clean a 2-bedroom apartment",
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { TITLE_MAX, TITLE_PLACEHOLDER_MAX, titlePlaceholders } from "@/components/postjob/detailsSection/detailsSectionConstants";

const ROOT = process.cwd();
const raw = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const read = (rel: string) => blankComments(raw(rel));
/** index.css with its comments blanked. */
const css = () => blankCssComments(raw("src/index.css"));

/** The declarations of `selector` inside the top-level rule or the @container block that holds it. */
function ruleBody(src: string, selector: string, container: string | null): string | null {
  const scope = container === null ? src.replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "") : (() => {
    const blocks = [...src.matchAll(/@container\s*\(([^)]*)\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].filter((m) => m[1].replace(/\s+/g, " ").trim() === container);
    return blocks.map((m) => m[2]).join("\n");
  })();
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = scope.match(new RegExp(`(^|[\\s}])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[2].replace(/\s+/g, " ").trim() : null;
}

const FORM_FILES = [
  "src/pages/post-job/FormStep.tsx",
  "src/components/postjob/JobCategoryGroups.tsx",
  "src/components/postjob/LogisticsSection.tsx",
];

describe("Post a job sizes its grids to its own column", () => {
  it("index.css: the wrappers are containers; two tiles and a stacked date/time below 560px, three tiles and side by side from 560px", () => {
    const s = css();
    expect(ruleBody(s, ".pj-cq", null)).toBe("container-type: inline-size;");
    expect(ruleBody(s, ".pj-tiles", null)).toBe("grid-template-columns: repeat(2, minmax(0, 1fr));");
    // The group tiles' own grid (owner 2026-10-27): src/test/postJobCategoryGridOrderly.test.tsx.
    expect(ruleBody(s, ".pj-when-grid", null)).toBe("grid-template-columns: minmax(0, 1fr);");
    expect(ruleBody(s, ".pj-tiles", "min-width: 560px")).toBe("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(ruleBody(s, ".pj-when-grid", "min-width: 560px")).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  });

  it("the post form's grids use no screen breakpoint for their columns (inventory: the three files of the flow's form)", () => {
    for (const f of FORM_FILES) {
      const src = read(f);
      expect(src.length, f).toBeGreaterThan(1000);
      // The page grid in FormStep is the one screen-keyed layout (rail | form | card); everything inside the form is column-keyed.
      const inner = f.endsWith("FormStep.tsx") ? src.slice(src.indexOf("<form"), src.indexOf("</form>")) : src;
      expect(inner.match(/\b(sm|md|lg|xl|2xl):grid-cols-\d\b/g) ?? [], f).toEqual([]);
      expect(inner.match(/\b(sm|md|lg|xl|2xl):(hidden|block)\b/g) ?? [], f).toEqual(f.endsWith("FormStep.tsx") ? ["xl:hidden"] : []);
    }
  });

  it("the tiles and the date/time grid sit inside a container", () => {
    const tiles = read("src/components/postjob/JobCategoryGroups.tsx");
    expect(tiles.match(/className="pj-tiles grid gap-2\.5"/g)?.length).toBe(2);
    expect(tiles.match(/className="pj-group-tiles grid gap-2\.5"/g)?.length).toBe(1);
    // One category-picker element for both views (A0-L1), each a pj-cq container.
    expect(tiles.match(/id="category-picker" className=\{open \? "pj-cq" : "pj-cq space-y-5"\}/g)?.length).toBe(1);
    const when = read("src/components/postjob/LogisticsSection.tsx");
    expect(when).toMatch(/<div className="pj-cq">\s*<div className="pj-when-grid grid gap-5">/);
  });

  it("the preview card joins at xl; lg to xl is the step list and the form", () => {
    const step = read("src/pages/post-job/FormStep.tsx");
    // The page grid is shared with Review (CheckoutStepView) as POST_JOB_DESKTOP_GRID in PostJobStepRail.
    expect(step).toContain('<div key="form-step" ref={rootRef} className={POST_JOB_DESKTOP_GRID}>');
    expect(read("src/components/postjob/PostJobStepRail.tsx")).toContain("lg:grid-cols-[200px_minmax(0,640px)] xl:grid-cols-[200px_minmax(0,640px)_280px]");
    expect(step).toContain('<aside className="hidden xl:block sticky top-6">');
    // The price screen's inline copy of the card covers everything below xl, so no width loses it.
    expect(step).toContain('<div className="xl:hidden"><PostJobPreviewCard');
  });

  it("the action bar floats only while its button can be pressed", () => {
    const step = read("src/pages/post-job/FormStep.tsx");
    expect(step).toMatch(/const barFloats = backTo && !atOpenJobLimit && !underAge \? true : !lastPage \? pagePressable : !submitDisabled;/);
    expect(step).toMatch(/className=\{`\$\{barFloats \? "sticky bottom-safe-nav" : "relative"\} z-10 bg-premium-page/);
    expect(step.match(/sticky bottom-safe-nav/g)?.length).toBe(1);
  });

  it("every title placeholder fits the field at 320 and models a title that is allowed", () => {
    const entries = Object.entries(titlePlaceholders);
    expect(entries.length).toBeGreaterThan(20);
    expect(TITLE_PLACEHOLDER_MAX).toBeLessThanOrEqual(28); // 28 measured to fit at 320 (widest 208px of 212px)
    for (const [key, ph] of entries) {
      expect(ph.length, `${key}: "${ph}"`).toBeLessThanOrEqual(TITLE_PLACEHOLDER_MAX);
      expect(ph.replace(/^e\.g\. /, "").length, key).toBeLessThanOrEqual(TITLE_MAX);
    }
  });
});
