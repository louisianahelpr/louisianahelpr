/**
 * Q761 — nine `.withTags([...])` axe calls across e2e specs hardcoded the
 * wcag21aa-family tag literal `["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]`
 * instead of importing the ONE shared `AXE_TAGS` constant
 * (e2e/happy-path/axeTags.ts). axeGateCoversWcag22aa.test.ts already guards
 * two specific files (sweepCore.ts, fixtures.ts) named by Q181; this guard
 * covers every OTHER e2e file so a new spec — or one of the nine that
 * regresses — cannot reintroduce a private array literal undetected.
 *
 * THE CLASS: any `.withTags(<array literal>)` call anywhere under e2e/,
 * except inside axeTags.ts itself (which legitimately owns the one literal
 * AXE_TAGS is built from). Found via the TypeScript AST — a call whose
 * argument is an ArrayLiteralExpression — not a text/regex match, so a
 * commented-out example or a string containing the words "withTags" can't
 * produce a false positive or false negative.
 *
 * Proven able to fail: the RED test below re-parses a real spec's source
 * with `.withTags(AXE_TAGS)` swapped back for the original hardcoded
 * four-tag array and shows the scan flags it.
 */
// @mutate e2e/happy-path/home-chrome.spec.ts | .withTags(AXE_TAGS) | .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(__dirname, "../..");
const E2E = join(ROOT, "e2e");
const AXE_TAGS_FILE = join(E2E, "happy-path", "axeTags.ts");

function listE2eFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listE2eFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

export type WithTagsLiteralUse = { file: string; line: number };

/** Every `.withTags(<array literal>)` call in one file's source, by AST. */
export function findWithTagsArrayLiterals(file: string, source: string): WithTagsLiteralUse[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: WithTagsLiteralUse[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "withTags" &&
      node.arguments.length > 0 &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      out.push({ file: relative(ROOT, file).split("\\").join("/"), line });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("every .withTags() call outside axeTags.ts uses the shared AXE_TAGS constant (Q761)", () => {
  const files = listE2eFiles(E2E).filter((f) => f !== AXE_TAGS_FILE);
  const uses = files.flatMap((f) => findWithTagsArrayLiterals(f, readFileSync(f, "utf8")));

  it("inventories .withTags() call sites across e2e/ (a broken extractor must not pass vacuously)", () => {
    const withTagsCallCount = files
      .map((f) => (readFileSync(f, "utf8").match(/\.withTags\(/g) || []).length)
      .reduce((a, b) => a + b, 0);
    expect(withTagsCallCount).toBeGreaterThan(5);
  });

  it("no .withTags() call outside axeTags.ts passes a hardcoded array literal", () => {
    const bad = uses.map((u) => `${u.file}:${u.line}`);
    expect(bad).toEqual([]);
  });

  it("RED on the exact Q761 defect: a private four-tag literal reintroduced in a real spec", () => {
    const file = join(E2E, "happy-path", "home-chrome.spec.ts");
    const src = readFileSync(file, "utf8");
    const broken = src.replace(
      /\.withTags\(AXE_TAGS\)/,
      '.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])',
    );
    expect(broken).not.toEqual(src); // the replacement must actually have matched something
    const found = findWithTagsArrayLiterals(file, broken);
    expect(found.length).toBeGreaterThan(0);
  });
});
