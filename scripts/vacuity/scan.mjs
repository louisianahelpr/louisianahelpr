/**
 * STATIC VACUITY SCAN — the part that needs no registration and therefore
 * works on all 132 guards from day one.
 *
 * It answers one question per class, and only questions a parser can answer
 * honestly. Where a parser cannot decide (class (e), literal-scan vs
 * semantic), it says so and defers to the mutation runner rather than
 * inventing a heuristic verdict.
 *
 *   (a) EMPTY-INVENTORY.  A guard that reads the world, iterates what it
 *       found, and asserts per member is GREEN when it found nothing.
 *       `expect(offenders).toEqual([])` is one executed assertion and zero
 *       proof. Detector: corpus read + iteration/offender-list, and nowhere
 *       in the file an assertion that the corpus is non-empty.
 *       Fix: one line — expect(FILES.length).toBeGreaterThan(<floor>).
 *
 *   (b) MOUNT-WIRING.  A component test that renders the component itself
 *       proves the component works, never that anything mounts it. Detector:
 *       import graph over src/** — for each component under test, are any of
 *       its PARENTS rendered by any test anywhere?
 *
 *   (d) SELF-REFERENTIAL INVENTORY.  A hand-written list in the test file
 *       that is both the input and the oracle. Detector: iteration over a
 *       literal declared in the test, whose assertions reference nothing but
 *       that literal.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { REPO, read, guardFiles, edgeGuardFiles } from "./lib.mjs";

const parse = (rel, src) =>
  ts.createSourceFile(rel, src ?? read(rel), ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Calls that reach outside the test file for their inventory. */
const WORLD = new Set([
  "readdirSync", "readdir", "globSync", "glob", "walk", "walkSync",
  "execFileSync", "execSync", "readFileSync", "statSync", "existsSync",
]);

/** Matchers that constitute a FLOOR — proof the inventory was not empty. */
const FLOOR = new Set([
  "toBeGreaterThan", "toBeGreaterThanOrEqual",
]);
const LEN_MATCH = new Set(["toHaveLength", "toBe", "toEqual", "toBeCloseTo"]);

const name = (n) =>
  ts.isIdentifier(n) ? n.text : ts.isPropertyAccessExpression(n) ? n.name.text : "";

function walk(node, fn) {
  fn(node);
  node.forEachChild((c) => walk(c, fn));
}

/** Unwrap `expect(X).not.toFoo(a)` / `expect(X).resolves.toFoo(a)` into {arg, matcher, args, negated}. */
function asExpectCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const matcher = node.expression.name.text;
  let recv = node.expression.expression;
  let negated = false;
  while (ts.isPropertyAccessExpression(recv) && ["not", "resolves", "rejects"].includes(recv.name.text)) {
    if (recv.name.text === "not") negated = !negated;
    recv = recv.expression;
  }
  if (!ts.isCallExpression(recv) || name(recv.expression) !== "expect") return null;
  return { subject: recv.arguments[0], matcher, args: node.arguments, negated };
}

function num(n) {
  if (!n) return null;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isPrefixUnaryExpression(n) && ts.isNumericLiteral(n.operand)) return -Number(n.operand.text);
  return null;
}

/** Is this expression a size/length read? */
const isSizeRead = (n) =>
  n && ts.isPropertyAccessExpression(n) && (n.name.text === "length" || n.name.text === "size");

/** `src` overrides the on-disk text — used by the gate's own self-test. */
export function scanGuard(rel, src) {
  const sf = parse(rel, src);
  const res = {
    file: rel,
    worldReads: 0,
    iterations: 0,
    offenderAsserts: 0,
    floors: [],
    selfReferential: [],
    literalBindings: new Map(), // name -> declared-in-test array/object literal
  };

  walk(sf, (n) => {
    if (ts.isCallExpression(n) && WORLD.has(name(n.expression))) res.worldReads++;

    // iteration shapes
    if (ts.isForOfStatement(n) && !ts.isArrayLiteralExpression(n.expression)) res.iterations++;
    if (ts.isCallExpression(n) && ["forEach", "flatMap"].includes(name(n.expression))) res.iterations++;
    if (ts.isCallExpression(n) && ts.isCallExpression(n.expression) && name(n.expression.expression).endsWith("each"))
      res.iterations++;

    // literal registries declared in the test itself
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      if (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init))
        res.literalBindings.set(n.name.text, init.getStart(sf));
    }

    const e = asExpectCall(n);
    if (!e) return;

    // FLOOR: expect(X.length).toBeGreaterThan(n) / toBe(n>0) / expect(X).toHaveLength(n>0)
    //        expect(X).not.toHaveLength(0) / expect(X).not.toEqual([])
    const v = num(e.args[0]);
    if (isSizeRead(e.subject)) {
      if (FLOOR.has(e.matcher) && !e.negated) res.floors.push(`${e.subject.getText(sf)} ${e.matcher}`);
      else if (LEN_MATCH.has(e.matcher) && !e.negated && v !== null && v > 0)
        res.floors.push(`${e.subject.getText(sf)} ${e.matcher}(${v})`);
    } else if (e.matcher === "toHaveLength") {
      if (!e.negated && v !== null && v > 0) res.floors.push(`${e.subject.getText(sf)} toHaveLength(${v})`);
      if (e.negated && v === 0) res.floors.push(`${e.subject.getText(sf)} not.toHaveLength(0)`);
    }

    // OFFENDER-LIST shape — the one that most needs a corpus floor
    if (!e.negated && ["toEqual", "toStrictEqual"].includes(e.matcher)) {
      const a = e.args[0];
      if (a && ts.isArrayLiteralExpression(a) && a.elements.length === 0) res.offenderAsserts++;
      if (a && ts.isObjectLiteralExpression(a) && a.properties.length === 0) res.offenderAsserts++;
    }
  });

  // (d) self-referential: iterate a literal declared here, assert only about it
  walk(sf, (n) => {
    let src = null, body = null, elem = null;
    if (ts.isForOfStatement(n) && ts.isIdentifier(n.expression)) {
      src = n.expression.text; body = n.statement;
      if (ts.isVariableDeclarationList(n.initializer) && ts.isIdentifier(n.initializer.declarations[0].name))
        elem = n.initializer.declarations[0].name.text;
    } else if (
      ts.isCallExpression(n) && name(n.expression) === "forEach" &&
      ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression)
    ) {
      src = n.expression.expression.text; body = n.arguments[0];
      const p = n.arguments[0]?.parameters?.[0];
      if (p && ts.isIdentifier(p.name)) elem = p.name.text;
    }
    if (!src || !body || !res.literalBindings.has(src)) return;

    const idsInAsserts = new Set();
    let sawAssert = false;
    walk(body, (m) => {
      const e = asExpectCall(m);
      if (!e) return;
      sawAssert = true;
      for (const a of [e.subject, ...e.args]) {
        if (!a) continue;
        walk(a, (x) => { if (ts.isIdentifier(x)) idsInAsserts.add(x.text); });
      }
    });
    if (!sawAssert) return;
    const foreign = [...idsInAsserts].filter(
      (i) => i !== src && i !== elem && !/^(expect|Object|Array|String|Number|Set|Map|JSON|Math|toBe|length)$/.test(i),
    );
    if (foreign.length === 0)
      res.selfReferential.push(`${src} (literal declared in this file) is both input and oracle`);
  });

  res.inventoryDriven = res.worldReads > 0 && (res.iterations > 0 || res.offenderAsserts > 0);
  res.classA = res.inventoryDriven && res.floors.length === 0;
  res.classD = res.selfReferential.length > 0;
  return res;
}

// ── (b) mount-wiring: import graph over src/** ───────────────────────────────
function srcFiles() {
  const out = [];
  const stack = [path.join(REPO, "src")];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.tsx?$/.test(e.name)) out.push(path.relative(REPO, p).split(path.sep).join("/"));
    }
  }
  return out;
}

const isTest = (f) => /\.(test|spec)\.tsx?$/.test(f);

/** Components a file RENDERS as JSX (not merely imports). */
function renderedComponents(rel) {
  const sf = parse(rel);
  const out = new Set();
  walk(sf, (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const t = n.tagName.getText(sf);
      if (/^[A-Z]/.test(t)) out.add(t.split(".")[0]);
    }
  });
  return out;
}

function importedLocal(rel) {
  const sf = parse(rel);
  const map = new Map(); // localName -> resolved repo-relative file (best effort)
  walk(sf, (n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) return;
    let spec = n.moduleSpecifier.text;
    if (spec.startsWith("@/")) spec = "src/" + spec.slice(2);
    else if (spec.startsWith(".")) spec = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    else return;
    const resolved = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]
      .map((ext) => spec + ext)
      .find((p) => fs.existsSync(path.join(REPO, p)) && fs.statSync(path.join(REPO, p)).isFile());
    if (!resolved) return;
    const c = n.importClause;
    if (!c) return;
    if (c.name) map.set(c.name.text, resolved);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings))
      for (const s of c.namedBindings.elements) map.set(s.name.text, resolved);
  });
  return map;
}

export function scanMountWiring() {
  const all = srcFiles();
  const tests = all.filter(isTest);
  const prod = all.filter((f) => !isTest(f));

  // who mounts whom, in PRODUCTION code
  const mountedBy = new Map(); // module -> Set(parent modules)
  for (const f of prod) {
    const imports = importedLocal(f);
    for (const tag of renderedComponents(f)) {
      const target = imports.get(tag);
      if (!target || target === f) continue;
      if (!mountedBy.has(target)) mountedBy.set(target, new Set());
      mountedBy.get(target).add(f);
    }
  }

  // which modules any test renders
  const renderedByTests = new Map(); // module -> Set(test files)
  for (const t of tests) {
    const imports = importedLocal(t);
    for (const tag of renderedComponents(t)) {
      const target = imports.get(tag);
      if (!target) continue;
      if (!renderedByTests.has(target)) renderedByTests.set(target, new Set());
      renderedByTests.get(target).add(t);
    }
  }

  const findings = [];
  for (const [mod, testSet] of renderedByTests) {
    const parents = mountedBy.get(mod);
    if (!parents || parents.size === 0) continue; // a root/route: nothing mounts it
    const anyParentCovered = [...parents].some((p) => {
      if (renderedByTests.has(p)) return true;
      const gp = mountedBy.get(p);
      return gp && [...gp].some((g) => renderedByTests.has(g));
    });
    if (!anyParentCovered)
      findings.push({ module: mod, tests: [...testSet], parents: [...parents] });
  }
  return findings.sort((a, b) => a.module.localeCompare(b.module));
}

export function scanAll() {
  const guards = guardFiles();
  const edge = edgeGuardFiles();
  return {
    // NOT `.map(scanGuard)`: Array.map passes (el, index, array), so the
    // index would arrive as the `src` override and every parse would blow up.
    guards: guards.map((g) => scanGuard(g)),
    edge: edge.map((g) => scanGuard(g)),
    mount: scanMountWiring(),
  };
}
