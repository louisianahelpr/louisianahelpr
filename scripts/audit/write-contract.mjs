#!/usr/bin/env node
// WRITE CONTRACT — every write the client makes, checked against prod's schema.
//
// WHY THIS EXISTS. The happy-path mock backend (e2e/happy-path/fixtures.ts)
// echoes every write back as success, so a form can pass every mocked
// check while prod rejects it: a column that does not exist, a NOT NULL the
// form never sends, a check constraint the UI can violate, a table with RLS on
// and no policy for the operation, an RPC the caller's role cannot EXECUTE.
// "The mock boundary hid the blockers" (CLAUDE.md) — this closes that gap from
// the schema side.
//
// HOW.
//   1. Inventory: parse every .ts/.tsx under src/ with the TypeScript compiler
//      and find `.from("<table>")…insert|update|upsert|delete(...)` chains and
//      `.rpc("<name>", {...})` calls. Payload keys and literal values are read
//      off the AST (object literals, and identifiers bound to one in the same
//      file). Spreads and computed keys mark a payload OPEN: its known keys are
//      still checked, but "missing NOT NULL" cannot be asserted.
//   2. Facts: scripts/audit/write-contract.snapshot.json, produced READ-ONLY
//      from prod by scripts/audit/write-contract.sql. Committed, so CI and the
//      vitest guard run offline.
//   3. Check each write against the facts. A `reject` is a write prod will
//      refuse; a `warn` is something the snapshot cannot decide (e.g. a view,
//      a NOT NULL a BEFORE trigger may fill).
//
// USAGE
//   node scripts/audit/write-contract.mjs            check, print, exit 1 on unbaselined rejects
//   node scripts/audit/write-contract.mjs --json     machine-readable report
//   node scripts/audit/write-contract.mjs --refresh  re-pull the snapshot from prod (needs the
//                                                    linked Supabase CLI / SUPABASE_ACCESS_TOKEN)
//   node scripts/audit/write-contract.mjs --refresh --check-drift
//                                                    refresh, exit 2 if the committed snapshot drifted
//
// ROLES. Every write is checked as `authenticated`. Call sites reachable by a
// signed-out visitor are listed in ANON_CALL_SITES and are checked as `anon`
// too. That list is hand-maintained; each entry names why it is pre-auth.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const SNAPSHOT_PATH = path.join(HERE, "write-contract.snapshot.json");
export const BASELINE_PATH = path.join(HERE, "write-contract.baseline.json");
const SQL_PATH = path.join(HERE, "write-contract.sql");

/** file (relative to repo root) → reason it runs signed-out. */
export const ANON_CALL_SITES = {
  "src/lib/parishLookup.ts": "ZIP→parish lookup runs on the signup form, before the account exists",
  "src/pages/DashboardGuest.tsx": "the guest dashboard is the signed-out browse surface",
};

// ---------------------------------------------------------------------------
// 1. Inventory
// ---------------------------------------------------------------------------

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "__tests__" || entry.name === "__mocks__") continue;
      out.push(...listSourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression?.(node) || ts.isSatisfiesExpression?.(node))) {
    node = node.expression;
  }
  return node;
}

function stringLiteral(node) {
  node = unwrap(node);
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Every literal a value expression can evaluate to, or null if any branch is non-literal. */
function literalValues(node) {
  node = unwrap(node);
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (node.kind === ts.SyntaxKind.NullKeyword) return [null];
  if (node.kind === ts.SyntaxKind.TrueKeyword) return [true];
  if (node.kind === ts.SyntaxKind.FalseKeyword) return [false];
  if (ts.isNumericLiteral(node)) return [Number(node.text)];
  if (ts.isConditionalExpression(node)) {
    const a = literalValues(node.whenTrue);
    const b = literalValues(node.whenFalse);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

/** Find `const name = <init>` visible from `from` (nearest enclosing scope first). */
function resolveIdentifier(ident, sourceFile) {
  const name = ident.text;
  let best = null;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      if (n.pos <= ident.pos) {
        // Prefer the latest declaration before the use whose scope contains the use.
        let scope = n.parent;
        while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent;
        if (!scope || (scope.pos <= ident.pos && ident.end <= scope.end)) {
          if (!best || n.pos > best.pos) best = n;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return best ? best.initializer : null;
}

/** Describe an object-literal payload: keys, literal values per key, open-ness. */
function describePayload(node, sourceFile, depth = 0) {
  node = unwrap(node);
  if (!node) return null;
  if (ts.isIdentifier(node) && depth < 3) {
    const init = resolveIdentifier(node, sourceFile);
    if (!init) return { keys: {}, open: true, resolved: false };
    const described = describePayload(init, sourceFile, depth + 1);
    // `updates.avatar_url = x` after `const updates = {...}` adds an optional key.
    const decl = init.parent;
    let scope = decl;
    while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    if (described && scope) {
      const visit = (n) => {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left)
          && ts.isIdentifier(n.left.expression) && n.left.expression.text === node.text && n.pos > decl.pos && n.pos < node.pos) {
          const k = n.left.name.text;
          if (!(k in described.keys)) { described.keys[k] = literalValues(n.right); (described.optional ??= []).push(k); }
        }
        ts.forEachChild(n, visit);
      };
      visit(scope);
    }
    return described;
  }
  if (ts.isConditionalExpression(node)) {
    const a = describePayload(node.whenTrue, sourceFile, depth);
    const b = describePayload(node.whenFalse, sourceFile, depth);
    if (!a || !b) return { keys: {}, open: true, resolved: false };
    const keys = { ...a.keys };
    for (const [k, v] of Object.entries(b.keys)) keys[k] = k in keys ? (keys[k] && v ? [...keys[k], ...v] : null) : v;
    const optional = Object.keys(keys).filter((k) => !(k in a.keys) || !(k in b.keys));
    return { keys, open: a.open || b.open, resolved: a.resolved && b.resolved, optional };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const parts = node.elements.map((e) => describePayload(e, sourceFile, depth));
    if (!parts.length || parts.some((p) => !p)) return { keys: {}, open: true, resolved: false };
    // Every row must satisfy the contract; merge key sets conservatively.
    const merged = { keys: {}, open: parts.some((p) => p.open), resolved: parts.every((p) => p.resolved), rows: parts };
    for (const p of parts) for (const [k, v] of Object.entries(p.keys)) {
      const prev = merged.keys[k];
      merged.keys[k] = prev === undefined ? v : prev && v ? [...prev, ...v] : null;
    }
    return merged;
  }
  if (ts.isCallExpression(node)) {
    // `rows.map((r) => ({...}))` — describe the returned literal.
    const cb = node.arguments[0];
    if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
      let body = cb.body;
      if (ts.isBlock(body)) {
        const ret = body.statements.find((s) => ts.isReturnStatement(s));
        body = ret?.expression;
      }
      const inner = body ? describePayload(body, sourceFile, depth + 1) : null;
      if (inner) return { ...inner };
    }
    return { keys: {}, open: true, resolved: false };
  }
  if (!ts.isObjectLiteralExpression(node)) return { keys: {}, open: true, resolved: false };
  const out = { keys: {}, open: false, resolved: true };
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      // `...(cond ? { parish } : {})` — a literal spread contributes optional keys.
      const inner = depth < 3 ? describePayload(prop.expression, sourceFile, depth + 1) : null;
      if (inner && inner.resolved && !inner.open) {
        for (const [k, v] of Object.entries(inner.keys)) { out.keys[k] = v; (out.optional ??= []).push(k); }
      } else out.open = true;
      continue;
    }
    if (ts.isShorthandPropertyAssignment(prop)) { out.keys[prop.name.text] = null; continue; }
    if (ts.isPropertyAssignment(prop)) {
      let key = null;
      if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)) key = prop.name.text;
      else if (ts.isComputedPropertyName(prop.name)) {
        const e = unwrap(prop.name.expression);
        key = stringLiteral(e) ?? (ts.isIdentifier(e) ? stringLiteral(resolveIdentifier(e, sourceFile)) : null);
      }
      if (key === null) { out.open = true; continue; }
      const vals = literalValues(prop.initializer);
      // A conditional spread-in value like `cond ? x : undefined` is still a key the payload may send.
      out.keys[key] = vals;
      continue;
    }
    out.open = true;
  }
  return out;
}

/** Walk the receiver chain of a call: returns [{name, args, node}] from outermost to innermost. */
function chainOf(expr) {
  const links = [];
  let cur = unwrap(expr);
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const callee = unwrap(cur.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        links.push({ name: callee.name.text, args: cur.arguments, node: cur });
        cur = unwrap(callee.expression);
        continue;
      }
      if (ts.isIdentifier(callee)) links.push({ name: callee.text, args: cur.arguments, node: cur });
      break;
    }
    if (ts.isPropertyAccessExpression(cur)) {
      links.push({ name: cur.name.text, args: null, node: cur });
      cur = unwrap(cur.expression);
      continue;
    }
    if (ts.isAwaitExpression(cur)) { cur = unwrap(cur.expression); continue; }
    break;
  }
  return links;
}

/** The outermost chained call containing `node` (so `.insert(x).select().single()` → the whole thing). */
function outerChain(node) {
  let top = node;
  for (;;) {
    const p = top.parent;
    if (p && ts.isPropertyAccessExpression(p) && p.expression === top && p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p) {
      top = p.parent;
      continue;
    }
    break;
  }
  return top;
}

export function extractWrites(root = ROOT) {
  const writes = [];
  const unresolved = [];
  const srcDir = path.join(root, "src");
  for (const file of listSourceFiles(srcDir)) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\.(insert|update|upsert|delete|rpc)\s*\(/.test(text)) continue;
    const rel = path.relative(root, file).split(path.sep).join("/");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (ts.isPropertyAccessExpression(callee)) {
          const method = callee.name.text;
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const role = ANON_CALL_SITES[rel] ? ["authenticated", "anon"] : ["authenticated"];
          if (method === "rpc") {
            const name = stringLiteral(node.arguments[0]);
            const receiver = chainOf(callee.expression);
            const isStorageOrOther = receiver.some((l) => l.name === "storage");
            if (!isStorageOrOther) {
              if (name) {
                const payload = node.arguments[1] ? describePayload(node.arguments[1], sf) : { keys: {}, open: false, resolved: true };
                writes.push({ kind: "rpc", target: name, file: rel, line, roles: role, payload });
              } else if (receiver.length) {
                unresolved.push({ kind: "rpc", file: rel, line, reason: "non-literal function name" });
              }
            }
          } else if (WRITE_METHODS.has(method)) {
            const receiver = chainOf(callee.expression);
            if (!receiver.some((l) => l.name === "storage")) {
              const fromLink = receiver.find((l) => l.name === "from" && l.args);
              if (fromLink) {
                const table = stringLiteral(fromLink.args[0]);
                if (table) {
                  const payload = method === "delete" ? null : describePayload(node.arguments[0], sf);
                  const upsertOpts = method === "upsert" && node.arguments[1] ? unwrap(node.arguments[1]) : null;
                  let ignoreDuplicates = false;
                  if (upsertOpts && ts.isObjectLiteralExpression(upsertOpts)) {
                    for (const p of upsertOpts.properties) {
                      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "ignoreDuplicates" && p.initializer.kind === ts.SyntaxKind.TrueKeyword) ignoreDuplicates = true;
                    }
                  }
                  const outer = chainOf(outerChain(node));
                  const idx = outer.findIndex((l) => l.node === node);
                  const after = outer.slice(0, idx).map((l) => l.name);
                  writes.push({
                    kind: method, target: table, file: rel, line, roles: role, payload,
                    returning: after.includes("select"),
                    ignoreDuplicates,
                  });
                } else {
                  unresolved.push({ kind: method, file: rel, line, reason: "non-literal table name" });
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  writes.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line) || a.line - b.line);
  return { writes, unresolved };
}

// ---------------------------------------------------------------------------
// 2. Checks
// ---------------------------------------------------------------------------

/** Parse single-column IN-list / equality checks: returns {column, values} or null. */
export function parseCheck(def) {
  const colM = def.match(/^CHECK \(+\(?"?([a-z_][a-z0-9_]*)"?\)?(?:::text)? = ANY \(+ARRAY\[(.*?)\]\)+$/i);
  if (colM) {
    const values = [...colM[2].matchAll(/'((?:[^']|'')*)'::/g)].map((m) => m[1].replace(/''/g, "'"));
    if (values.length) return { column: colM[1], values };
  }
  return null;
}

const OP_PRIV = { insert: ["INSERT"], update: ["UPDATE"], upsert: ["INSERT", "UPDATE"], delete: ["DELETE"] };
const OP_CMD = { INSERT: "INSERT", UPDATE: "UPDATE", DELETE: "DELETE", SELECT: "SELECT" };

function policyAllows(table, cmd, role) {
  return table.policies.some((p) => p.permissive === "PERMISSIVE" && (p.cmd === cmd || p.cmd === "ALL") && (p.roles.includes(role) || p.roles.includes("public")));
}

export function checkWrite(w, snapshot) {
  const problems = [];
  const reject = (code, message) => problems.push({ level: "reject", code, message });
  const warn = (code, message) => problems.push({ level: "warn", code, message });

  if (w.kind === "rpc") {
    const overloads = snapshot.functions[w.target];
    if (!overloads) { reject("rpc_missing", `function public.${w.target} does not exist`); return problems; }
    for (const role of w.roles) {
      if (!overloads.some((o) => o[role])) reject("rpc_no_execute", `${role} has no EXECUTE on public.${w.target}`);
    }
    const p = w.payload;
    if (p && p.resolved && !p.open) {
      const sent = Object.keys(p.keys);
      const fits = overloads.some((o) => {
        const required = o.args.slice(0, o.nargs - o.nargdefaults);
        return sent.every((k) => o.args.includes(k)) && required.every((k) => sent.includes(k));
      });
      if (!fits) {
        const sigs = overloads.map((o) => `(${o.args.join(", ")})`).join(" | ");
        reject("rpc_signature", `args {${sent.join(", ")}} match no overload of ${w.target}${sigs}`);
      }
    }
    return problems;
  }

  const table = snapshot.tables[w.target];
  if (!table) { reject("table_missing", `public.${w.target} does not exist`); return problems; }
  if (table.kind === "view") warn("view_write", `public.${w.target} is a view; writability depends on its definition`);

  // Privileges + RLS
  for (const role of w.roles) {
    const privs = [...OP_PRIV[w.kind], ...(w.returning || w.kind === "update" || w.kind === "delete" ? ["SELECT"] : [])];
    for (const priv of privs) {
      if (priv === "UPDATE" && w.kind === "upsert" && w.ignoreDuplicates) continue;
      const granted = (table.grants[role] ?? []).includes(priv);
      if (!granted) {
        const colGranted = table.columnGrants?.[role]?.[priv];
        if (colGranted && w.payload) {
          // Column-level grant: every column the payload names must be covered.
          const denied = Object.keys(w.payload.keys).filter((k) => table.columns[k] && !colGranted.includes(k));
          for (const k of denied) reject("no_column_grant", `${role} has no ${priv} privilege on column ${w.target}.${k}`);
          if (w.payload.open && !denied.length) warn("open_payload_column_grant", `${w.target} grants ${priv} per column and the payload is not fully resolvable`);
        } else {
          reject("no_grant", `${role} has no ${priv} privilege on public.${w.target}`);
          continue;
        }
      }
      if (table.rls && !policyAllows(table, OP_CMD[priv], role)) {
        const why = priv === "SELECT" ? (w.returning ? " (the write asks for its row back)" : " (the write filters rows, which RLS evaluates via SELECT policies)") : "";
        if (priv === "SELECT" && !w.returning) {
          // UPDATE/DELETE with no SELECT policy silently matches zero rows rather than erroring.
          reject("no_policy_select_filter", `no ${priv} policy for ${role} on public.${w.target}${why}; the ${w.kind} matches zero rows`);
        } else {
          reject("no_policy", `RLS is on and no ${priv} policy allows ${role} on public.${w.target}${why}`);
        }
      }
    }
  }

  if (!w.payload) return problems;
  const cols = table.columns;
  const p = w.payload;
  for (const [key, vals] of Object.entries(p.keys)) {
    const col = cols[key];
    if (!col) { reject("unknown_column", `column ${w.target}.${key} does not exist`); continue; }
    if (col.generated) reject("generated_column", `column ${w.target}.${key} is GENERATED and cannot be written`);
    if (vals) {
      for (const v of vals) {
        if (v === null && col.notNull) reject("null_into_not_null", `${w.target}.${key} is NOT NULL but the payload can send null`);
        if (typeof v === "string" && col.enum && !col.type.endsWith("[]") && !col.enum.includes(v)) {
          reject("enum_value", `${w.target}.${key} (${col.type}) does not accept '${v}'; allowed: ${col.enum.join(", ")}`);
        }
      }
    }
  }
  for (const def of table.checks) {
    const c = parseCheck(def);
    if (!c) continue;
    const vals = p.keys[c.column];
    if (!vals) continue;
    for (const v of vals) {
      if (typeof v === "string" && !c.values.includes(v)) {
        reject("check_value", `${w.target}.${c.column} = '${v}' violates ${def}`);
      }
    }
  }
  if ((w.kind === "insert" || w.kind === "upsert") && p.resolved && !p.open) {
    const rows = p.rows ?? [p];
    const beforeInsertTrigger = table.triggers.some((t) => t.startsWith("before:") && t.includes("insert"));
    for (const [name, col] of Object.entries(cols)) {
      if (!col.notNull || col.hasDefault || col.generated) continue;
      if (rows.some((r) => (!(name in r.keys) || (r.optional ?? []).includes(name)) && !r.open)) {
        if (beforeInsertTrigger) warn("not_null_maybe_trigger", `${w.target}.${name} is NOT NULL with no default and is not sent (a BEFORE INSERT trigger may fill it)`);
        else reject("missing_not_null", `${w.target}.${name} is NOT NULL with no default and the insert does not send it`);
      }
    }
  }
  return problems;
}

export function loadSnapshot(p = SNAPSHOT_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function loadBaseline(p = BASELINE_PATH) {
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")).accepted ?? [];
}

/** Stable identity for a rejection that survives line moves. */
export function rejectionKey(w, problem) {
  return `${w.file}|${w.kind}|${w.target}|${problem.code}|${problem.message}`;
}

export function runContract({ root = ROOT, snapshot = loadSnapshot() } = {}) {
  const { writes, unresolved } = extractWrites(root);
  const results = writes.map((w) => ({ ...w, problems: checkWrite(w, snapshot) }));
  const rejects = [];
  const warnings = [];
  for (const r of results) for (const pr of r.problems) {
    const row = { file: r.file, line: r.line, kind: r.kind, target: r.target, roles: r.roles, ...pr, key: rejectionKey(r, pr) };
    (pr.level === "reject" ? rejects : warnings).push(row);
  }
  return { writes: results, unresolved, rejects, warnings };
}

// ---------------------------------------------------------------------------
// 3. Snapshot refresh (read-only against prod)
// ---------------------------------------------------------------------------

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
}

export function fetchSnapshot() {
  const raw = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", "-f", SQL_PATH], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
  });
  const start = raw.indexOf("{");
  const parsed = JSON.parse(raw.slice(start, raw.lastIndexOf("}") + 1));
  const snap = parsed.rows?.[0]?.snapshot ?? parsed[0]?.snapshot;
  if (!snap?.tables || !snap?.functions) throw new Error("snapshot query returned no tables/functions");
  return sortDeep(snap);
}

export function serializeSnapshot(snap) {
  return JSON.stringify(sortDeep(snap), null, 1) + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  if (args.has("--refresh")) {
    const next = serializeSnapshot(fetchSnapshot());
    const prev = fs.existsSync(SNAPSHOT_PATH) ? fs.readFileSync(SNAPSHOT_PATH, "utf8") : "";
    fs.writeFileSync(SNAPSHOT_PATH, next);
    const drifted = prev !== next;
    console.log(drifted ? "write-contract: snapshot CHANGED" : "write-contract: snapshot unchanged");
    if (drifted && args.has("--check-drift")) {
      console.error("::error::Prod schema facts drifted from scripts/audit/write-contract.snapshot.json. Run `node scripts/audit/write-contract.mjs --refresh`, re-run the contract, and commit the snapshot.");
    }
    // Fall through to the check so a drift run also reports new rejections.
    const report = runContract({ snapshot: JSON.parse(next) });
    const accepted = new Set(loadBaseline());
    const fresh = report.rejects.filter((r) => !accepted.has(r.key));
    for (const r of fresh) console.error(`REJECT ${r.file}:${r.line} ${r.kind} ${r.target}: ${r.message}`);
    process.exit(fresh.length ? 1 : drifted && args.has("--check-drift") ? 2 : 0);
  }
  const report = runContract();
  if (args.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const accepted = new Set(loadBaseline());
    const counts = report.writes.reduce((m, w) => ((m[w.kind] = (m[w.kind] ?? 0) + 1), m), {});
    console.log(`write-contract: ${report.writes.length} writes (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}), ${report.unresolved.length} unresolved call sites`);
    for (const r of report.rejects) console.log(`${accepted.has(r.key) ? "KNOWN " : "REJECT"} ${r.file}:${r.line} ${r.kind} ${r.target} [${r.roles.join("+")}]: ${r.message}`);
    if (args.has("--warnings")) for (const r of report.warnings) console.log(`warn   ${r.file}:${r.line} ${r.kind} ${r.target}: ${r.message}`);
    const fresh = report.rejects.filter((r) => !accepted.has(r.key));
    console.log(`${report.rejects.length} rejects (${fresh.length} not baselined), ${report.warnings.length} warnings`);
    process.exit(fresh.length ? 1 : 0);
  }
}
