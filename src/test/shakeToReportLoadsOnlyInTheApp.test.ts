/**
 * Shake-to-report loads only in the app (B47 10-31, Speed: the boot graph every web route downloads).
 *
 * The website never supports it (isShakeToReportSupported is native-only, LEAD-SHAKE-PROMPT), yet main.tsx imported it
 * statically, so the module and its sell-chooser import rode every web route's boot path. Measured, local vite build
 * with land.sh's env, exact gzip: every route -0.72 KB (/ 282.49 -> 281.77, /browse 343.32 -> 342.59, /login
 * 285.19 -> 284.47, /signup 297.60 -> 296.88, /posts 265.92 -> 265.20, /home 395.03 -> 394.34).
 *
 * Reads src/main.tsx with the TypeScript AST: no static import of the module, and its one dynamic import sits inside
 * an `if (isNativePlatform)` block.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// @mutate src/main.tsx |   if (isNativePlatform) {\n    void backgroundImport( |   if (true) {\n    void backgroundImport(
// @mutate src/main.tsx | import { initNative, hideSplash, isNativePlatform } from "./lib/nativeInit"; | import { initNative, hideSplash, isNativePlatform } from "./lib/nativeInit";\nimport "./lib/shakeToReport";

const FILE = "src/main.tsx";
const MODULE = "./lib/shakeToReport";

describe("shake-to-report is not on the website's boot path", () => {
  const sf = ts.createSourceFile(FILE, readFileSync(resolve(__dirname, "../..", FILE), "utf8"), ts.ScriptTarget.Latest, true);
  const statics: string[] = [];
  const dynamicGuards: string[] = [];
  let imports = 0;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) {
      imports++;
      if ((n.moduleSpecifier as ts.StringLiteral).text === MODULE) statics.push(n.getText(sf));
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = n.arguments[0];
      if (a && ts.isStringLiteral(a) && a.text === MODULE) {
        let p: ts.Node | undefined = n.parent;
        while (p && !ts.isIfStatement(p)) p = p.parent;
        dynamicGuards.push(p && ts.isIfStatement(p) ? p.expression.getText(sf) : "<no if>");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  it("main.tsx never imports it statically", () => {
    expect(imports).toBeGreaterThan(10);
    expect(statics).toEqual([]);
  });

  it("its one dynamic import runs only on the native platform", () => {
    expect(dynamicGuards).toEqual(["isNativePlatform"]);
  });
});
