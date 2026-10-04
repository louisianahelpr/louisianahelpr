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
 * (removed with Finish Paying, 2026-09-27) even carried the comment that made it happen: "functions.invoke reports a
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
 *   C. (Q631) the invoke error is thrown raw (`if (error) throw error`) and the
 *      enclosing catch never reads the function's body. admin DeleteUserDialog
 *      toasted `userFacingError(err, "Couldn't delete that account")` over
 *      admin-delete-user's 409 explaining the active job / held escrow; 19 such
 *      sites on 2026-09-27. Fix: `throw await functionInvokeError(error)`.
 *
 * @mutate src/pages/post-job/useJobSubmit.ts | (paymentError ? await functionErrorMessage(paymentError, "Payment setup failed") : "Payment setup failed") | (paymentError?.message ?? "Payment setup failed")
 * @mutate src/components/admin/DeleteUserDialog.tsx | if (error) throw await functionInvokeError(error); | if (error) throw error;
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
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

  // Shape C (Q631) — the invoke error itself is thrown raw. Whatever catches it
  // sees only "Edge Function returned a non-2xx status code"; `userFacingError`
  // then prints its generic fallback and the server's sentence is lost. Fine
  // only when the enclosing catch recovers the body (functionErrorMessage /
  // functionErrorBody of the caught value, or any `.context` read), or has no
  // binding at all (it deliberately discards the error). A raw throw with no
  // enclosing try escapes to an unknown caller and is a finding too.
  const visitC = (n: ts.Node, names: Set<string>) => {
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && isInvoke(n.initializer, sf)) {
      for (const el of n.name.elements) if ((el.propertyName ?? el.name).getText(sf) === "error") names.add(el.name.getText(sf));
    }
    if (ts.isThrowStatement(n) && n.expression && ts.isIdentifier(n.expression) && names.has(n.expression.text)) {
      let child: ts.Node = n;
      let p: ts.Node | undefined = n.parent;
      let verdict = "is thrown raw with no enclosing try";
      while (p && !ts.isFunctionLike(p)) {
        if (ts.isTryStatement(p) && p.tryBlock === child && p.catchClause) {
          const v = p.catchClause.variableDeclaration;
          if (!v) verdict = "";
          else {
            const c = v.name.getText(sf);
            const body = p.catchClause.block.getText(sf);
            verdict = new RegExp(`functionError(?:Message|Body)\\(\\s*${c}\\b`).test(body) || /\.context\b/.test(body)
              ? ""
              : `is thrown raw and the catch (${c}) never reads the function's body`;
          }
          break;
        }
        child = p;
        p = p.parent;
      }
      if (verdict) at(n, `throw ${n.expression.text} ${verdict}; use \`throw await functionInvokeError(${n.expression.text})\``);
    }
    ts.forEachChild(n, (c) => visitC(c, ts.isFunctionLike(c) ? new Set(names) : names));
  };
  visitC(sf, new Set());
  return out;
}

describe("an edge function's refusal reaches the user in its own words (run 35813177418)", () => {
  it("the detector sees both original shapes, and not the fix", () => {
    const a = `async function f() { const { data, error } = await supabase.functions.invoke("create-payment", {}); const m = data?.error || error?.message; toast.error(m); }`;
    expect(findRawFunctionErrors("a.ts", a)).toHaveLength(1);
    const b = `async function g() { try { const { data, error } = await supabase.functions.invoke("x", {}); if (error) throw error; } catch (err) { const msg = err instanceof Error ? err.message : "x"; toast.error(msg); } }`;
    // Shape B, and (since the catch never reads the body) shape C as well.
    expect(findRawFunctionErrors("b.ts", b)).toHaveLength(2);
    const fixed = `async function h() { try { const { data, error } = await supabase.functions.invoke("x", {}); if (error) throw new Error(await functionErrorMessage(error, "x")); } catch (err) { toast.error(err instanceof Error ? err.message : "x"); } }`;
    expect(findRawFunctionErrors("c.ts", fixed)).toHaveLength(0);
  });

  it("shape C (Q631): a raw throw is caught unless the catch reads the body", () => {
    const raw = `async function d() { try { const { error } = await supabase.functions.invoke("admin-delete-user", {}); if (error) throw error; } catch (err) { toast.error(userFacingError(err, "Couldn't delete")); } }`;
    expect(findRawFunctionErrors("d.ts", raw)).toHaveLength(1);
    const noTry = `async function e() { const { error } = await supabase.functions.invoke("x", {}); if (error) throw error; }`;
    expect(findRawFunctionErrors("e.ts", noTry)).toHaveLength(1);
    const fixed = raw.replace("throw error;", "throw await functionInvokeError(error);");
    expect(findRawFunctionErrors("f.ts", fixed)).toHaveLength(0);
    const readsBody = `async function g() { try { const { error } = await supabase.functions.invoke("x", {}); if (error) throw error; } catch (err) { toast.error(await functionErrorMessage(err, "x")); } }`;
    expect(findRawFunctionErrors("g.ts", readsBody)).toHaveLength(0);
    const discards = `async function h() { try { const { error } = await supabase.functions.invoke("x", {}); if (error) throw error; } catch { return null; } }`;
    expect(findRawFunctionErrors("h.ts", discards)).toHaveLength(0);
    // A throw inside the CATCH is not caught by that try.
    const inCatch = `async function i() { const { error } = await supabase.functions.invoke("x", {}); try { foo(); } catch (e) { throw error; } }`;
    expect(findRawFunctionErrors("i.ts", inCatch)).toHaveLength(1);
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
