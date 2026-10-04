/**
 * CLASS GUARD (docs/OPEN.md Q1142): a test never lists src/ from the disk.
 *
 * vacuityGate.test.ts writes src/test/fixtures/q136Control-*.ts for a few
 * milliseconds (it must sit in an ordinary src/ folder to prove Tailwind scans
 * it). A test that listed the tree with readdirSync and read what it listed
 * threw ENOENT when the file vanished: retiredApprovalReads.test.ts, 2026-10-03,
 * a local 2-thread run. threeDSecureOnLargeCharges.test.ts had already fixed its
 * own copy with `git ls-files`. The fix is at the source: src/test/helpers/
 * trackedFiles.ts exports a readdirSync that lists a directory under src/ from
 * the git index (anything else passes through), and every test that walked src/
 * imports it instead of node:fs's.
 *
 * Inventory from source: every test file (*.test.ts[x]) and every file under
 * src/test/, comments blanked. One is an offender when it takes readdirSync from
 * node:fs (named import, or `x.readdirSync` on a namespace/default import) AND
 * names a src root: a "src" / "src/..." string, SRC / SRC_DIR / srcDir, or
 * __dirname climbing to ".." (src/test's parent). The scan is a heuristic about
 * the ROOT, so a walk that builds its root some other way is not seen; the
 * runtime proof is the transient-fixture test below, and a directory that is not
 * src/ (supabase/migrations, .github/workflows) may keep the raw call.
 */
// @mutate src/test/helpers/trackedFiles.ts |     return files.has(child) \|\| dirs.has(child); |     return true;
// @mutate src/test/retiredApprovalReads.test.ts | import { readdirSync } from "./helpers/trackedFiles"; | import { readdirSync } from "node:fs";
// @mutate src/test/helpers/walkSource.ts | import { readdirSync } from "./trackedFiles"; | import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync as trackedReaddir, trackedFiles } from "./helpers/trackedFiles";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

/** Does the file take readdirSync from node:fs: a named import (aliased or not), or `x.readdirSync` on a namespace/default import? Parsed, so fixture strings that merely contain an import do not count. */
export function takesRawReaddir(source: string): boolean {
  const sf = ts.createSourceFile("t.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const namespaces = new Set<string>();
  let raw = false;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !/^(node:)?fs$/.test(st.moduleSpecifier.text)) continue;
    const ic = st.importClause;
    if (!ic) continue;
    if (ic.name) namespaces.add(ic.name.text);
    const nb = ic.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) namespaces.add(nb.name.text);
    if (nb && ts.isNamedImports(nb) && nb.elements.some((e) => (e.propertyName ?? e.name).text === "readdirSync")) raw = true;
  }
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "readdirSync" && ts.isIdentifier(n.expression) && namespaces.has(n.expression.text)) raw = true;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return raw;
}
const NAMES_SRC_ROOT =
  /["'`]src["'`]|["'`]src\/|(?<![\w$])(?:SRC|SRC_DIR|srcDir|srcRoot)(?![\w$])|(?:__dirname|import\.meta\.dirname)[^)\n]*["'`]\.\.["'`]\s*\)/;

/** Is this test source a raw walk of src/? */
export function walksSrcRaw(source: string): boolean {
  return takesRawReaddir(source) && NAMES_SRC_ROOT.test(blankComments(source));
}

const isTestFile = (f: string) => /\.test\.tsx?$/.test(f) || f.startsWith("src/test/");
const SELF = new Set(["src/test/helpers/trackedFiles.ts", "src/test/noSrcDirectoryWalksInTests.test.ts"]);
const files = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && isTestFile(f) && !SELF.has(f));

describe("Q1142: the detector", () => {
  it("flags a raw walk of src/", () => {
    expect(walksSrcRaw(`import { readdirSync } from "node:fs";\nreaddirSync("src");`)).toBe(true);
    expect(walksSrcRaw(`import { readFileSync, readdirSync } from "fs";\nconst SRC = join(ROOT, "x");`)).toBe(true);
    expect(walksSrcRaw(`import fs from "node:fs";\nfs.readdirSync(join(ROOT, "src/pages"));`)).toBe(true);
    expect(walksSrcRaw(`import * as fs from "node:fs";\nconst d = resolve(__dirname, "..");\nfs.readdirSync(d);`)).toBe(true);
  });

  it("passes the tracked listing, a non-src directory and a comment", () => {
    expect(walksSrcRaw(`import { readdirSync } from "./helpers/trackedFiles";\nreaddirSync("src");`)).toBe(false);
    expect(walksSrcRaw(`import { readdirSync } from "node:fs";\nreaddirSync(join(ROOT, "supabase/migrations"));`)).toBe(false);
    expect(walksSrcRaw(`// import { readdirSync } from "node:fs"; readdirSync("src")\nconst x = 1;`)).toBe(false);
    expect(walksSrcRaw(`import { readFileSync } from "node:fs";\nreadFileSync("src/a.ts");`)).toBe(false);
    // a fixture STRING that contains an import is not an import
    expect(walksSrcRaw("import { readFileSync } from \"node:fs\";\nconst fx = `import { readdirSync } from \"node:fs\"; readdirSync(\"src/lib\")`;")).toBe(false);
  });
});

describe("Q1142: no test lists src/ from the disk", () => {
  it("scans the test files (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("no test file takes a raw readdirSync of src/", () => {
    const offenders = files.filter((f) => walksSrcRaw(readFileSync(join(ROOT, f), "utf8")));
    expect(
      offenders,
      'import { readdirSync } from "<rel>/helpers/trackedFiles" (src/test/helpers/trackedFiles.ts) instead of node:fs: it lists src/ from git, so a transient fixture cannot vanish mid-walk (Q1142)',
    ).toEqual([]);
  });
});

describe("Q1142: a file that exists only for a moment is never listed", () => {
  const dir = join(ROOT, "src", "test", "fixtures");
  const name = `q1142Transient-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;

  it("the shared readdirSync, in all three call shapes, and walkSource", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), "export {};\n");
    try {
      expect(trackedReaddir(dir)).not.toContain(name);
      expect(trackedReaddir(dir, { withFileTypes: true }).map((d) => d.name)).not.toContain(name);
      expect(trackedReaddir(join(ROOT, "src", "test"), { recursive: true })).not.toContain(`fixtures/${name}`);
      expect(walkSource([join(ROOT, "src", "test", "fixtures")]).some((f) => f.endsWith(name))).toBe(false);
      // The control: tracked files in the same directory ARE listed, so this cannot pass by listing nothing.
      expect(trackedReaddir(join(ROOT, "src", "test"))).toContain("helpers");
      expect(trackedReaddir(join(ROOT, "src", "test", "helpers"))).toContain("blankNonCode.ts");
      expect(trackedReaddir(join(ROOT, "supabase", "migrations")).length, "a directory outside src/ passes through").toBeGreaterThan(100);
    } finally {
      rmSync(join(dir, name), { force: true });
    }
  });
});
