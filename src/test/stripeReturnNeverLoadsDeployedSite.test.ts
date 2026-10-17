/// <reference types="node" />
/**
 * EVERY STRIPE PAYER ANSWERS THE RETURN ITSELF (Q1255, class guard).
 *
 * After a hosted Checkout is paid, Stripe navigates the payer to the
 * success URL create-payment built from APP_URL: the DEPLOYED site. A test
 * that lets that navigation through loads production from Vercel on every
 * funding leg (and, signed out, often bounces to /login). Q1255 fixed it for
 * the journeys (payInPageAnsweringReturn / payInChromium); prod-audit's
 * fixture `fund()`, the gift-card spec's payWithTestCard, prod-lifecycle and
 * the mint-funded-seed-jobs probe still let it through (found by sec-c,
 * 2026-10-17). None of them needs the page: the webhook is the authority.
 *
 * THE RULE, derived from the world: every place in e2e/ or scripts/ that
 * presses Stripe's Pay button (`hosted-payment-submit-button`) is ANSWERED:
 *   - its enclosing function, or a function around it, calls
 *     answerStripeReturn / payInPageAnsweringReturn / payInChromium, or
 *     answers the navigation inline (isNavigationRequest + fulfill: the .mjs
 *     probe, which cannot import the .ts helper); or
 *   - that function is named, and EVERY reference to it is either an argument
 *     to payInPageAnsweringReturn / payInChromium or sits in an answered
 *     function (payOnStripeCheckout, submitTestCard).
 * Scanned over the TypeScript AST, so a comment naming the button is not a
 * press and a comment naming the helper is not an answer.
 */
// @mutate e2e/prod-audit/fundedOpenJob.ts |   const answer = await answerStripeReturn(page); |   const answer = { stop: async () => {} };
// @mutate e2e/stripeCheckoutCard.ts |   const stripeReturn = await answerStripeReturn(page); |   const stripeReturn = { stop: async () => {} };
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SUBMIT = "hosted-payment-submit-button";
const WRAPPERS = new Set(["payInPageAnsweringReturn", "payInChromium"]);
const ANSWERS = new Set([...WRAPPERS, "answerStripeReturn"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.git|dist|test-results|playwright-report)$/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.d\.m?ts$/.test(e.name)) out.push(p);
  }
  return out;
}

type Fn = ts.FunctionLikeDeclaration;
interface Source {
  rel: string;
  sf: ts.SourceFile;
}

function load(files: { rel: string; text: string }[]): Source[] {
  return files.map(({ rel, text }) => ({
    rel,
    sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, /\.m?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TSX),
  }));
}

const isFn = (n: ts.Node): n is Fn =>
  ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);

function enclosingFns(n: ts.Node): Fn[] {
  const out: Fn[] = [];
  for (let p = n.parent; p; p = p.parent) if (isFn(p)) out.push(p);
  return out;
}

function calleeName(c: ts.CallExpression): string {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function callsIn(node: ts.Node): string[] {
  const out: string[] = [];
  const v = (x: ts.Node) => {
    if (ts.isCallExpression(x)) out.push(calleeName(x));
    ts.forEachChild(x, v);
  };
  v(node);
  return out;
}

/** The function (or block) itself answers the return. */
function answersDirectly(fn: ts.Node): boolean {
  const calls = callsIn(fn);
  if (calls.some((c) => ANSWERS.has(c))) return true;
  return calls.includes("isNavigationRequest") && calls.includes("fulfill");
}

function fnName(fn: Fn): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

/** Every reference to `name` across the sources that is not its own declaration. */
function referencesTo(name: string, sources: Source[]): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  for (const { sf } of sources) {
    const v = (x: ts.Node) => {
      if (ts.isIdentifier(x) && x.text === name) {
        const p = x.parent;
        const isDecl =
          ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isVariableDeclaration(p)) && p.name === x) ||
          ts.isImportSpecifier(p) ||
          ts.isExportSpecifier(p);
        if (!isDecl) out.push(x);
      }
      ts.forEachChild(x, v);
    };
    v(sf);
  }
  return out;
}

function answered(fn: Fn, sources: Source[], seen = new Set<Fn>()): boolean {
  if (seen.has(fn)) return false;
  seen.add(fn);
  if (answersDirectly(fn)) return true;
  if (enclosingFns(fn).some((outer) => answersDirectly(outer))) return true;
  const name = fnName(fn);
  if (!name) return false;
  const refs = referencesTo(name, sources);
  if (!refs.length) return false;
  return refs.every((ref) => {
    const p = ref.parent;
    if (ts.isCallExpression(p) && p.arguments.includes(ref as ts.Expression) && WRAPPERS.has(calleeName(p))) return true;
    const around = enclosingFns(ref);
    return around.length > 0 && around.some((outer) => answered(outer, sources, seen));
  });
}

export function unansweredPayers(sources: Source[]): { sites: string[]; unanswered: string[] } {
  const sites: string[] = [];
  const unanswered: string[] = [];
  for (const { rel, sf } of sources) {
    const v = (x: ts.Node) => {
      if ((ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) && x.text === SUBMIT) {
        const at = `${rel}:${sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1}`;
        sites.push(at);
        // A press at module top level (an .mjs probe's top-level await) has
        // no function around it: the blocks around it are its scope.
        const blocks: ts.Node[] = [];
        for (let p = x.parent; p && !ts.isSourceFile(p); p = p.parent) if (ts.isBlock(p) || isFn(p)) blocks.push(p);
        const fn = enclosingFns(x)[0];
        const ok = blocks.some((b) => answersDirectly(b)) || (!!fn && answered(fn, sources));
        if (!ok) unanswered.push(at);
      }
      ts.forEachChild(x, v);
    };
    v(sf);
  }
  return { sites, unanswered };
}

const WORLD = load(
  [...walk(path.join(ROOT, "e2e")), ...walk(path.join(ROOT, "scripts"))].map((f) => ({
    rel: path.relative(ROOT, f),
    text: fs.readFileSync(f, "utf8"),
  })),
);

describe("Q1255 — a Stripe payer never loads the deployed site on the return", () => {
  const { sites, unanswered } = unansweredPayers(WORLD);

  it("found the Pay presses (inventory floor)", () => {
    // fixtures.ts, stripeCheckoutCard.ts, fundedOpenJob.ts, prod-lifecycle.spec.ts,
    // mint-funded-seed-jobs.prod.mjs on 2026-10-17.
    expect(sites.length).toBeGreaterThan(4);
  });

  it("every press of Stripe's Pay button has the return answered", () => {
    expect(unanswered, `these press Pay with Stripe's return to the deployed site let through:\n${unanswered.join("\n")}`).toEqual([]);
  });
});

describe("the check is able to fail", () => {
  const press = `await page.getByTestId("${SUBMIT}").click();`;

  it("red for a payer that answers nothing, and for one only ever called unanswered", () => {
    const world = load([
      { rel: "a.ts", text: `export async function pay(page) { await page.goto(u); ${press} }` },
      { rel: "b.ts", text: `async function inner(page) { ${press} }\nexport async function outer(page) { await inner(page); }` },
      { rel: "top.mjs", text: `for (const u of us) { await page.goto(u); ${press} }` },
    ]);
    expect(unansweredPayers(world).unanswered).toEqual(["a.ts:1", "b.ts:1", "top.mjs:1"]);
  });

  it("green for each answered shape", () => {
    const world = load([
      { rel: "direct.ts", text: `export async function pay(page) { const a = await answerStripeReturn(page); ${press} await a.stop(); }` },
      { rel: "passed.ts", text: `async function onPage(page) { ${press} }\nexport const go = (p) => payInPageAnsweringReturn(p, onPage);` },
      { rel: "caller.ts", text: `async function submit(page) { ${press} }\nexport async function pay(page) { const a = await answerStripeReturn(page); await submit(page); }` },
      { rel: "inline.mjs", text: `async function pay(page) { await page.route("**/*", async (r) => { if (r.request().isNavigationRequest()) return r.fulfill({}); }); ${press} }` },
      { rel: "top-inline.mjs", text: `for (const u of us) { await page.route("**/*", (r) => r.request().isNavigationRequest() ? r.fulfill({}) : r.fallback()); ${press} }` },
      { rel: "comment.ts", text: `// "${SUBMIT}" in a comment is not a press` },
    ]);
    expect(unansweredPayers(world)).toEqual({
      sites: ["direct.ts:1", "passed.ts:1", "caller.ts:1", "inline.mjs:1", "top-inline.mjs:1"],
      unanswered: [],
    });
  });
});
