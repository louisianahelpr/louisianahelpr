/**
 * Every React Query query function in src/, and every function it can reach
 * (docs/OPEN.md Q1182).
 *
 * WHY. The read-retry policy (src/lib/queryRetry.ts) decides from the HTTP
 * status. postgrest-js keeps that status on the RESPONSE (`{ data, error,
 * status }`), never on `error`, and `unwrap()` (src/lib/supabaseResult.ts) is
 * what copies it across. A query function that throws the Supabase error object
 * itself (`if (error) throw error`, `throw res.error`) hands React Query an
 * error with no status. For most reads the PostgREST `code` still lets the
 * policy map one, but a HEAD count (`select(..., { head: true })`) has no body,
 * so postgrest-js builds `{ message: "" }`: no code, no status, and a refused
 * count is sent twice (useDashboardJobsCount, 4 error_logs rows 2026-10-02).
 *
 * WHAT IS A QUERY FUNCTION. Inventoried from the source, never from a list:
 *   - every `queryFn` property (assignment, shorthand or method) in any object
 *     literal, whatever it is passed to: useQuery, useInfiniteQuery, useQueries,
 *     fetchQuery, prefetchQuery, ensureQueryData, queryOptions, or an options
 *     object kept in a variable;
 *   - every argument a WRAPPER forwards as its queryFn. A wrapper is found, not
 *     registered: a queryFn whose value is one of its enclosing function's
 *     parameters (useInstantQuery's `fetcher`). Each call of that wrapper then
 *     contributes the property it passes in that slot.
 *
 * WHAT IS REACHABLE. From each query function, every function it names, same
 * file or imported (`@/` and relative paths, re-exports, `export *`, default and
 * namespace imports), up to MAX_HOPS function hops away. Nested functions inside
 * a visited function are read as part of it.
 *
 * WHAT IS FLAGGED in reachable code (all decided from the syntax tree, so
 * comments and strings never count):
 *   - `throw X` / `Promise.reject(X)` where X is a Supabase result's error: a
 *     `.error` property (`res.error`, `list.error`), or a name bound by
 *     destructuring `error` from an object (`{ error }`, `{ error: qErr }`),
 *     directly or through `const e = res.error`, including `X ?? fallback`,
 *     or an element of an array of them (`errors[0]`, `for (const e of errors)`);
 *   - `throw new Something(...)` built from such an error (`new
 *     Error(error.message)`): the status AND the code are gone;
 *   - `.throwOnError()`: postgrest-js then throws its own PostgrestError, which
 *     carries no status either;
 *   - a result rebuilt by hand without its status (`({ data, error }) => ({
 *     data, error })`): unwrap() further down then has no status to copy.
 * The module that owns the sanctioned throw (unwrap(), passed as `sanctioned`)
 * is never followed into.
 *
 * NOT FOLLOWED (known limits, lh-silent-failure review 2026-10-03): dynamic
 * `import()`, calls on objects other than a namespace import (`api.load()`,
 * `this.x()`, class methods), functions a hook returns, anything past MAX_HOPS;
 * nor the spellings `let e; e = r.error; throw e`, `new Promise((_, reject) =>
 * reject(error))` and `throw Object.assign(new Error(..), error)`. The rule is
 * by NAME (any `.error`, any `{ data, error }` literal), so a non-Supabase
 * `{ error }` can be reported too: the fix there is not unwrap().
 *
 * WHAT IS A HOLE, reported as `unfollowable` rather than passed: a queryFn
 * value with no function of ours behind it (`queryFn: registry.load`), or a
 * wrapper whose callers do not write the forwarded function where the scan can
 * read it.
 */
import ts from "typescript";
import { dirname, join, relative, resolve } from "node:path";

/** How many function hops from a query function the scan follows. */
export const MAX_HOPS = 4;

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

export interface ReachReport {
  /**
   * Every query function: `file` repo-relative, and `via` what its options
   * object is handed to (useQuery, prefetchQuery, useInstantQuery, "options object", ...).
   */
  sites: { file: string; line: number; via: string }[];
  /**
   * Every offending statement, once per query function that reaches it: `site`
   * is the query function (file:line), `at` the statement (file:line), `chain`
   * the function hops from one to the other.
   */
  violations: {
    site: string;
    via: string;
    at: string;
    chain: string[];
    code: string;
    kind: "raw-throw" | "rewrapped" | "throwOnError" | "status-dropped";
  }[];
  /** query functions whose value the scan could not resolve to code: each one is a hole in the guard */
  unfollowable: string[];
  /** wrappers found: "useInstantQuery.fetcher (src/hooks/useInstantQuery.ts)" */
  wrappers: string[];
  /** how many functions were read, summed over every site (a scan that follows nothing reads 0) */
  functionsFollowed: number;
  /** the deepest hop at which a violation was found */
  deepestViolationHop: number;
  /** every throw statement the scan reached, flagged or not (for review, and as proof it reads deep) */
  reachedThrows: { at: string; hop: number; code: string; flagged: boolean }[];
}

type QueryFnSite = ReachReport["sites"][number];
type Violation = ReachReport["violations"][number];

interface FileInfo {
  path: string;
  sf: ts.SourceFile;
  fns: Map<string, Fn[]>;
  imports: Map<string, { spec: string; name: string }>;
  exports: Map<string, { local?: string; spec?: string; name?: string; node?: Fn }>;
  stars: string[];
}

interface Target {
  file: string;
  fn: Fn;
  name: string;
}

const isFn = (n: ts.Node): n is Fn =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** Peel the wrappers that do not change what a value is: parentheses, casts, `!`. */
function strip(e: ts.Expression): ts.Expression {
  let x = e;
  for (;;) {
    if (
      ts.isParenthesizedExpression(x) ||
      ts.isAsExpression(x) ||
      ts.isNonNullExpression(x) ||
      ts.isSatisfiesExpression(x) ||
      ts.isTypeAssertionExpression(x)
    )
      x = x.expression;
    else return x;
  }
}

/** `foo(...)` -> "foo", `a.b.foo(...)` -> "foo". */
function calleeName(call: ts.CallExpression | ts.NewExpression): string {
  const c = strip(call.expression);
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return "";
}

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);

const propName = (n: ts.PropertyName | ts.BindingName | undefined): string | undefined =>
  n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : undefined;

/** The React Query entry points an options object can be handed to. */
const QUERY_ENTRY_POINTS = new Set([
  "useQuery",
  "useInfiniteQuery",
  "useQueries",
  "useSuspenseQuery",
  "useSuspenseInfiniteQuery",
  "useSuspenseQueries",
  "fetchQuery",
  "prefetchQuery",
  "ensureQueryData",
  "fetchInfiniteQuery",
  "prefetchInfiniteQuery",
  "ensureInfiniteQueryData",
  "queryOptions",
  "infiniteQueryOptions",
]);

export class QueryFnReach {
  private readonly infos = new Map<string, FileInfo>();
  private readonly sources: ReadonlyMap<string, string>;
  private readonly repoRoot: string;
  private readonly srcRoot: string;
  private readonly sanctioned: ReadonlySet<string>;
  private readonly reached = new Map<string, { at: string; hop: number; code: string; flagged: boolean }>();

  /**
   * @param sources absolute path -> source text, for every file the scan may read
   * @param repoRoot paths in the report are relative to this
   * @param srcRoot what `@/` means
   * @param sanctioned files whose functions ARE the sanctioned throw (unwrap()): never followed
   */
  constructor(sources: ReadonlyMap<string, string>, repoRoot: string, srcRoot: string, sanctioned: readonly string[] = []) {
    this.sources = sources;
    this.repoRoot = repoRoot;
    this.srcRoot = srcRoot;
    this.sanctioned = new Set(sanctioned);
  }

  private rel(file: string): string {
    return relative(this.repoRoot, file);
  }

  private where(file: string, node: ts.Node): string {
    const sf = this.info(file)!.sf;
    return `${this.rel(file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  }

  private info(file: string): FileInfo | undefined {
    const hit = this.infos.get(file);
    if (hit) return hit;
    const text = this.sources.get(file);
    if (text === undefined) return undefined;
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const info: FileInfo = { path: file, sf, fns: new Map(), imports: new Map(), exports: new Map(), stars: [] };
    const addFn = (name: string, fn: Fn) => {
      const list = info.fns.get(name) ?? [];
      list.push(fn);
      info.fns.set(name, list);
    };
    const visit = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) addFn(n.name.text, n);
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const init = strip(n.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) addFn(n.name.text, init);
        else if (ts.isCallExpression(init) && calleeName(init) === "useCallback" && init.arguments[0]) {
          const cb = strip(init.arguments[0]);
          if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) addFn(n.name.text, cb);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const spec = st.moduleSpecifier.text;
        const clause = st.importClause;
        if (!clause || clause.isTypeOnly) continue;
        if (clause.name) info.imports.set(clause.name.text, { spec, name: "default" });
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) info.imports.set(nb.name.text, { spec, name: "*" });
        if (nb && ts.isNamedImports(nb))
          for (const el of nb.elements) if (!el.isTypeOnly) info.imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text });
      } else if (ts.isExportDeclaration(st)) {
        if (st.isTypeOnly) continue;
        const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined;
        if (!st.exportClause) {
          if (spec) info.stars.push(spec);
          continue;
        }
        if (ts.isNamedExports(st.exportClause))
          for (const el of st.exportClause.elements) {
            if (el.isTypeOnly) continue;
            const orig = (el.propertyName ?? el.name).text;
            info.exports.set(el.name.text, spec ? { spec, name: orig } : { local: orig });
          }
      } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
        const ex = strip(st.expression);
        if (ts.isIdentifier(ex)) info.exports.set("default", { local: ex.text });
        else if (isFn(ex)) info.exports.set("default", { node: ex });
      } else if (hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
        const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
        if (ts.isFunctionDeclaration(st)) {
          if (isDefault) info.exports.set("default", st.name ? { local: st.name.text } : { node: st });
          else if (st.name) info.exports.set(st.name.text, { local: st.name.text });
        } else if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) info.exports.set(d.name.text, { local: d.name.text });
        }
      }
    }
    this.infos.set(file, info);
    return info;
  }

  /** The file an import specifier names, or null for a package (or a file the scan was not given). */
  private resolveSpec(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = join(this.srcRoot, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null;
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")])
      if (/\.tsx?$/.test(cand) && this.sources.has(cand)) return cand;
    return null;
  }

  /** The functions `name` names in `file`'s module scope: defined there, or imported and resolved. */
  private resolveLocal(file: string, name: string, hops: number): Target[] {
    const info = this.info(file);
    if (!info) return [];
    const local = info.fns.get(name);
    if (local) return local.map((fn) => ({ file, fn, name }));
    const imp = info.imports.get(name);
    if (imp && imp.name !== "*") {
      const target = this.resolveSpec(file, imp.spec);
      if (target) return this.resolveExport(target, imp.name, hops + 1);
    }
    return [];
  }

  /** The functions module `file` exports as `name`, through re-exports and `export *`. */
  private resolveExport(file: string, name: string, hops = 0): Target[] {
    if (hops > 6) return [];
    const info = this.info(file);
    if (!info) return [];
    const ex = info.exports.get(name);
    if (ex?.node) return [{ file, fn: ex.node, name }];
    if (ex?.local) return this.resolveLocal(file, ex.local, hops);
    if (ex?.spec && ex.name) {
      const target = this.resolveSpec(file, ex.spec);
      return target ? this.resolveExport(target, ex.name, hops + 1) : [];
    }
    for (const star of info.stars) {
      const target = this.resolveSpec(file, star);
      if (!target) continue;
      const found = this.resolveExport(target, name, hops + 1);
      if (found.length) return found;
    }
    return [];
  }

  /** The functions an identifier in expression position refers to. */
  private resolveReference(file: string, id: ts.Identifier): Target[] {
    const info = this.info(file)!;
    const p = id.parent;
    // `ns.fetchThing(...)` on `import * as ns from "..."`
    if (ts.isPropertyAccessExpression(p) && p.expression === id) {
      const imp = info.imports.get(id.text);
      if (imp?.name === "*") {
        const target = this.resolveSpec(file, imp.spec);
        if (target) return this.resolveExport(target, p.name.text);
      }
    }
    return this.resolveLocal(file, id.text, 0);
  }

  /** The declaration a name refers to at `id`, by lexical scope (blocks, functions, catch, for). */
  private findDeclaration(id: ts.Identifier): ts.Node | undefined {
    const name = id.text;
    const inBinding = (b: ts.BindingName): ts.Node | undefined => {
      if (ts.isIdentifier(b)) return undefined;
      for (const el of b.elements) {
        if (ts.isOmittedExpression(el)) continue;
        if (ts.isIdentifier(el.name)) {
          if (el.name.text === name) return el;
        } else {
          const nested = inBinding(el.name);
          if (nested) return nested;
        }
      }
      return undefined;
    };
    const inDecl = (d: ts.VariableDeclaration | ts.ParameterDeclaration): ts.Node | undefined =>
      ts.isIdentifier(d.name) ? (d.name.text === name ? d : undefined) : inBinding(d.name);
    const inStatements = (sts: ts.NodeArray<ts.Statement>): ts.Node | undefined => {
      for (const st of sts) {
        if (ts.isVariableStatement(st))
          for (const d of st.declarationList.declarations) {
            const hit = inDecl(d);
            if (hit) return hit;
          }
        if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      }
      return undefined;
    };
    for (let cur: ts.Node | undefined = id.parent; cur; cur = cur.parent) {
      let hit: ts.Node | undefined;
      if (ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isModuleBlock(cur) || ts.isCaseClause(cur) || ts.isDefaultClause(cur))
        hit = inStatements(cur.statements);
      else if (isFn(cur)) for (const prm of cur.parameters) hit ??= inDecl(prm);
      else if (ts.isCatchClause(cur) && cur.variableDeclaration) hit = inDecl(cur.variableDeclaration);
      else if ((ts.isForStatement(cur) || ts.isForOfStatement(cur) || ts.isForInStatement(cur)) && cur.initializer && ts.isVariableDeclarationList(cur.initializer))
        for (const d of cur.initializer.declarations) hit ??= inDecl(d);
      if (hit) return hit;
    }
    return undefined;
  }

  /**
   * Is `e` a Supabase result's error object itself? `res.error`, a name
   * destructured as `error` (`{ error }`, `{ error: qErr }`), a name assigned
   * from one, `a ?? b` / `a || b` / `c ? a : b` over one, or an element of an
   * array of them (`errors[0]`, `for (const e of errors)`).
   */
  private isResultError(e: ts.Expression, depth = 0): boolean {
    const x = strip(e);
    if (ts.isPropertyAccessExpression(x)) return x.name.text === "error";
    if (ts.isElementAccessExpression(x))
      return (
        (ts.isStringLiteral(x.argumentExpression) && x.argumentExpression.text === "error") ||
        this.isResultErrorArray(x.expression, depth)
      );
    if (ts.isBinaryExpression(x)) {
      const op = x.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken)
        return this.isResultError(x.left, depth) || this.isResultError(x.right, depth);
      return false;
    }
    if (ts.isConditionalExpression(x)) return this.isResultError(x.whenTrue, depth) || this.isResultError(x.whenFalse, depth);
    if (!ts.isIdentifier(x) || depth > 3) return false;
    const decl = this.findDeclaration(x);
    if (!decl) return false;
    if (ts.isBindingElement(decl))
      return ts.isObjectBindingPattern(decl.parent) && propName(decl.propertyName ?? decl.name) === "error";
    if (ts.isVariableDeclaration(decl)) {
      if (decl.initializer) return this.isResultError(decl.initializer, depth + 1);
      // `for (const e of errors)`
      const loop = decl.parent.parent;
      if (ts.isForOfStatement(loop)) return this.isResultErrorArray(loop.expression, depth + 1);
    }
    return false;
  }

  /** Is `e` an array holding Supabase result errors (`[a.error, b.error].filter(Boolean)`)? */
  private isResultErrorArray(e: ts.Expression, depth: number): boolean {
    if (depth > 3) return false;
    const x = strip(e);
    if (ts.isArrayLiteralExpression(x))
      return x.elements.some((el) => this.isResultError(ts.isSpreadElement(el) ? el.expression : el, depth + 1));
    if (ts.isCallExpression(x)) {
      const c = strip(x.expression);
      if (ts.isPropertyAccessExpression(c) && ["filter", "slice", "concat", "flat", "reverse", "sort", "toSorted", "toReversed"].includes(c.name.text))
        return this.isResultErrorArray(c.expression, depth) || (c.name.text === "concat" && x.arguments.some((a) => this.isResultErrorArray(a, depth + 1)));
      return false;
    }
    if (!ts.isIdentifier(x)) return false;
    const decl = this.findDeclaration(x);
    return !!decl && ts.isVariableDeclaration(decl) && !!decl.initializer && this.isResultErrorArray(decl.initializer, depth + 1);
  }

  /** Does `node` mention a Supabase result's error anywhere (`error.message`, `${res.error.code}`, `errors[0].message`)? */
  private mentionsResultError(node: ts.Node): boolean {
    let found = false;
    const walk = (n: ts.Node) => {
      if (found) return;
      const candidate =
        ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || (ts.isIdentifier(n) && isReferencePosition(n));
      if (candidate && this.isResultError(n as ts.Expression)) {
        found = true;
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  }

  /** What, if anything, is wrong with this node for a query function to reach. */
  private classify(n: ts.Node): Violation["kind"] | null {
    if (ts.isObjectLiteralExpression(n)) {
      // A Supabase result rebuilt by hand (`({ data, error }) => ({ data, error })`)
      // without its `status`: unwrap() downstream then has no status to carry.
      const props = new Map<string, ts.ObjectLiteralElementLike>();
      for (const p of n.properties) {
        if (ts.isSpreadAssignment(p)) return null;
        const name = propName(p.name);
        if (name) props.set(name, p);
      }
      const err = props.get("error");
      if (!props.has("data") || !err || props.has("status")) return null;
      const value = ts.isPropertyAssignment(err) ? strip(err.initializer) : undefined;
      if (value && value.kind === ts.SyntaxKind.NullKeyword) return null;
      return "status-dropped";
    }
    if (ts.isThrowStatement(n)) {
      const e = strip(n.expression);
      if (this.isResultError(e)) return "raw-throw";
      if (ts.isNewExpression(e) && (e.arguments ?? []).some((a) => this.mentionsResultError(a))) return "rewrapped";
      return null;
    }
    if (ts.isCallExpression(n)) {
      const c = strip(n.expression);
      if (ts.isPropertyAccessExpression(c) && c.name.text === "throwOnError") return "throwOnError";
      if (
        ts.isPropertyAccessExpression(c) &&
        c.name.text === "reject" &&
        ts.isIdentifier(c.expression) &&
        c.expression.text === "Promise" &&
        n.arguments[0]
      ) {
        if (this.isResultError(n.arguments[0])) return "raw-throw";
        const a = strip(n.arguments[0]);
        if (ts.isNewExpression(a) && (a.arguments ?? []).some((x) => this.mentionsResultError(x))) return "rewrapped";
      }
    }
    return null;
  }

  /** Every query-function value in the sources, with what it was handed to. */
  private collectSites(): { file: string; value: ts.Node; via: string; at: ts.Node }[] {
    const out: { file: string; value: ts.Node; via: string; at: ts.Node }[] = [];
    for (const file of this.sources.keys()) {
      const info = this.info(file);
      if (!info) continue;
      const visit = (n: ts.Node) => {
        if (ts.isPropertyAssignment(n) && propName(n.name) === "queryFn") out.push({ file, value: n.initializer, via: viaOf(n), at: n });
        else if (ts.isShorthandPropertyAssignment(n) && n.name.text === "queryFn") out.push({ file, value: n.name, via: viaOf(n), at: n });
        else if (ts.isMethodDeclaration(n) && propName(n.name) === "queryFn" && ts.isObjectLiteralExpression(n.parent))
          out.push({ file, value: n, via: viaOf(n), at: n });
        ts.forEachChild(n, visit);
      };
      visit(info.sf);
    }
    return out;
  }

  /**
   * A wrapper: the queryFn value is (a property of) one of the enclosing
   * function's parameters. Returns the wrapper's name and which argument slot
   * carries the caller's query function, or null when the value is not a
   * parameter at all.
   */
  private wrapperOf(file: string, value: ts.Node): { name: string; prop?: string; index?: number; decl: ts.Node } | null | "unknown" {
    const v = ts.isExpression(value) ? strip(value) : value;
    let root: ts.Identifier | undefined;
    let accessed: string | undefined;
    if (ts.isIdentifier(v)) root = v;
    else if (ts.isPropertyAccessExpression(v) && ts.isIdentifier(strip(v.expression))) {
      root = strip(v.expression) as ts.Identifier;
      accessed = v.name.text;
    }
    if (!root) return null;
    const decl = this.findDeclaration(root);
    if (!decl) return null;
    // climb from the binding to the parameter that holds it
    let prm: ts.Node | undefined = decl;
    let prop: string | undefined = accessed;
    if (ts.isBindingElement(decl)) {
      prop = propName(decl.propertyName ?? decl.name);
      prm = decl.parent.parent;
      while (prm && ts.isBindingElement(prm)) prm = prm.parent.parent;
    }
    if (!prm || !ts.isParameter(prm)) return null;
    const fn = prm.parent;
    if (!isFn(fn)) return "unknown";
    let name: string | undefined;
    if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) name = fn.name.text;
    else if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) name = fn.parent.name.text;
    if (!name) return "unknown";
    if (prop) return { name, prop, decl: fn };
    if (ts.isIdentifier(prm.name) && prm.name === root) return { name, index: fn.parameters.indexOf(prm), decl: fn };
    return "unknown";
  }

  /** Every function reachable from `start` within MAX_HOPS, and every violation in them. */
  private follow(file: string, start: ts.Node, site: string, via: string, out: Violation[]): { followed: number; deepest: number } {
    const seen = new Set<ts.Node>([start]);
    const queue: { file: string; node: ts.Node; hop: number; chain: string[] }[] = [{ file, node: start, hop: 0, chain: [] }];
    let followed = 0;
    let deepest = -1;
    while (queue.length) {
      const { file: f, node, hop, chain } = queue.shift()!;
      const walk = (n: ts.Node) => {
        if (ts.isTypeNode(n)) return;
        const kind = this.classify(n);
        const code = () => n.getText(this.info(f)!.sf).replace(/\s+/g, " ").slice(0, 160);
        if (kind) {
          deepest = Math.max(deepest, hop);
          out.push({ site, via, at: this.where(f, n), chain, code: code(), kind });
        }
        if (ts.isThrowStatement(n)) {
          const at = this.where(f, n);
          const prior = this.reached.get(at);
          if (!prior || prior.hop > hop) this.reached.set(at, { at, hop, code: code(), flagged: kind !== null });
        }
        if (ts.isIdentifier(n) && hop < MAX_HOPS && isReferencePosition(n)) {
          for (const t of this.resolveReference(f, n)) {
            if (this.sanctioned.has(t.file) || seen.has(t.fn)) continue;
            seen.add(t.fn);
            followed++;
            queue.push({ file: t.file, node: t.fn, hop: hop + 1, chain: [...chain, `${t.name} (${this.rel(t.file)})`] });
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(node);
    }
    return { followed, deepest };
  }

  run(): ReachReport {
    const sites: QueryFnSite[] = [];
    const violations: Violation[] = [];
    const unfollowable: string[] = [];
    const wrappers = new Map<string, { file: string; name: string; prop?: string; index?: number }>();
    let functionsFollowed = 0;
    let deepestViolationHop = -1;

    const analyse = (file: string, value: ts.Node, via: string, at: ts.Node) => {
      const site = this.where(file, at);
      const v = ts.isExpression(value) ? strip(value) : value;
      // A value that is a parameter makes its function a wrapper: its callers are the sites.
      const w = this.wrapperOf(file, v);
      if (w === "unknown") {
        unfollowable.push(`${site} (${via}): forwards a parameter the scan cannot trace to its callers`);
        return;
      }
      if (w) {
        const key = `${this.rel(file)}#${w.name}`;
        if (!wrappers.has(key)) wrappers.set(key, { file, name: w.name, prop: w.prop, index: w.index });
        return;
      }
      sites.push({ file: this.rel(file), line: Number(site.split(":").pop()), via });
      // A value that is not itself a function must lead to one, or the guard is reading nothing.
      let packageExport = false;
      if (ts.isIdentifier(v) && !this.resolveReference(file, v).length) {
        const decl = this.findDeclaration(v);
        const imp = this.info(file)!.imports.get(v.text);
        if (decl && ts.isVariableDeclaration(decl) && decl.initializer) value = decl.initializer;
        else if (imp && !this.resolveSpec(file, imp.spec)) packageExport = true; // skipToken: none of our code to read
      }
      const { followed, deepest } = this.follow(file, value, site, via, violations);
      if (!isFn(value) && followed === 0 && !packageExport)
        unfollowable.push(`${site} (${via}): no function of ours behind \`${v.getText(this.info(file)!.sf).slice(0, 60)}\``);
      functionsFollowed += followed;
      deepestViolationHop = Math.max(deepestViolationHop, deepest);
    };

    for (const s of this.collectSites()) analyse(s.file, s.value, s.via, s.at);

    // Each wrapper's callers: the argument in the slot it forwards is a query function.
    const wrapperNotes: string[] = [];
    for (const w of wrappers.values()) {
      wrapperNotes.push(`${w.name}.${w.prop ?? `arg${w.index}`} (${this.rel(w.file)})`);
      for (const file of this.sources.keys()) {
        const info = this.info(file)!;
        const visit = (n: ts.Node) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(strip(n.expression)) && (strip(n.expression) as ts.Identifier).text === w.name) {
            const callsWrapper = this.resolveLocal(file, w.name, 0).some((t) => t.file === w.file);
            if (callsWrapper) {
              const via = w.name;
              if (w.prop) {
                const arg = n.arguments[0] ? strip(n.arguments[0]) : undefined;
                const prop =
                  arg && ts.isObjectLiteralExpression(arg)
                    ? arg.properties.find((p) => propName(p.name) === w.prop)
                    : undefined;
                if (prop && ts.isPropertyAssignment(prop)) analyse(file, prop.initializer, via, prop);
                else if (prop && ts.isShorthandPropertyAssignment(prop)) analyse(file, prop.name, via, prop);
                else if (prop && ts.isMethodDeclaration(prop)) analyse(file, prop, via, prop);
                else unfollowable.push(`${this.where(file, n)} (${via}): its \`${w.prop}\` is not written in an object literal the scan can read`);
              } else if (w.index !== undefined) {
                const arg = n.arguments[w.index];
                if (arg) analyse(file, arg, via, arg);
                else unfollowable.push(`${this.where(file, n)} (${via}): no argument in slot ${w.index}`);
              }
            }
          }
          ts.forEachChild(n, visit);
        };
        visit(info.sf);
      }
    }

    return {
      sites,
      violations,
      unfollowable,
      wrappers: wrapperNotes,
      functionsFollowed,
      deepestViolationHop,
      reachedThrows: [...this.reached.values()].sort((a, b) => a.at.localeCompare(b.at)),
    };
  }
}

/** Is this identifier a reference (not a declaration name, not `x.NAME`, not a type)? */
function isReferencePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return false;
  if (ts.isBindingElement(p)) return p.initializer === id;
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isParameter(p) ||
      ts.isClassDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isLabeledStatement(p) ||
      ts.isJsxAttribute(p) ||
      ts.isImportSpecifier(p) ||
      ts.isExportSpecifier(p) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p)) &&
    (p as { name?: ts.Node }).name === id
  )
    return false;
  return true;
}

/** What the options object holding a queryFn is handed to. */
function viaOf(prop: ts.Node): string {
  let n: ts.Node = prop.parent; // the object literal
  for (let i = 0; i < 10 && n.parent; i++) {
    const p = n.parent;
    const args: readonly ts.Expression[] = (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments ? p.arguments : [];
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && args.includes(n as ts.Expression)) {
      const name = calleeName(p);
      if (QUERY_ENTRY_POINTS.has(name)) return name;
      // `queries: ids.map((id) => ({ queryFn }))` sits inside a .map on its way to useQueries
      if (name === "map" || name === "flatMap" || name === "filter" || name === "concat") {
        n = p;
        continue;
      }
      return name ? `${name}()` : "a call";
    }
    if (ts.isVariableDeclaration(p) || ts.isReturnStatement(p)) return "options object";
    n = p;
  }
  return "options object";
}
