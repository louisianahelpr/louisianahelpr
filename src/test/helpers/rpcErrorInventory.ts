// The inventory behind rpcErrorCopyCoverage.test.ts, built from the repo
// itself rather than from any list a person keeps:
//
//   client side   every `<x>.rpc("name", …)` call in non-test source under src/,
//                 found by walking the TypeScript AST (so a call quoted in a
//                 comment is not a call, and a multi-line call still is);
//   server side   the LATEST definition of every public function in
//                 supabase/migrations (filename order = apply order), and the
//                 custom codes its body raises — plus the codes of every
//                 migration-defined function it calls, transitively, because
//                 an exception raised three frames down reaches the client
//                 exactly as if the RPC had raised it itself
//                 (helper_abort_job → rpc_open_dispute → open_dispute_as →
//                 'job_already_completed' is the case this was built for).
//
// A "code" is a RAISE message that is a bare snake_case identifier
// ('not_abortable'), i.e. written for a program to match, not for a person to
// read. Prose messages ('job not found') are a different class and out of
// scope here. Triggers fired by an RPC's own writes are not followed.
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkSource, readSource } from "./walkSource";

export type RpcCall = { file: string; line: number };

const isTestPath = (rel: string) =>
  /\.(test|spec)\.tsx?$/.test(rel) || rel.endsWith(".d.ts") || /(^|\/)(test|__tests__|tests)\//.test(rel);

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function stringArg(node: ts.Expression | undefined): string | null {
  // `"name" as never` (an RPC the generated types do not know yet) is still a
  // literal name.
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) {
    node = node.expression;
  }
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * Calls in `text` to a function or method named `callee` whose first argument
 * is a string literal, returned as that literal. `dynamic` counts calls whose
 * first argument is not a literal (an RPC name the inventory cannot see).
 */
export function literalCalls(file: string, text: string, callee: string): { names: string[]; dynamic: number; lines: number[] } {
  const sf = parse(file, text);
  const names: string[] = [];
  const lines: number[] = [];
  let dynamic = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const name = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isIdentifier(e) ? e.text : null;
      if (name === callee) {
        const lit = stringArg(node.arguments[0]);
        if (lit === null) dynamic += 1;
        else {
          names.push(lit);
          lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { names, dynamic, lines };
}

/** Every client `.rpc("name")` call in non-test source, keyed by RPC name. */
export function clientRpcCalls(root: string): { calls: Map<string, RpcCall[]>; dynamic: RpcCall[] } {
  const calls = new Map<string, RpcCall[]>();
  const dynamic: RpcCall[] = [];
  for (const abs of walkSource([join(root, "src")])) {
    const rel = relative(root, abs);
    if (isTestPath(rel)) continue;
    const text = readSource(abs);
    if (!text || !text.includes("rpc")) continue;
    // Only property calls count as RPCs: `supabase.rpc(…)`, `client.rpc(…)`.
    const sf = parse(abs, text);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "rpc") {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const lit = stringArg(node.arguments[0]);
        if (lit === null) dynamic.push({ file: rel, line });
        else {
          if (!calls.has(lit)) calls.set(lit, []);
          calls.get(lit)!.push({ file: rel, line });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { calls, dynamic };
}

/** SQL with line and block comments removed, so a header that quotes a
 *  definition or a RAISE is not mistaken for one. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

export type FunctionDef = { file: string; body: string };

/**
 * The latest definition of every public function, in migration apply order. A
 * function whose most recent event is a DROP with no later CREATE is absent.
 */
export function latestFunctionDefs(migrationsDir: string): Map<string, FunctionDef> {
  const defs = new Map<string, FunctionDef>();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const event =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2|DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?(\w+)"?/gi;
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(join(migrationsDir, f), "utf8"));
    for (const m of sql.matchAll(event)) {
      if (m[1]) defs.set(m[1], { file: f, body: m[3] });
      else if (m[4]) defs.delete(m[4]);
    }
  }
  return defs;
}

const CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** The snake_case codes a function body raises directly. */
export function raisedCodes(body: string): string[] {
  const out = new Set<string>();
  const src = stripSqlComments(body);
  const patterns = [
    /RAISE\s+(?:EXCEPTION\s+)?'((?:[^']|'')*)'/gi,
    /RAISE\s+(?:EXCEPTION\s+)?USING[^;]*?\bMESSAGE\s*=\s*'((?:[^']|'')*)'/gi,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) if (CODE.test(m[1])) out.add(m[1]);
  return [...out];
}

/** code → the function that raises it, for `rpc` and everything it calls. */
export function codesReachableFrom(rpc: string, defs: Map<string, FunctionDef>): Map<string, string> {
  const codes = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [rpc];
  while (queue.length) {
    const fn = queue.shift()!;
    if (seen.has(fn)) continue;
    seen.add(fn);
    const def = defs.get(fn);
    if (!def) continue;
    for (const code of raisedCodes(def.body)) if (!codes.has(code)) codes.set(code, fn);
    for (const m of stripSqlComments(def.body).matchAll(/\b(?:public\.)?(\w+)\s*\(/g)) {
      if (defs.has(m[1]) && !seen.has(m[1])) queue.push(m[1]);
    }
  }
  return codes;
}

/**
 * Whether EXECUTE on `fn` is revoked from anon: the last GRANT/REVOKE on the
 * function that names anon is a REVOKE. A signed-out caller is then refused
 * with 42501 before the body runs, so the body's own `auth.uid() IS NULL`
 * branch ('not_authenticated') cannot be reached through the API.
 */
export function anonExecuteRevoked(fn: string, migrationsDir: string): boolean {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const stmt = new RegExp(`\\b(GRANT|REVOKE)\\b[^;]*?ON\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\([^;]*;`, "gi");
  let last: "GRANT" | "REVOKE" | null = null;
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(join(migrationsDir, f), "utf8"));
    for (const m of sql.matchAll(stmt)) {
      if (/\banon\b/i.test(m[0])) last = m[1].toUpperCase() as "GRANT" | "REVOKE";
    }
    if (/GRANT[^;]*ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+public[^;]*\banon\b/i.test(sql)) last = "GRANT";
  }
  return last === "REVOKE";
}

export type Allowlist = Record<string, Record<string, { reason: string; anonRevoked?: true }>>;
export type CopyTable = Record<string, Record<string, string>>;

/** Every (rpc, code) the inventory holds that has neither copy nor an allowlist entry. */
export function findUnmapped(
  inventory: Map<string, Map<string, string>>,
  copy: CopyTable,
  allow: Allowlist,
): string[] {
  const out: string[] = [];
  for (const [rpc, codes] of inventory) {
    for (const [code, via] of codes) {
      if (copy[rpc]?.[code] || allow[rpc]?.[code]) continue;
      out.push(`${rpc}: '${code}'${via === rpc ? "" : ` (raised by ${via})`}`);
    }
  }
  return out.sort();
}

/**
 * Call sites that call an RPC with copy but do not read it: each `.rpc("X")`
 * in a file needs its own `rpcErrorMessage("X", …)` or `rpcErrorCode("X", …)`
 * in that file. A second call added beside a wired one fails the count.
 */
export function findUnwired(
  calls: Map<string, RpcCall[]>,
  copy: CopyTable,
  sourceOf: (file: string) => string,
): string[] {
  const out: string[] = [];
  for (const [rpc, sites] of calls) {
    if (!copy[rpc] || Object.keys(copy[rpc]).length === 0) continue;
    const perFile = new Map<string, RpcCall[]>();
    for (const s of sites) perFile.set(s.file, [...(perFile.get(s.file) ?? []), s]);
    for (const [file, fileSites] of perFile) {
      const text = sourceOf(file);
      const reads =
        literalCalls(file, text, "rpcErrorMessage").names.filter((n) => n === rpc).length +
        literalCalls(file, text, "rpcErrorCode").names.filter((n) => n === rpc).length;
      if (reads < fileSites.length) {
        out.push(
          `${file}:${fileSites.map((s) => s.line).join(",")} calls ${rpc} ${fileSites.length}x but reads its copy ${reads}x`,
        );
      }
    }
  }
  return out.sort();
}
