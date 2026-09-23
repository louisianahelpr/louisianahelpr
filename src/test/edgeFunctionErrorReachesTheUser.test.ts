/// <reference types="node" />
/**
 * NO USER READS "Edge Function returned a non-2xx status code".
 *
 * THE BUG THIS IS THE CLASS OF. press-every-control run 35813177418, /post-job
 * (poster): "Finish Paying" raised the toast
 *
 *   Couldn't start payment: Edge Function returned a non-2xx status code.
 *   The job is still here — try again.
 *
 * `create-payment` had answered 429 with `{ error: "Too many requests. Please
 * try again later." }` — a sentence written for a person — and the client
 * printed supabase-js's transport wrapper instead. `useFundExistingJob.ts`
 * even carried the comment that made it happen: "functions.invoke reports a
 * handled edge error in `data.error`". It does not, for any non-2xx: `data` is
 * null and `error` is a FunctionsHttpError whose `.message` is that generic
 * line. The server's words live in `error.context` (the Response), which is
 * what `functionErrorMessage()` (src/lib/supabaseResult.ts) reads.
 *
 * Same run, /admin?view=jobs: "Refund Poster › Issue Refund" on a paid-out job
 * got a 409 whose body explains that a full refund after a payout would spend
 * the escrow twice. AdminJobs threw the invoke error and toasted `err.message`
 * — the admin would have read the same non-sentence.
 *
 * TWO SHAPES, both from the TypeScript AST of every file in src/ that calls
 * `functions.invoke` (so a new call site is covered the day it lands):
 *
 *   A. the invoke's destructured `error` has its `.message` read directly;
 *   B. a try block that `throw`s that error, whose catch clause shows
 *      `<caught>.message` to the user (toast / setError / new Error) without
 *      passing it through `userFacingError` or `functionErrorMessage`.
 *
 * The fix in both shapes is `functionErrorMessage(error, fallback)`.
 *
 * @mutate src/hooks/useFundExistingJob.ts | (error ? await functionErrorMessage(error, "Payment setup failed") : "Payment setup failed") | (error?.message ?? "Payment setup failed")
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const isInvoke = (e: ts.Expression | undefined, sf: ts.SourceFile): boolean => {
  if (!e) return false;
  const x = ts.isAwaitExpression(e) ? e.expression : e;
  return ts.isCallExpression(x) && /\.functions\.invoke$/.test(x.expression.getText(sf));
};

function findRawFunctionErrors(file: string, src: string): string[] {
  if (!src.includes("functions.invoke")) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const at = (n: ts.Node, what: string) =>
    out.push(`${path.relative(ROOT, file) || file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${what}`);

  /** Visit `scope`'s own statements, never descending into a nested function (it is visited on its own). */
  const own = (scope: ts.Node, fn: (n: ts.Node) => void) => {
    const v = (n: ts.Node) => { fn(n); ts.forEachChild(n, (c) => { if (!ts.isFunctionLike(c)) v(c); }); };
    ts.forEachChild(scope, (c) => { if (!ts.isFunctionLike(c)) v(c); });
  };
  /** Names bound to an invoke's `error` in `scope` itself. */
  const invokeErrorNames = (scope: ts.Node): Set<string> => {
    const names = new Set<string>();
    own(scope, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && isInvoke(n.initializer, sf)) {
        for (const el of n.name.elements) if ((el.propertyName ?? el.name).getText(sf) === "error") names.add(el.name.getText(sf));
      }
    });
    return names;
  };

  // Shape A — `<invokeError>.message`, anywhere in the enclosing function.
  const visitA = (n: ts.Node) => {
    if (ts.isFunctionLike(n)) {
      const names = invokeErrorNames(n);
      if (names.size) {
        own(n, (x) => {
          if (ts.isPropertyAccessExpression(x) && x.name.text === "message" && names.has(x.expression.getText(sf))) {
            at(x, `reads ${x.getText(sf)} (the SDK's transport wrapper, not the function's words)`);
          }
        });
      }
    }
    ts.forEachChild(n, visitA);
  };
  visitA(sf);

  // Shape B — throw the invoke error, show `<caught>.message` in the catch.
  const visitB = (n: ts.Node) => {
    if (ts.isTryStatement(n) && n.catchClause?.variableDeclaration) {
      const names = new Set<string>();
      own(n.tryBlock, (x) => {
        if (ts.isVariableDeclaration(x) && ts.isObjectBindingPattern(x.name) && isInvoke(x.initializer, sf)) {
          for (const el of x.name.elements) if ((el.propertyName ?? el.name).getText(sf) === "error") names.add(el.name.getText(sf));
        }
      });
      let throwsIt = false;
      const t = (x: ts.Node) => {
        if (ts.isThrowStatement(x) && x.expression && ts.isIdentifier(x.expression) && names.has(x.expression.text)) throwsIt = true;
        ts.forEachChild(x, t);
      };
      t(n.tryBlock);
      const caught = n.catchClause.variableDeclaration.name.getText(sf);
      const body = n.catchClause.block.getText(sf);
      if (
        throwsIt &&
        new RegExp(`\\b${caught}\\.message\\b`).test(body) &&
        /toast|setError|new Error\(/.test(body) &&
        !/userFacingError|functionErrorMessage/.test(body)
      ) {
        at(n.catchClause, `throws the invoke error and shows ${caught}.message`);
      }
    }
    ts.forEachChild(n, visitB);
  };
  visitB(sf);
  return out;
}

describe("an edge function's refusal reaches the user in its own words (run 35813177418)", () => {
  it("the detector sees both original shapes, and not the fix", () => {
    const a = `async function f() { const { data, error } = await supabase.functions.invoke("create-payment", {}); const m = data?.error || error?.message; toast.error(m); }`;
    expect(findRawFunctionErrors("a.ts", a)).toHaveLength(1);
    const b = `async function g() { try { const { data, error } = await supabase.functions.invoke("x", {}); if (error) throw error; } catch (err) { const msg = err instanceof Error ? err.message : "x"; toast.error(msg); } }`;
    expect(findRawFunctionErrors("b.ts", b)).toHaveLength(1);
    const fixed = `async function h() { try { const { data, error } = await supabase.functions.invoke("x", {}); if (error) throw new Error(await functionErrorMessage(error, "x")); } catch (err) { toast.error(err instanceof Error ? err.message : "x"); } }`;
    expect(findRawFunctionErrors("c.ts", fixed)).toHaveLength(0);
  });

  it("no call site in src/ shows supabase-js's wrapper instead of the function's error", () => {
    const files = walk(path.join(ROOT, "src"));
    // Floor: 50 files call functions.invoke on 2026-09-22. If the scan stops
    // finding them it is checking nothing.
    expect(files.filter((f) => fs.readFileSync(f, "utf8").includes("functions.invoke")).length).toBeGreaterThan(40);
    const hits = files.flatMap((f) => findRawFunctionErrors(f, fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
