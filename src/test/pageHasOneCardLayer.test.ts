/**
 * Q2012 (owner order 2026-10-17, "boxes inside boxes"): a signed-in page is ONE
 * layer of cards on the page, not a header card + a panel card + cards inside.
 *
 * PageScaffold (Jobs, Messages, the guest dashboard) still renders a title card
 * (TITLE_CARD_CLASS: liquid-glass + glass fill + three shadows) and a panel
 * (PANEL_CLASS: liquid-glass + panelSurfaceStyle's crisp fill + shadow) as
 * inline styles. The 10-18/10-20 new look (index.css T2 and T4) zeroes both
 * with `!important` rules, so neither paints: measured on prod 2026-11-03 by
 * Builder 88 as poster-e2e (Chromium, 375 and 1440, light and dark, /jobs and
 * /messages): .page-title-card and .page-panel both compute background
 * rgba(0,0,0,0), box-shadow none, border transparent; the job cards are the
 * one layer (~/.lh-shots/b88-q2012/prod-*.png).
 *
 * Those few CSS lines are all that stands between the page and the three
 * layers coming back, and nothing else checked them. This guard does.
 *
 * @mutate src/index.css | .page-panel { box-shadow: none !important; background-color: transparent !important; } | .page-panel { }
 * @mutate src/index.css | :root[data-theme="dark"] .page-panel { background-color: transparent !important; } | :root[data-theme="dark"] .page-panel { }
 * @mutate src/index.css | .page-title-card {\n  background-color: transparent !important;\n  background-image: none !important; | .page-title-card {\n  background-image: none !important;
 * @mutate src/index.css |   border-color: transparent !important;\n  box-shadow: none !important;\n  -webkit-backdrop-filter: none !important;\n  backdrop-filter: none !important;\n  padding-left: 0.25rem !important; |   border-color: transparent !important;\n  -webkit-backdrop-filter: none !important;\n  backdrop-filter: none !important;\n  padding-left: 0.25rem !important;
 * @mutate src/index.css | :root[data-theme="dark"] .page-title-card { background-color: transparent !important; } | :root[data-theme="dark"] .page-title-card { }
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankCssComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const css = blankCssComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));

/** Every top-level rule body whose selector list is exactly `selector`. */
function bodies(selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (m[1].trim() === selector) out.push(m[2]);
  }
  return out;
}

const decl = (body: string, prop: string) =>
  new RegExp(`(^|[;\\s])${prop.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`).exec(body)?.[2].trim() ?? null;

function has(selector: string, prop: string, value: string): boolean {
  return bodies(selector).some((b) => decl(b, prop) === `${value} !important`);
}

describe("Q2012: a signed-in page is one layer of cards", () => {
  it("finds the rules it reads (inventory floor)", () => {
    expect(bodies(".page-panel").length + bodies(".page-title-card").length).toBeGreaterThan(1);
  });

  it("the content panel paints nothing (light and dark)", () => {
    expect(has(".page-panel", "background-color", "transparent")).toBe(true);
    expect(has(".page-panel", "box-shadow", "none")).toBe(true);
    expect(has(':root[data-theme="dark"] .page-panel', "background-color", "transparent")).toBe(true);
  });

  it("the title card at rest is plain page chrome, not a card (light and dark)", () => {
    expect(has(".page-title-card", "background-color", "transparent")).toBe(true);
    expect(has(".page-title-card", "background-image", "none")).toBe(true);
    expect(has(".page-title-card", "box-shadow", "none")).toBe(true);
    expect(has(".page-title-card", "border-color", "transparent")).toBe(true);
    expect(has(':root[data-theme="dark"] .page-title-card', "background-color", "transparent")).toBe(true);
  });

  it("the panel's border is invisible: it wears .liquid-glass, whose border the cleaner-cards rule clears", () => {
    const scaffold = readFileSync(resolve(ROOT, "src/components/ui/PageScaffold.tsx"), "utf8");
    expect(scaffold).toMatch(/const PANEL_CLASS = "page-panel liquid-glass /);
    const group = bodies(".liquid-glass,\n:where(.bg-card),\n[data-feed-card],\n[data-activity-card]");
    expect(group.some((b) => decl(b, "border-color") === "transparent !important")).toBe(true);
  });
});
