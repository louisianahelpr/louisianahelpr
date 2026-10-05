/**
 * Q1012 — a fit check implements BOTH clauses of CLAUDE.md's proof of fit.
 *
 * CLAUDE.md: "assert documentElement.scrollWidth <= clientWidth, no element
 * wider than the viewport". In THIS codebase the first clause alone is inert:
 * src/index.css sets `body { overflow-x: hidden }` (it absorbs the
 * `.full-bleed` -50vw spill), so documentElement.scrollWidth stops growing and
 * content genuinely off the side of a phone reports as fitting (measured
 * 2026-09-21: a 1400px element in the landing hero at 320 left the assertion
 * green on all five viewports). mobile-viewports.spec.ts shipped with only the
 * first clause and could not fail for its headline concern.
 *
 * THE RULE, from source: every check file (e2e/, scripts/, src/test/) whose
 * code measures documentElement.scrollWidth must also measure elements against
 * the viewport: measureLayout() / its overflowOffenders
 * (e2e/happy-path/auditRoutes.ts), or an element rect's right/width compared
 * to innerWidth / clientWidth. A file that reads scrollWidth for another reason
 * is listed in NOT_A_PAGE_FIT_CHECK with that reason, two-way.
 */
// @mutate e2e/journeys/stat-tile-heights.spec.ts | const { overflowOffenders } = await measureLayout(page);\n          expect(overflowOffenders, | expect([] as string[],
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

/** Reads documentElement.scrollWidth, but not to prove a page fits. */
const NOT_A_PAGE_FIT_CHECK: Record<string, string> = {
  "e2e/happy-path/contrastResolve.ts": "reads the page width to decode a full-page screenshot's pixel grid, not to judge fit",
};

const PAGE_CLAUSE = /\bdocumentElement\.scrollWidth\b/;
/** An element rect (getBoundingClientRect / Playwright boundingBox) whose right edge or width is read, or the shared measureLayout. */
const ELEMENT_CLAUSE =
  /\bmeasureLayout\s*\(|\boverflowOffenders\b|(?:getBoundingClientRect|boundingBox)\s*\([\s\S]*?\.(?:right|width)\b/;

function checkFiles(): string[] {
  return walkSource([join(ROOT, "e2e"), join(ROOT, "scripts"), join(ROOT, "src/test")], [".ts", ".tsx", ".mjs"])
    .map((abs) => abs.slice(ROOT.length + 1))
    .filter((rel) => !rel.endsWith("fitChecksHaveBothClauses.test.ts"))
    .filter((rel) => PAGE_CLAUSE.test(blankComments(readFileSync(join(ROOT, rel), "utf8"))))
    .sort();
}

describe("every page-fit check has the per-element clause too (Q1012)", () => {
  const files = checkFiles();

  it("the inventory is read from source and is real", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("e2e/mobile-viewports.spec.ts");
  });

  it("each one also measures elements against the viewport, or says why it is not a fit check", () => {
    const missing = files.filter(
      (f) => !(f in NOT_A_PAGE_FIT_CHECK) && !ELEMENT_CLAUSE.test(blankComments(readFileSync(join(ROOT, f), "utf8"))),
    );
    expect(missing).toEqual([]);
  });

  it("the exemption list is exact", () => {
    for (const f of Object.keys(NOT_A_PAGE_FIT_CHECK)) expect(files, f).toContain(f);
  });

  it("the element clause matches the forms the repo uses (cannot pass vacuously)", () => {
    expect(ELEMENT_CLAUSE.test("const { overflowOffenders } = await measureLayout(page);")).toBe(true);
    expect(ELEMENT_CLAUSE.test("const r = e.getBoundingClientRect(); if (r.right > viewportW + 2) out.push(x)")).toBe(true);
    expect(ELEMENT_CLAUSE.test("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(false);
  });
});
