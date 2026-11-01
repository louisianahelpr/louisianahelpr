/**
 * Guest /browse's first paint does not download overlays it never shows on that paint (B47 10-31, Speed item 3).
 *
 * - DashboardTitleBar's DEFAULT bell (NotificationPanel): its one caller, the signed-out feed, always passes `trailing`
 *   (Log In / Get Started), so the bell never renders on /browse; a static import still put NotificationPanel on the path.
 * - BrowseTasksToolbar's FilterSheet: closed on every first paint; its static import put FilterSheet, FilterDropdown,
 *   the Radix popover and floating-ui on the path.
 *
 * Measured, local vite build with land.sh's env (bundle-size.yml literals, MapKit unset), exact gzip:
 * /browse 365.63 -> 358.01 (bell) -> 343.32 KB gz (filter sheet); the budget (scripts/perf/critical-path-budget.json)
 * is lowered 354 -> 343. Its +5% band would let a revert of the bell alone back in, so this reads the source.
 * The sheet still opens on the first tap at 375 (sheet) and 1440 (dropdown), measured in a mocked headless run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// @mutate src/components/dashboard/DashboardTitleBar.tsx | const NotificationPanel = lazy(() => import("@/components/NotificationPanel")); | import NotificationPanelNow from "@/components/NotificationPanel";\nconst NotificationPanel = NotificationPanelNow;
// @mutate src/components/dashboard/BrowseTasksToolbar.tsx | const loadFilterSheet = () => loadModule(() => import("@/components/dashboard/FilterSheet")); | import * as filterSheetNow from "@/components/dashboard/FilterSheet";\nconst loadFilterSheet = async () => filterSheetNow;
// @mutate src/components/dashboard/BrowseTasksToolbar.tsx |       {(filters.filtersOpen \|\| filterSheetMounted) && ( |       {(true) && (

const read = (f: string) => readFileSync(resolve(__dirname, "../..", f), "utf8");

/** On guest /browse's first-paint path; each overlay module must reach it only through a dynamic import. */
const LAZY_ON_BROWSE: Array<{ file: string; module: string }> = [
  { file: "src/components/dashboard/DashboardTitleBar.tsx", module: "@/components/NotificationPanel" },
  { file: "src/components/dashboard/BrowseTasksToolbar.tsx", module: "@/components/dashboard/FilterSheet" },
];

function imports(file: string, module: string): { staticValue: number; dynamic: number } {
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  let staticValue = 0;
  let dynamic = 0;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && (n.moduleSpecifier as ts.StringLiteral).text === module) {
      const c = n.importClause;
      const typeOnly =
        !!c?.isTypeOnly ||
        (!!c && !c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) staticValue++;
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = n.arguments[0];
      if (a && ts.isStringLiteral(a) && a.text === module) dynamic++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { staticValue, dynamic };
}

describe("guest /browse's first paint loads its closed overlays lazily", () => {
  it("each overlay reaches the path only through a dynamic import", () => {
    expect(LAZY_ON_BROWSE.length).toBeGreaterThan(1);
    for (const { file, module } of LAZY_ON_BROWSE) {
      const got = imports(file, module);
      expect(got.staticValue, `${file} imports ${module} statically`).toBe(0);
      expect(got.dynamic, `${file} no longer imports ${module} at all: update this list`).toBeGreaterThan(0);
    }
  });

  it("the filter sheet mounts only once it has been opened", () => {
    const code = read("src/components/dashboard/BrowseTasksToolbar.tsx");
    expect(code).toMatch(/\{\(filters\.filtersOpen \|\| filterSheetMounted\) && \(/);
    expect(code).toMatch(/if \(filters\.filtersOpen\) setFilterSheetMounted\(true\);/);
  });
});
