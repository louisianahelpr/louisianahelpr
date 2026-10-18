/**
 * HOMES, not "Rentals" (owner 2026-10-18): the section a member reads about is
 * called Homes, with tabs Rent | Buy. Route, table, RPC and switch names keep
 * "rentals" (they are never shown), so this guard reads only STRING CONTENT
 * (string literals, template text, JSX text) in every non-test source file of
 * src/ and supabase/functions/, through the TypeScript AST, and fails on the
 * section word "Rentals" or the phrase "your rentals". Comments and
 * identifiers are not copy. Lower-case "rental" as an adjective ("Rental
 * repair", "Party rentals" in Shops) is not the section name and is allowed.
 *
 * @mutate src/components/rentals/RentalsHomeView.tsx |     <AppPage title="Homes">\n      <div className="mb-4"> |     <AppPage title="Rentals">\n      <div className="mb-4">
 * @mutate src/lib/rentals/errorCopy.ts |   feature_disabled: "Homes isn't open for your account yet.", |   feature_disabled: "Rentals isn't open for your account yet.",
 * @mutate src/pages/rentals/RentalsPage.tsx | label="Loading Homes" | label="Loading your rentals"
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["src", "supabase/functions"];
const SECTION_WORD = /\bRentals\b|\b[Yy]our rentals\b/;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "tests") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/** Arguments to console/log calls never reach a member's screen. */
function isLogArgument(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const c = p.expression;
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "console") return true;
    }
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

export function findSectionWord(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const check = (node: ts.Node, text: string) => {
    if (!SECTION_WORD.test(text)) return;
    if (isLogArgument(node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push(`${path.relative(ROOT, fileName)}:${line + 1}: ${text.trim().slice(0, 120)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text);
    else if (ts.isJsxText(node)) check(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("the section is called Homes in everything a member reads", () => {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);

  it("reads a real inventory, including the Homes screens", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("RentalsHomeView.tsx"))).toBe(true);
  });

  it("the detector sees the section word in copy and ignores identifiers and keys", () => {
    expect(findSectionWord("a.tsx", 'const x = <h1>Rentals</h1>;')).toHaveLength(1);
    expect(findSectionWord("a.ts", 'const x = "Loading your rentals";')).toHaveLength(1);
    expect(findSectionWord("a.ts", 'const x = `Open Rentals now`;')).toHaveLength(1);
    expect(findSectionWord("a.ts", 'const RentalsPage = useFeature("rentals"); const k = ["rentals-home"]; const r = "/rentals/invite";')).toHaveLength(0);
    expect(findSectionWord("a.ts", 'const x = "Rental repair."; const y = "Party rentals";')).toHaveLength(0);
  });

  it("no source file shows 'Rentals' as the section name", () => {
    const hits = files.flatMap((f) => findSectionWord(f, readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
