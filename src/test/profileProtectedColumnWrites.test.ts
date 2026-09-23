/*
 * CLASS CHECK — a client write to a `profiles` column that the database
 * silently puts back.
 *
 * FOUND 2026-09-23 (Q99). The "I Am Licensed" / "I Am Insured" switches on
 * /profile?tab=credentials sent `PATCH profiles {is_licensed: true}`. PostgREST
 * answered 200 with one row, so `unwrapMutation` was satisfied — but the BEFORE
 * UPDATE trigger `tr_prevent_self_escalation` (public.prevent_self_escalation)
 * had already reset the column to OLD for this non-admin caller. The row came
 * back `is_licensed: false`; the client patched its persisted cache from the
 * REQUEST, so the switch still showed ON after a reload.
 *
 * `unwrapMutation` cannot see this: the write is not refused, it is quietly
 * rewritten. So the class is decided statically, from the trigger itself:
 *
 *   PROTECTED = every `NEW.<col> := OLD.<col>` in the NEWEST migration that
 *               defines prevent_self_escalation (any dollar-quote tag). Never
 *               hand-typed: a column added to the trigger joins this check the
 *               day its migration lands.
 *   OFFENDERS = every `.from("profiles").update|upsert|insert(...)` in src/
 *               (parsed with the TypeScript AST, tests excluded) whose payload
 *               can carry one of PROTECTED, outside the admin surface. A
 *               payload the resolver cannot follow is UNRESOLVED and fails
 *               unless listed in KNOWN_UNRESOLVED (see PAYLOAD RESOLUTION).
 *
 * The admin surface (src/components/admin/**, src/pages/Admin*) is exempt
 * because the trigger's first line returns NEW unchanged for
 * `has_role(auth.uid(), 'admin')` — those writes land.
 *
 * KNOWN_OFFENDERS is EXACT and fails in BOTH directions: a new offender fails,
 * and so does a fixed one still listed (lower the list in the same commit).
 *
 * @mutate src/components/profile/CredentialsTab.tsx | if (kind === "license") update.license_url = path; | if (kind === "license") { update.license_url = path; update.is_licensed = true; }
 * @mutate src/components/profile/CredentialsTab.tsx | setIntent((prev) => ({ ...prev, [kind]: true })); | void supabase.from("profiles").update({ is_insured: true }).eq("user_id", userId);
 * @mutate src/pages/Profile.tsx | .update({ avatar_url: publicUrl }) | .update({ avatar_url: publicUrl, idv_status: "pending" })
 * @mutate src/components/profile/CredentialsTab.tsx | kind === "license" ? { license_url: null } : { insurance_url: null }; | kind === "license" ? { license_url: null } : { ...EMPTY, insurance_url: null };
 *
 * The last one is the Q112 hole: `EMPTY` (protected keys) is a module const
 * ~250 lines above the call, so the old text-proximity resolver passed it
 * (measured 2026-09-23); the AST resolver follows the spread.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import ts from "typescript";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/**
 * The current offenders, `file :: sorted protected columns`, one entry per
 * write site. Only an owner decision (Q99, MORNING QUESTIONS in docs/OPEN.md)
 * should take this to zero.
 */
// @two-way src/test/profileProtectedColumnWrites.test.ts:const staleOffenders =
const KNOWN_OFFENDERS: string[] = [
  // Empty since Q40 (2026-09-23): the last offender, Profile.tsx's
  // unreachable handleIdUpload (idv_status), was deleted with the retired
  // "upload your ID to us" path.
];

/**
 * Payload expressions the resolver cannot follow, `file :: reason`, each with
 * why it cannot carry a protected column. EXACT and two-way like
 * KNOWN_OFFENDERS: an unresolved payload that is not listed fails, and so does
 * a listed one that no longer appears.
 */
// @two-way src/test/profileProtectedColumnWrites.test.ts:const staleUnresolved =
const KNOWN_UNRESOLVED: Record<string, string> = {};

const ADMIN_SURFACE = /^src\/(components\/admin\/|pages\/Admin)/;

/** The body of the newest `CREATE [OR REPLACE] FUNCTION public.prevent_self_escalation`. */
function newestTriggerBody(): { file: string; body: string } {
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?prevent_self_escalation"?\s*\(/gi;
  let found: { file: string; body: string } | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const open = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(rest);
      if (!open) continue;
      const start = open.index + open[0].length;
      const end = rest.indexOf(open[1], start);
      if (end < 0) continue;
      found = { file: f, body: rest.slice(start, end) };
    }
  }
  if (!found) throw new Error("no migration defines prevent_self_escalation");
  return found;
}

function protectedColumns(body: string): string[] {
  const code = body.replace(/--[^\n]*/g, "");
  const cols = new Set<string>();
  for (const m of code.matchAll(/\bNEW\.(\w+)\s*:=\s*OLD\.(\w+)/gi)) {
    if (m[1] === m[2]) cols.add(m[1]);
  }
  return [...cols].sort();
}

/*
 * PAYLOAD RESOLUTION — by the TypeScript AST, never by text proximity (Q112).
 *
 * The first version read a variable payload by scanning for `key:` tokens in
 * the raw text between its declaration and the call. A spread of a const
 * built elsewhere, a helper's return value or an imported constant put the
 * protected key outside that window, and the guard passed — measured
 * 2026-09-23 with `const BASE = { is_licensed: true }; update({ ...BASE })`.
 *
 * Now each payload expression is resolved to the SET of keys it can carry:
 *   - object literals (plain, shorthand, string/numeric keys, computed keys
 *     that resolve to an in-file string constant);
 *   - spreads, recursively; `cond && {..}`, `a || b`, `a ?? b`, ternaries
 *     (BOTH branches); arrays (insert/upsert of rows); `as`/`satisfies`/`!`;
 *   - identifiers, followed lexically to their declaration IN THIS FILE, plus
 *     every later `x.col = …`, `x["col"] = …`, `x = …` and
 *     `Object.assign(x, …)` on that same binding.
 * Anything else — an import, a parameter, a call result, a computed key it
 * cannot pin to a string, the binding handed to another function that could
 * add keys — is UNRESOLVED, and UNRESOLVED fails the test unless it is in
 * KNOWN_UNRESOLVED with a reason. It is never read as "no protected keys".
 */
interface Write { file: string; line: number; method: string; cols: string[]; unresolved: string[] }

type Decl =
  | { kind: "var"; decl: ts.VariableDeclaration; scope: ts.Node }
  | { kind: "other"; what: string };

function nameOf(n: ts.PropertyName): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isPrivateIdentifier(n)) return n.text;
  return null;
}

function bindingHas(b: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(b)) return b.text === name;
  return b.elements.some((e) => !ts.isOmittedExpression(e) && bindingHas(e.name, name));
}

/** Lexical lookup of `name` as seen from `from`, within this file only. */
function findDecl(name: string, from: ts.Node): Decl {
  for (let n: ts.Node | undefined = from.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      for (const p of (n as ts.SignatureDeclaration).parameters) {
        if (bindingHas(p.name, name)) return { kind: "other", what: `parameter ${name}` };
      }
    }
    if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) {
      const init = n.initializer;
      if (init && ts.isVariableDeclarationList(init) && init.declarations.some((d) => bindingHas(d.name, name))) {
        return { kind: "other", what: `loop variable ${name}` };
      }
    }
    if (ts.isCatchClause(n) && n.variableDeclaration && bindingHas(n.variableDeclaration.name, name)) {
      return { kind: "other", what: `catch binding ${name}` };
    }
    const stmts = ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)
      ? n.statements
      : null;
    if (!stmts) continue;
    for (const s of stmts) {
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) return { kind: "var", decl: d, scope: n };
          if (!ts.isIdentifier(d.name) && bindingHas(d.name, name)) return { kind: "other", what: `destructured ${name}` };
        }
      } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name?.text === name) {
        return { kind: "other", what: `function ${name}` };
      } else if (ts.isImportDeclaration(s) && s.importClause) {
        const c = s.importClause;
        const named = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.map((e) => e.name.text) : [];
        const ns = c.namedBindings && ts.isNamespaceImport(c.namedBindings) ? [c.namedBindings.name.text] : [];
        if (c.name?.text === name || named.includes(name) || ns.includes(name)) return { kind: "other", what: `imported ${name}` };
      }
    }
  }
  return { kind: "other", what: `undeclared ${name}` };
}

function sameDecl(a: Decl, b: Decl): boolean {
  return a.kind === "var" && b.kind === "var" && a.decl === b.decl;
}

class Resolver {
  keys = new Set<string>();
  unresolved: string[] = [];
  private seen = new Set<ts.Node>();
  constructor(private sf: ts.SourceFile, private write: ts.CallExpression) {}

  private text(n: ts.Node): string {
    return n.getText(this.sf).replace(/\s+/g, " ").slice(0, 60);
  }

  /** A string constant: literal, or an in-file const whose initializer is one. */
  stringOf(e: ts.Expression, depth = 0): string | null {
    e = unwrap(e);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isIdentifier(e) && depth < 10) {
      const d = findDecl(e.text, e);
      if (d.kind === "var" && d.decl.initializer && (d.decl.parent.flags & ts.NodeFlags.Const)) {
        return this.stringOf(d.decl.initializer, depth + 1);
      }
    }
    return null;
  }

  expr(e: ts.Expression): void {
    e = unwrap(e);
    if (this.seen.has(e)) return;
    this.seen.add(e);
    if (ts.isObjectLiteralExpression(e)) {
      for (const p of e.properties) {
        if (ts.isSpreadAssignment(p)) this.expr(p.expression);
        else if (p.name && ts.isComputedPropertyName(p.name)) {
          const k = this.stringOf(p.name.expression);
          if (k === null) this.unresolved.push(`computed key [${this.text(p.name.expression)}]`);
          else this.keys.add(k);
        } else if (p.name) {
          const k = nameOf(p.name);
          if (k === null) this.unresolved.push(`key ${this.text(p.name)}`);
          else this.keys.add(k);
        }
      }
    } else if (ts.isConditionalExpression(e)) {
      this.expr(e.whenTrue);
      this.expr(e.whenFalse);
    } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      this.expr(e.right); // the left side is the condition; falsy spreads nothing
    } else if (
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      this.expr(e.left);
      this.expr(e.right);
    } else if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) this.expr(ts.isSpreadElement(el) ? el.expression : el);
    } else if (
      e.kind === ts.SyntaxKind.NullKeyword ||
      e.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(e) && e.text === "undefined")
    ) {
      // spreads nothing
    } else if (ts.isIdentifier(e)) {
      this.identifier(e);
    } else if (ts.isCallExpression(e)) {
      this.unresolved.push(`call ${this.text(e.expression)}()`);
    } else {
      this.unresolved.push(`expression ${this.text(e)}`);
    }
  }

  private identifier(id: ts.Identifier): void {
    const d = findDecl(id.text, id);
    if (d.kind === "other") {
      this.unresolved.push(d.what);
      return;
    }
    if (d.decl.initializer) this.expr(d.decl.initializer);
    // Every later write to the same binding inside its scope.
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const l = unwrap(n.left);
        if (ts.isIdentifier(l) && l.text === id.text && sameDecl(findDecl(l.text, l), d)) this.expr(n.right);
        else if (
          (ts.isPropertyAccessExpression(l) || ts.isElementAccessExpression(l)) &&
          ts.isIdentifier(unwrap(l.expression)) &&
          (unwrap(l.expression) as ts.Identifier).text === id.text &&
          sameDecl(findDecl(id.text, l.expression), d)
        ) {
          if (ts.isPropertyAccessExpression(l)) this.keys.add(l.name.text);
          else {
            const k = this.stringOf(l.argumentExpression);
            if (k === null) this.unresolved.push(`computed key ${id.text}[${this.text(l.argumentExpression)}]`);
            else this.keys.add(k);
          }
        }
      }
      if (ts.isCallExpression(n) && n !== this.write) {
        n.arguments.forEach((a, i) => {
          const u = unwrap(a);
          if (!ts.isIdentifier(u) || u.text !== id.text || !sameDecl(findDecl(u.text, u), d)) return;
          const callee = n.expression.getText(this.sf);
          if (callee === "Object.assign" && i === 0) n.arguments.slice(1).forEach((x) => this.expr(x));
          else this.unresolved.push(`${id.text} passed to ${callee.replace(/\s+/g, " ").slice(0, 40)}()`);
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(d.scope);
  }
}

function unwrap(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)
  ) e = e.expression;
  return e;
}

/** Every `<x>.from("profiles").update|upsert|insert(<payload>)` in the given sources, payload resolved. */
function profileWrites(files: Record<string, string>): Write[] {
  const out: Write[] = [];
  for (const [file, src] of Object.entries(files)) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ["update", "upsert", "insert"].includes(n.expression.name.text)
      ) {
        const recv = unwrap(n.expression.expression);
        if (
          ts.isCallExpression(recv) &&
          ts.isPropertyAccessExpression(recv.expression) &&
          recv.expression.name.text === "from" &&
          recv.arguments.length > 0
        ) {
          const r0 = new Resolver(sf, n);
          if (r0.stringOf(recv.arguments[0]) === "profiles") {
            const r = new Resolver(sf, n);
            if (n.arguments.length === 0) r.unresolved.push("no payload");
            else r.expr(n.arguments[0]);
            out.push({
              file,
              line: sf.getLineAndCharacterOfPosition(recv.getStart(sf)).line + 1,
              method: n.expression.name.text,
              cols: [...r.keys].sort(),
              unresolved: [...new Set(r.unresolved)].sort(),
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "src/*.ts", "src/*.tsx"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/") && !f.endsWith("integrations/supabase/types.ts"));
}

function readSources(files: string[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f, readFileSync(join(REPO, f), "utf8")]));
}

/** `file :: sorted protected columns`, one per offending write, admin surface exempt. */
function offendersOf(writes: Write[], protectedCols: string[]): string[] {
  const set = new Set(protectedCols);
  return writes
    .filter((w) => !ADMIN_SURFACE.test(w.file))
    .map((w) => ({ w, hit: w.cols.filter((c) => set.has(c)).sort() }))
    .filter((x) => x.hit.length > 0)
    .map((x) => `${x.w.file} :: ${x.hit.join(",")}`)
    .sort();
}

/** `file :: reason`, one per thing the resolver could not pin down. */
function unresolvedOf(writes: Write[]): string[] {
  return [...new Set(writes.flatMap((w) => w.unresolved.map((u) => `${w.file} :: ${u}`)))].sort();
}

describe("client writes to profiles columns that prevent_self_escalation resets", () => {
  const { file: trigFile, body } = newestTriggerBody();
  const PROTECTED = protectedColumns(body);
  const writes = profileWrites(readSources(sourceFiles()));

  it("reads the protected list from the newest trigger definition", () => {
    // 52 columns in 20260915101102, matching live pg_get_functiondef on 2026-09-23.
    expect(PROTECTED.length).toBeGreaterThan(40);
    expect(PROTECTED).toContain("is_licensed");
    expect(PROTECTED).toContain("license_status");
    expect(trigFile >= "20260915101102").toBe(true);
  });

  it("finds the profiles writes it claims to check (inventory floor)", () => {
    expect(writes.length).toBeGreaterThan(15);
    expect(writes.filter((w) => !ADMIN_SURFACE.test(w.file)).length).toBeGreaterThan(8);
  });

  it("resolves every payload it inspects — unresolved is a failure, never clean", () => {
    const unresolved = unresolvedOf(writes);
    const staleUnresolved = Object.keys(KNOWN_UNRESOLVED).filter((k) => !unresolved.includes(k));
    expect(staleUnresolved.map((k) => `stale baseline entry ${k} — remove it (lower the baseline)`)).toEqual([]);
    expect(
      unresolved,
      "A profiles write payload could not be resolved to its keys (import, call result, parameter, " +
        "computed key, or the binding passed to another function). Inline it as an object literal in " +
        "the file, or list it in KNOWN_UNRESOLVED with the reason it cannot carry a protected column.",
    ).toEqual(Object.keys(KNOWN_UNRESOLVED).sort());
  });

  it("has exactly the known offenders — no new ones, no stale entries", () => {
    const offenders = offendersOf(writes, PROTECTED);
    const staleOffenders = KNOWN_OFFENDERS.filter((k) => !offenders.includes(k));
    expect(staleOffenders.map((k) => `stale baseline entry ${k} — remove it (lower the baseline)`)).toEqual([]);
    expect(
      offenders,
      "A client write names a column the trigger resets for non-admins, so it can return 200 " +
        "and change nothing. Write through a server path, drop the column, or (if the list shrank) " +
        "lower KNOWN_OFFENDERS in the same commit.",
    ).toEqual([...KNOWN_OFFENDERS].sort());
  });
});

/*
 * The resolver against payload shapes the text-proximity version could not
 * see (Q112). Each hides `is_licensed` somewhere other than the call's own
 * object literal; each must come out as an offender or as UNRESOLVED.
 */
describe("payload resolver fixtures (Q112)", () => {
  const P = ["is_licensed", "license_status"];
  const HEAD = `import { supabase } from "@/integrations/supabase/client";\n`;
  const run = (body: string) => {
    const w = profileWrites({ "src/lib/fixture.ts": HEAD + body });
    return { offenders: offendersOf(w, P), unresolved: unresolvedOf(w), writes: w };
  };

  it("spread of an in-file const → offender", () => {
    const r = run(`const BASE = { is_licensed: true };
export async function f(id: string) {
  const payload = { ...BASE, bio: "x" };
  await supabase.from("profiles").update(payload).eq("user_id", id);
}`);
    expect(r.offenders).toEqual(["src/lib/fixture.ts :: is_licensed"]);
    expect(r.unresolved).toEqual([]);
  });

  it("ternary payload → both branches read → offender", () => {
    const r = run(`export async function f(id: string, lic: boolean) {
  const payload = lic ? { bio: "a" } : { bio: "b", is_licensed: false };
  await supabase.from("profiles").update(payload).eq("user_id", id);
}`);
    expect(r.offenders).toEqual(["src/lib/fixture.ts :: is_licensed"]);
    expect(r.unresolved).toEqual([]);
  });

  it("helper-returned payload → UNRESOLVED", () => {
    const r = run(`function build() { return { is_licensed: true }; }
export async function f(id: string) {
  await supabase.from("profiles").update(build()).eq("user_id", id);
}`);
    expect(r.unresolved).toEqual(["src/lib/fixture.ts :: call build()"]);
  });

  it("imported-constant payload → UNRESOLVED", () => {
    const r = run(`import { LICENSED } from "./payloads";
export async function f(id: string) {
  await supabase.from("profiles").update({ ...LICENSED, bio: "x" }).eq("user_id", id);
}`);
    expect(r.unresolved).toEqual(["src/lib/fixture.ts :: imported LICENSED"]);
  });

  it("computed key: resolved when it pins to an in-file string, UNRESOLVED when not", () => {
    const pinned = run(`const COL = "is_licensed";
export async function f(id: string) { await supabase.from("profiles").update({ [COL]: true }).eq("user_id", id); }`);
    expect(pinned.offenders).toEqual(["src/lib/fixture.ts :: is_licensed"]);
    const loose = run(`export async function f(id: string, col: string) {
  await supabase.from("profiles").update({ [col]: true }).eq("user_id", id);
}`);
    expect(loose.unresolved).toEqual(["src/lib/fixture.ts :: computed key [col]"]);
  });

  it("later member writes, Object.assign and escapes on the same binding", () => {
    const r = run(`export async function f(id: string, other: (x: object) => void) {
  const u: Record<string, unknown> = {};
  u.bio = "x";
  u["license_status"] = "approved";
  Object.assign(u, { is_licensed: true });
  other(u);
  await supabase.from("profiles").update(u).eq("user_id", id);
}`);
    expect(r.offenders).toEqual(["src/lib/fixture.ts :: is_licensed,license_status"]);
    expect(r.unresolved).toEqual(["src/lib/fixture.ts :: u passed to other()"]);
  });

  it("a clean in-file literal stays clean (the resolver is not just failing everything)", () => {
    const r = run(`export async function f(id: string, on: boolean) {
  const payload = { bio: "x", ...(on ? { senior_mode: true } : {}) };
  await supabase.from("profiles").update(payload).eq("user_id", id);
}`);
    expect(r.writes.map((w) => w.cols)).toEqual([["bio", "senior_mode"]]);
    expect(r.offenders).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });
});
