#!/usr/bin/env node
/**
 * check-discarded-query-filters — the discarded PostgREST builder call, as a class.
 *
 * Proven in src/components/admin/AdminAnalytics.tsx (the admin analytics
 * drill-down), where the revenue / fees / payouts breakdowns read:
 *
 *   const query = supabase.from("jobs").select("*")…;
 *   if (type === "revenue" || type === "fees") query.in("payment_status", […]);
 *   const { data } = await query;
 *
 * A supabase-js builder returns a NEW builder from every filter and modifier;
 * the receiver is not mutated in a way that survives. Calling `.in(…)` as a
 * bare expression statement therefore throws the filter away, and the three
 * money drill-downs listed every job — unfiltered — while looking filtered.
 *
 * This script flags the shape: a filter/modifier method called as a bare
 * expression statement on something that is a PostgREST builder, where the
 * returned builder is used by nobody.
 *
 * What counts as a builder:
 *   - a chain rooted in `<client>.from(…)` / `<client>.rpc(…)`, where <client>
 *     is a supabase-looking identifier or a variable assigned `createClient(…)`
 *   - a variable initialised from such a chain (or from another builder var)
 *   - a parameter typed `Postgrest*Builder<…>` (helpers that take a query and
 *     are meant to return it)
 *
 * Deliberately NOT flagged: `await query.eq(…)` as a statement (awaiting runs
 * the request with the filter applied), and any call whose result is assigned,
 * returned, chained onto or passed somewhere — those use the new builder.
 *
 * Escape hatch, for code that discards a builder ON PURPOSE (the guard's own
 * runtime demonstrations, and nothing else so far): put
 * `discarded-builder-ok: <reason>` on the line or the line above it. A bare
 * marker with no reason does not count.
 *
 * Usage:
 *   node scripts/check-discarded-query-filters.mjs           # 0 = clean, 1 = hits
 *   node scripts/check-discarded-query-filters.mjs --list    # one key per line
 *   node scripts/check-discarded-query-filters.mjs --json
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..");

/** Directories scanned, relative to the repo root. */
export const ROOTS = ["src", "supabase/functions", "scripts"];

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage", "ios", "android", "playwright-report", "test-results"]);

/**
 * PostgREST filter + modifier methods. Every one of these returns a builder,
 * so every one of them is a no-op when its result is discarded.
 */
export const BUILDER_METHODS = new Set([
  // filters
  "eq", "neq", "in", "is", "gt", "gte", "lt", "lte",
  "like", "ilike", "likeAllOf", "likeAnyOf", "ilikeAllOf", "ilikeAnyOf",
  "or", "not", "filter", "match",
  "contains", "containedBy", "overlaps", "textSearch",
  "rangeGt", "rangeGte", "rangeLt", "rangeLte", "rangeAdjacent",
  // modifiers / transforms
  "order", "limit", "range", "select", "single", "maybeSingle", "csv", "geojson",
  "abortSignal", "returns", "setHeader", "explain", "throwOnError", "rollback", "maxAffected",
]);

/**
 * Writes. A discarded write is the harsher form of the same mistake: a
 * PostgrestBuilder is a lazy thenable that fetches inside then(), so a bare
 * `supabase.from(…).update(…)` statement never issues a request at all. This
 * app has shipped that bug at least five times (useMessagesData.ts:440,
 * useMessagesRealtime.ts:71, AdminReports.tsx:250, send-push-notification,
 * cash-out-credits), which is why the guard covers it too.
 */
export const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete", "rpc"]);

/** Calling one of these runs the request — the builder is not discarded. */
const TERMINATORS = new Set(["then", "catch", "finally"]);

/** Identifiers that look like a supabase client. */
const CLIENT_NAME = /^(supabase|supabaseAdmin|supabaseClient|supabaseService|supa|sb|serviceClient|adminClient|userClient|client|db)$/i;

function isClientName(text) {
  return CLIENT_NAME.test(text) || /supabase/i.test(text);
}

function unwrapParens(node) {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) {
    n = n.expression;
  }
  return n;
}

/** `supabase.from(…)`, `admin.rpc(…)`, `this.client.from(…)`. */
function isClientEntryCall(call, clientVars) {
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrapParens(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  if (method !== "from" && method !== "rpc" && method !== "schema") return false;
  const recv = unwrapParens(callee.expression);
  if (ts.isIdentifier(recv)) return isClientName(recv.text) || clientVars.has(recv.text);
  if (ts.isPropertyAccessExpression(recv)) return isClientName(recv.name.text) || isClientEntryCall(recv, clientVars) === true;
  if (ts.isCallExpression(recv)) return isClientEntryCall(recv, clientVars);
  return false;
}

/**
 * Is `node` a PostgREST builder expression?
 *
 * Walks the chain down to its root: a `.from()` / `.rpc()` call on a client,
 * or an identifier already known to hold a builder.
 */
export function isBuilderExpr(node, state) {
  const n = unwrapParens(node);
  if (ts.isIdentifier(n)) return state.builderVars.has(n.text);
  if (ts.isCallExpression(n)) {
    if (isClientEntryCall(n, state.clientVars)) return true;
    const callee = unwrapParens(n.expression);
    if (ts.isPropertyAccessExpression(callee)) return isBuilderExpr(callee.expression, state);
    return false;
  }
  if (ts.isPropertyAccessExpression(n)) return isBuilderExpr(n.expression, state);
  return false;
}

function isBuilderTypeNode(type) {
  if (!type) return false;
  const text = type.getText ? safeText(type) : "";
  return /Postgrest\w*Builder/.test(text);
}

function safeText(node) {
  try {
    return node.getText();
  } catch {
    return "";
  }
}

/** `createClient(…)` — the edge-function way of getting a client. */
function isCreateClientCall(node) {
  const n = unwrapParens(node);
  if (!ts.isCallExpression(n)) return false;
  const callee = unwrapParens(n.expression);
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  return /^createClient$/i.test(name);
}

/**
 * Collect the names that hold a client or a builder in this file. Runs to a
 * fixed point so declaration order does not matter.
 */
function collectVars(sourceFile) {
  const state = { clientVars: new Set(), builderVars: new Set() };
  for (let pass = 0; pass < 4; pass++) {
    const before = state.clientVars.size + state.builderVars.size;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const name = node.name.text;
        if (node.initializer) {
          const init = unwrapParens(node.initializer);
          const awaited = ts.isAwaitExpression(init) ? unwrapParens(init.expression) : init;
          if (isCreateClientCall(awaited)) state.clientVars.add(name);
          // An awaited initializer holds the RESPONSE, not the builder.
          if (!ts.isAwaitExpression(init) && isBuilderExpr(init, state)) state.builderVars.add(name);
        }
        if (isBuilderTypeNode(node.type)) state.builderVars.add(name);
      }
      if (ts.isParameter(node) && ts.isIdentifier(node.name) && isBuilderTypeNode(node.type)) {
        state.builderVars.add(node.name.text);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const right = unwrapParens(node.right);
        if (!ts.isAwaitExpression(right) && isBuilderExpr(right, state)) state.builderVars.add(node.left.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (state.clientVars.size + state.builderVars.size === before) break;
  }
  return state;
}

/**
 * Candidate discarded expressions inside one expression statement: the
 * expression itself, plus the branches of `cond ? a : b` and the operands of
 * `a && b` / `a || b` / `a, b`, which are equally discarded.
 */
function discardedExpressions(expr, out = []) {
  const n = unwrapParens(expr);
  if (ts.isConditionalExpression(n)) {
    discardedExpressions(n.whenTrue, out);
    discardedExpressions(n.whenFalse, out);
    return out;
  }
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) {
      discardedExpressions(n.right, out);
      return out;
    }
    if (k === ts.SyntaxKind.CommaToken) {
      discardedExpressions(n.left, out);
      discardedExpressions(n.right, out);
      return out;
    }
    return out;
  }
  if (ts.isVoidExpression(n)) return discardedExpressions(n.expression, out);
  out.push(n);
  return out;
}

/** The outermost call in a chain, e.g. `q.eq(…).order(…)` → the `.order(…)` call. */
function chainMethodNames(call, names = []) {
  const callee = unwrapParens(call.expression);
  if (ts.isPropertyAccessExpression(callee)) {
    names.unshift(callee.name.text);
    const recv = unwrapParens(callee.expression);
    if (ts.isCallExpression(recv)) chainMethodNames(recv, names);
  }
  return names;
}

/**
 * Scan one file's source. `path` is used only for reporting, so callers can
 * scan a frozen fixture under the path it came from.
 */
export function hitsInSource(path, source) {
  const kind = path.endsWith(".tsx") || path.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const state = collectVars(sourceFile);
  const hits = [];
  const lines = source.split("\n");
  // `discarded-builder-ok: <reason>` on the line or the line above. The reason
  // is required — a bare marker is not an exemption.
  const allowed = (lineNo) =>
    [lines[lineNo - 1], lines[lineNo - 2]].some((l) => l && /discarded-builder-ok:\s*\S/.test(l));

  const consider = (expr) => {
    const n = unwrapParens(expr);
    if (!ts.isCallExpression(n)) return;
    const callee = unwrapParens(n.expression);
    if (!ts.isPropertyAccessExpression(callee)) return;
    const method = callee.name.text;
    if (TERMINATORS.has(method)) return;
    const onBuilder = isBuilderExpr(callee.expression, state);
    // A bare `<client>.rpc(…)` is the one entry call that is itself a request.
    const bareRpc = method === "rpc" && isClientEntryCall(n, state.clientVars);
    if (!bareRpc && !(onBuilder && (BUILDER_METHODS.has(method) || WRITE_METHODS.has(method)))) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile));
    if (allowed(line + 1)) return;
    const chain = chainMethodNames(n);
    hits.push({
      key: `${path}:${line + 1}:${chain.join(".")}`,
      file: path,
      line: line + 1,
      column: character + 1,
      method,
      chain: chain.join("."),
      text: safeText(n).replace(/\s+/g, " ").slice(0, 160),
    });
  };

  const visit = (node) => {
    if (ts.isExpressionStatement(node)) {
      for (const expr of discardedExpressions(node.expression)) consider(expr);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

export function listFiles(roots = ROOTS, repo = REPO) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      // A live tree, not a snapshot: other suites (e.g. src/test/vacuityGate's
      // end-to-end mutation self-test) create and delete real files under
      // src/** while this walk is in flight. A file that existed at
      // readdirSync() time can be gone by the time we stat it — that is a
      // benign race, not a scan failure, so treat "vanished mid-walk" as
      // "was never here" instead of letting ENOENT crash the whole scan.
      let st;
      try {
        st = statSync(full);
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      if (st.isDirectory()) walk(full);
      else if (EXTS.some((e) => entry.endsWith(e))) out.push(full);
    }
  };
  for (const root of roots) walk(join(repo, root));
  return out.sort();
}

export function scan(roots = ROOTS, repo = REPO) {
  const hits = [];
  for (const file of listFiles(roots, repo)) {
    const rel = relative(repo, file);
    // Same benign race as above: the file listed a moment ago may have been
    // deleted by a concurrently-running test before we get to read it.
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    hits.push(...hitsInSource(rel, source));
  }
  return hits;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const hits = scan();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(hits, null, 2));
  } else if (process.argv.includes("--list")) {
    for (const h of hits) console.log(h.key);
  } else if (hits.length > 0) {
    console.error(`Discarded PostgREST builder calls (${hits.length}) — the filter never applies:\n`);
    for (const h of hits) console.error(`  ${h.file}:${h.line}:${h.column}  ${h.text}`);
    console.error(`\nReassign (query = query.${hits[0].method}(…)) or chain the call.`);
  } else {
    console.log("No discarded PostgREST builder calls.");
  }
  process.exit(hits.length > 0 ? 1 : 0);
}
