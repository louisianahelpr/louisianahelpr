/*
 * CLASS GUARD: a route skeleton must mirror the bar it stands in for.
 *
 * `DashboardRouteSkeleton` exists solely to hold one promise — that the frame
 * painted before the chunk lands is "the exact shape Dashboard.tsx's `loading`
 * branch uses" (its own docblock). Its render tests passed throughout, because
 * a component test asserts a component against ITSELF. The defect lives in the
 * GAP between two files, which is exactly where nothing was looking.
 *
 * MEASURED on prod 2026-09-22, 1440, ~1.2Mbps/150ms, CPU 4x, signed in —
 * two consecutive frames of one page load, read as images:
 *   921ms   title card: HelprMark emblem + three circular bones
 *   2897ms  title card: search icon + filter icon, no emblem, no bell
 * The header visibly rearranged mid-load. Owner, the same day: "the loading
 * for the webpage should go straight to the webpage not load another thing
 * then go to webpage."
 *
 * THREE causes, all of them "the skeleton says something the bar does not":
 *   size      skeleton "md" (emblemOnly -> h-10, 40px) vs bar "sm" (h-8, 32px)
 *   desktop   the bar's emblem and bell carry `dashboard-title-emblem` /
 *             `dashboard-title-bell`, which index.css hides on
 *             `html.web-desktop`; the skeleton carried neither, so it drew
 *             chrome the bar does not have there
 *   shrink-0  load-bearing on the bar (its comment records the emblem
 *             resolving to 0x44 at 375 without it)
 *
 * So this test reads BOTH FILES and diffs the traits that decide the shape.
 * It is deliberately not a snapshot: a snapshot of the skeleton alone would
 * have been green through all three.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const SKELETON = "src/components/DashboardRouteSkeleton.tsx";
const BAR = "src/components/dashboard/DashboardTitleBar.tsx";
const CSS = "src/index.css";

const skeleton = read(SKELETON);
const bar = read(BAR);
const css = read(CSS);

/** The HelprMark call in a file, as a single whitespace-collapsed string. */
const helprMarkCall = (src: string) => {
  const i = src.indexOf("<HelprMark");
  expect(i, "every one of these files must render a HelprMark").toBeGreaterThan(-1);
  return src.slice(i, src.indexOf("/>", i) + 2).replace(/\s+/g, " ");
};

describe("DashboardRouteSkeleton mirrors DashboardTitleBar", () => {
  it("uses the SAME HelprMark size as the bar", () => {
    const barSize = helprMarkCall(bar).match(/size="(\w+)"/)?.[1];
    const skelSize = helprMarkCall(skeleton).match(/size="(\w+)"/)?.[1];
    expect(barSize, "the bar must state an explicit size").toBeTruthy();
    expect(
      skelSize,
      `skeleton emblem is size="${skelSize}" but the bar it stands in for is size="${barSize}". ` +
        `emblemOnly maps sm->h-8 (32px) and md->h-10 (40px), so a mismatch is a visible jump ` +
        `the moment the real bar lands.`,
    ).toBe(barSize);
  });

  it("hides the emblem and bell on desktop exactly as the bar does", () => {
    // The mechanism is two class names and one CSS rule. If the skeleton does
    // not opt into them, it draws chrome the bar does not have on web-desktop.
    expect(css).toMatch(/html\.web-desktop \.dashboard-title-emblem,\s*html\.web-desktop \.dashboard-title-bell \{\s*display: none !important;/);

    // STRIPPED OF COMMENTS FIRST, and that is not fussiness. The first draft
    // of this test asserted `skeleton.toContain("dashboard-title-emblem")`
    // against the whole file — and the docblock above the emblem NAMES that
    // class, so deleting it from the className left the test green. Mutation
    // testing caught it: one of the two registered mutations SURVIVED. A claim
    // about the code is not the code, the same trap as trusting a comment
    // beside a CSS declaration.
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const skeletonCode = code(skeleton);
    const barCode = code(bar);

    for (const cls of ["dashboard-title-emblem", "dashboard-title-bell"]) {
      expect(barCode, `the bar is expected to use ${cls} in its markup`).toContain(cls);
      expect(
        skeletonCode,
        `${SKELETON} must also carry "${cls}" IN ITS MARKUP (comments do not count). ` +
          `The bar hides that element on web-desktop via index.css; a skeleton without ` +
          `the class keeps drawing it, and the header rearranges when the bar replaces it.`,
      ).toContain(cls);
    }
  });

  it("keeps shrink-0 on the emblem, which the bar documents as load-bearing", () => {
    for (const [name, src] of [["bar", bar], ["skeleton", skeleton]] as const) {
      expect(
        helprMarkCall(src),
        `${name}'s emblem must be shrink-0 — without it flexbox takes the actions ` +
          `cluster's overflow out of the emblem and it resolves to 0x44 at 375.`,
      ).toContain("shrink-0");
    }
  });

  it("reserves the same THREE trailing controls the bar ends in", () => {
    // search · filters · bell. The skeleton once stood one 44px circle there
    // and the cluster jumped 44px -> 148px when the real bar landed.
    const cluster = skeleton.slice(skeleton.indexOf("gap-1.5 sm:gap-2 shrink-0"));
    expect((cluster.match(/<Skeleton/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("is not vacuous — both files were actually read", () => {
    // If a refactor moves or renames these, this test must fail LOUDLY rather
    // than pass on an empty string, which is how guards stay green for months.
    expect(skeleton.length).toBeGreaterThan(500);
    expect(bar.length).toBeGreaterThan(500);
    expect(skeleton).toContain("DashboardRouteSkeleton");
    expect(bar).toContain("TITLE_BAR_PADDING");
  });
});

// Proof this is able to fail — each mutation restores one of the three real
// mismatches measured on prod.
// @mutate src/components/DashboardRouteSkeleton.tsx | size="sm" | size="md"
// @mutate src/components/DashboardRouteSkeleton.tsx | className="shrink-0 dashboard-title-emblem" | className="shrink-0"
