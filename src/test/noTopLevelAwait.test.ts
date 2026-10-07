/**
 * CLASS GUARD: no TOP-LEVEL await anywhere in the app's source.
 *
 * A top-level await makes its module, and every module that imports it, an
 * async module. On iOS that reordered how Rollup's shared chunks evaluate:
 * a chunk ran before a chunk it imports had finished. A build of main crashed
 * on /browse ("undefined is not an object (evaluating 'l.displayName')"), a
 * Debug build never left #boot-loader, and TestFlight 7115 run on a Mac froze
 * on the H (2026-10-06). The one offender was client.ts's
 * `await hydratePromise`; the wait now lives in keychainStorageAdapter.getItem.
 *
 * Inventory from source: every non-test .ts/.tsx under src/, parsed with the
 * TypeScript compiler; an `await` (or `for await`) whose nearest enclosing
 * function is none is a top-level await.
 *
 * @mutate src/integrations/supabase/client.ts | import { keychainStorageAdapter } from './keychainStorageAdapter'; | import { keychainStorageAdapter, hydratePromise } from './keychainStorageAdapter';\nif (Capacitor.isNativePlatform()) { await hydratePromise; }
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { trackedFiles } from "./helpers/trackedFiles";

function topLevelAwaits(file: string, text: string): number[] {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.(m?js|jsx)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines: number[] = [];
  const visit = (node: ts.Node, inFn: boolean) => {
    const fn = ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
    const isAwait =
      ts.isAwaitExpression(node) ||
      (ts.isForOfStatement(node) && !!node.awaitModifier) ||
      // `await using x = ...` is a declaration, not an AwaitExpression.
      (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing);
    if (isAwait && !inFn) lines.push(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, (c) => visit(c, inFn || fn));
  };
  visit(sf, false);
  return lines;
}

describe("no top-level await in src (iOS chunk-order class, 2026-10-06)", () => {
  // .js/.mjs too: src/lib/publicPageMeta.mjs is bundled into the auth pages.
  const files = trackedFiles("src").filter((f) => /\.(ts|tsx|js|mjs|jsx)$/.test(f) && !/\.(test|spec)\.[jt]sx?$/.test(f) && !/\.(test|spec)\.mjs$/.test(f) && !f.startsWith("src/test/"));
  it("inventories the source (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
  });
  it("the detector sees the shape it names (synthetic)", () => {
    expect(topLevelAwaits("x.ts", "if (a) { await b; }\nasync function f() { await c; }\nconst g = async () => { await d; };")).toEqual([1]);
    expect(topLevelAwaits("y.ts", "await using r = getRes();")).toEqual([1]);
    expect(topLevelAwaits("z.mjs", "export const a = await f();")).toEqual([1]);
  });
  it("no source file has a top-level await", () => {
    const hits = files.flatMap((f) => topLevelAwaits(f, readFileSync(f, "utf8")).map((l) => `${f}:${l}`));
    expect(hits).toEqual([]);
  });
});
