#!/usr/bin/env node
/**
 * THE TOAST INVENTORY — every toast the app can raise, read from the
 * TypeScript AST of src/ (Q228, 2026-09-26).
 *
 * Toasts are the largest body of user-facing copy in the app and, until this
 * file, the only one nobody had listed: SURFACE.md counts toast call sites
 * with a regex but never says what any of them SAYS. This walks every
 * non-test .ts/.tsx file under src/ and records, for each call to one of the
 * app's toast APIs:
 *
 *   - `toast(...)` and `toast.<kind>(...)`, where `toast` is imported from
 *     "sonner" (the only toast system since the Radix stack was removed,
 *     src/App.tsx) or re-exported from "@/lib/toast";
 *   - the wrappers in src/lib: `errorToast`, `successToast`
 *     (src/lib/toast.ts) and `confirmConsequential` (src/lib/toastPolicy.ts).
 *
 * For each call it captures the title (first argument) and the description
 * (the `description` property of the options object) — or, for
 * `toast.promise`, its `loading` / `success` / `error` messages — and says of
 * each piece of copy whether it is a LITERAL (a plain string), a TEMPLATE
 * (a template literal with substitutions: its fixed text is recorded) or
 * DYNAMIC (any other expression: its source text is recorded, so a raw
 * `err.message` is visible in the inventory itself).
 *
 * `renders` is false for a `toast.success` / `toast.info` / `toast.message` /
 * `successToast` with no `action`: applyToastPolicy() (src/lib/toastPolicy.ts)
 * replaces those with no-ops app-wide, so their copy never reaches a screen.
 *
 * Consumed by src/test/toastCopy.test.ts (the copy guards) and registered in
 * scripts/check-generated-current.mjs, which fails CI when the committed
 * docs/audit/toast-inventory.json is not what this prints.
 *
 *   node scripts/toast-inventory.mjs            # write docs/audit/toast-inventory.json
 *   node scripts/toast-inventory.mjs --stdout   # print it instead
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
export const OUTPUT = "docs/audit/toast-inventory.json";

/** Sonner methods that raise a toast (dismiss / getToasts do not). */
const TOAST_METHODS = new Set(["success", "error", "warning", "info", "message", "loading", "promise", "custom"]);
/** Kinds applyToastPolicy() turns into no-ops unless the payload has an `action`. */
const SUPPRESSED_UNLESS_ACTION = new Set(["toast.success", "toast.info", "toast.message", "successToast"]);
/** src/lib wrappers whose (message, { description }) become a toast. */
const WRAPPERS = new Set(["errorToast", "successToast", "confirmConsequential"]);
const TOAST_MODULES = new Set(["sonner", "@/lib/toast"]);

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Local names bound to sonner's `toast` or to a wrapper, from this file's imports. */
function toastBindings(sf) {
  const toastNames = new Set();
  const wrapperNames = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings) continue;
    const spec = st.moduleSpecifier.text;
    const nb = st.importClause.namedBindings;
    if (!ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) {
      const imported = (el.propertyName ?? el.name).text;
      const local = el.name.text;
      if (imported === "toast" && TOAST_MODULES.has(spec)) toastNames.add(local);
      if (WRAPPERS.has(imported) && (spec === "@/lib/toast" || spec === "@/lib/toastPolicy" || spec.endsWith("/toast") || spec.endsWith("/toastPolicy"))) {
        wrapperNames.set(local, imported);
      }
    }
  }
  // `const { toast } = await import("sonner")` — the lazy form (nativePush.ts).
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      let init = node.initializer;
      if (ts.isAwaitExpression(init)) init = init.expression;
      if (ts.isCallExpression(init) && init.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = init.arguments[0];
        if (spec && ts.isStringLiteral(spec) && TOAST_MODULES.has(spec.text)) {
          for (const el of node.name.elements) {
            const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
            if (imported === "toast" && ts.isIdentifier(el.name)) toastNames.add(el.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { toastNames, wrapperNames };
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression?.(node))) {
    node = node.expression;
  }
  return node;
}

/**
 * One piece of copy. `text` is the literal, the template's fixed parts joined
 * with `${…}`, or the expression's source; `conditional` carries each branch
 * of a `a ? "x" : "y"` so both literals are swept.
 */
export function describeCopy(node, sf) {
  node = unwrap(node);
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { form: "literal", text: node.text };
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += "${" + span.expression.getText(sf) + "}" + span.literal.text;
    return { form: "template", text };
  }
  if (ts.isConditionalExpression(node)) {
    const a = describeCopy(node.whenTrue, sf);
    const b = describeCopy(node.whenFalse, sf);
    return { form: "dynamic", text: node.getText(sf).replace(/\s+/g, " "), branches: [a, b].filter(Boolean) };
  }
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return { form: "jsx", text: node.getText(sf).replace(/\s+/g, " ") };
  }
  return { form: "dynamic", text: node.getText(sf).replace(/\s+/g, " ") };
}

function objectProp(obj, name) {
  obj = unwrap(obj);
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const p of obj.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && ts.isIdentifier(p.name) && p.name.text === name) {
      return ts.isShorthandPropertyAssignment(p) ? p.name : p.initializer;
    }
    if (ts.isMethodDeclaration(p) && p.name && ts.isIdentifier(p.name) && p.name.text === name) return p;
  }
  return undefined;
}

function hasSpread(obj) {
  obj = unwrap(obj);
  return !!obj && ts.isObjectLiteralExpression(obj) && obj.properties.some((p) => ts.isSpreadAssignment(p));
}

/** The copy a promise-toast message resolves to: a literal, or a function's returned expression. */
function promiseMessage(node, sf) {
  if (!node) return null;
  const fn = unwrap(node);
  if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn))) {
    if (fn.body && !ts.isBlock(fn.body)) return describeCopy(fn.body, sf);
    return { form: "dynamic", text: fn.getText(sf).replace(/\s+/g, " ") };
  }
  return describeCopy(node, sf);
}

/**
 * The toast calls in one file, as AST nodes: `{ sf, calls: [{ node, kind,
 * line, copy: [{ slot, node }], optionsArg }] }`. The copy guards
 * (src/test/toastCopy.test.ts) read these nodes; scanFile() turns them into
 * the JSON inventory.
 */
export function toastCalls(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const { toastNames, wrapperNames } = toastBindings(sf);
  // src/lib/toast.ts and toastPolicy.ts DEFINE the wrappers; their inner
  // `toast.error(message, …)` forwards a parameter and is not copy.
  const rel = relative(ROOT, file).split("\\").join("/");
  const isWrapperModule = rel === "src/lib/toast.ts" || rel === "src/lib/toastPolicy.ts";
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && !isWrapperModule) {
      const callee = node.expression;
      let kind = null;
      if (ts.isIdentifier(callee) && toastNames.has(callee.text)) kind = "toast";
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && toastNames.has(callee.expression.text) && TOAST_METHODS.has(callee.name.text)) {
        kind = `toast.${callee.name.text}`;
      } else if (ts.isIdentifier(callee) && wrapperNames.has(callee.text)) kind = wrapperNames.get(callee.text);
      if (kind) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const [a0, a1] = node.arguments;
        const copy = [];
        if (kind === "toast.promise") {
          for (const k of ["loading", "success", "error"]) {
            const v = objectProp(a1, k);
            if (v) copy.push({ slot: `promise.${k}`, node: v });
          }
        } else {
          if (a0) copy.push({ slot: "title", node: a0 });
          const d = objectProp(a1, "description");
          if (d) copy.push({ slot: "description", node: d });
        }
        calls.push({ node, kind, line: line + 1, copy, optionsArg: a1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sf, rel, calls };
}

export function scanFile(file, source) {
  const { sf, rel, calls } = toastCalls(file, source);
  return calls.map(({ kind, line, copy, optionsArg: a1 }) => {
    const entry = { file: rel, line, kind };
    if (kind === "toast.promise") {
      entry.title = null;
      entry.promise = {};
      for (const c of copy) entry.promise[c.slot.slice("promise.".length)] = promiseMessage(c.node, sf);
      entry.renders = true;
    } else {
      const t = copy.find((c) => c.slot === "title");
      const d = copy.find((c) => c.slot === "description");
      entry.title = t ? describeCopy(t.node, sf) : null;
      if (d) entry.description = describeCopy(d.node, sf);
      const hasAction = !!objectProp(a1, "action") || hasSpread(a1) || (!!a1 && !ts.isObjectLiteralExpression(unwrap(a1)));
      entry.renders = SUPPRESSED_UNLESS_ACTION.has(kind) ? hasAction : true;
    }
    // An error's own machine text reaching this toast (see copyLeaves).
    const raw = copy.flatMap((c) => copyLeaves(c.node, sf).filter((l) => l.type === "raw").map((l) => `${c.slot}: ${l.text}`));
    if (raw.length) entry.rawError = [...new Set(raw)];
    return entry;
  });
}

// ---------------------------------------------------------------------------
// WHAT A TOAST CAN SAY — the value leaves of each copy expression.
// ---------------------------------------------------------------------------

/**
 * The app's error-to-copy mappers. Each maps its ERROR argument to human copy
 * and shows only the listed argument indexes verbatim (the fallback). So
 * `userFacingError(err, "Couldn't save — try again?")` is safe, and
 * `mutationErrorMessage(err, err.message)` is not: its fallback IS the raw
 * message, and mutationErrorMessage returns the fallback for every error that
 * is not a zero-row write (src/lib/mutationResult.ts).
 */
export const ERROR_MAPPERS = {
  userFacingError: [1], // src/lib/userFacingError.ts
  functionErrorMessage: [1], // src/lib/supabaseResult.ts
  mutationErrorMessage: [1], // src/lib/mutationResult.ts
  reportSubmitError: [1], // src/lib/reportErrors.ts
  friendlyAuthError: [], // src/lib/authErrors.ts
  lifecycleErrorMessage: [], // src/lib/lifecycleErrors.ts
  rpcErrorMessage: [], // src/lib/lifecycleErrors.ts
  contactLeakRejectionMessage: [], // src/lib/contactLeakField.ts
  resolveApplyErrorCopy: [], // src/pages/home/applyErrorCopy.ts
};
/** Functions that return their argument's text (so a raw message stays raw). */
const PASS_THROUGH = { endSentence: [0] };
const PASS_THROUGH_METHODS = new Set(["trim", "trimEnd", "trimStart", "slice", "replace", "replaceAll", "toLowerCase", "toUpperCase", "concat"]);
/** Properties of an error object that are machine text. */
const RAW_PROPS = new Set(["message", "details", "hint", "stack"]);
/** A caught error's usual names. */
export const ERRORISH = /^(e|ex|err|error|exc|exception|caught|reason|[a-zA-Z]+(Err|Error))$/;

const isFunctionLike = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);

/** Declarations of `name` visible from `from`: the nearest enclosing scope that declares it. */
function resolveName(from, name) {
  for (let p = from.parent; p; p = p.parent) {
    if (isFunctionLike(p)) {
      const index = p.parameters.findIndex((prm) => ts.isIdentifier(prm.name) && prm.name.text === name);
      if (index >= 0) return { kind: "param", fn: p, index };
    }
    if (ts.isCatchClause(p) && p.variableDeclaration && ts.isIdentifier(p.variableDeclaration.name) && p.variableDeclaration.name.text === name) return { kind: "caught" };
    const stmts = p.statements;
    if (!stmts) continue;
    for (const st of stmts) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) {
            const values = d.initializer ? [d.initializer] : [];
            // `let msg = …; if (x) msg = …;` — every assignment in that scope.
            const scan = (n) => {
              if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && n.left.text === name) values.push(n.right);
              ts.forEachChild(n, scan);
            };
            scan(p);
            const init = d.initializer && unwrap(d.initializer);
            if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return { kind: "function", fn: init };
            return { kind: "value", values };
          }
          if (ts.isObjectBindingPattern(d.name) || ts.isArrayBindingPattern(d.name)) {
            for (const el of d.name.elements) if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === name) return { kind: "destructured" };
          }
        }
      }
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) return { kind: "function", fn: st };
    }
  }
  return { kind: "unknown" };
}

function returnedExpressions(fn) {
  if (fn.body && !ts.isBlock(fn.body)) return [fn.body];
  const out = [];
  const visit = (n) => {
    if (n !== fn && isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return out;
}

function calleeName(call) {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  return null;
}

/**
 * Every value a copy expression can evaluate to, as leaves:
 *   literal  — a plain string (`fragment` when it is only part of a sentence)
 *   template — a template literal's fixed text, `${…}` for each hole
 *   raw      — an error's own machine text: `err.message`, `String(err)`, `${err}`
 *   opaque   — anything this cannot see into (a parameter, a table lookup, a server field)
 * Same-file variables and helper functions are followed; the app's error
 * mappers (ERROR_MAPPERS) are trusted for their error argument only.
 */
export function copyLeaves(node, sf, depth = 0, seen = new Set(), fragment = false) {
  node = unwrap(node);
  if (!node || depth > 10 || seen.has(node)) return [];
  seen.add(node);
  const leaf = (type, text, extra = {}) => [{ type, text, node, fragment, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, ...extra }];
  const rec = (n, frag = fragment) => copyLeaves(n, sf, depth + 1, seen, frag);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return leaf("literal", node.text);
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += "${" + span.expression.getText(sf) + "}" + span.literal.text;
    const holes = node.templateSpans.flatMap((s) => {
      const e = unwrap(s.expression);
      if (ts.isIdentifier(e) && ERRORISH.test(e.text) && ["caught", "param"].includes(resolveName(e, e.text).kind)) {
        return [{ type: "raw", text: "${" + e.text + "}", node: e, fragment: true, line: sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1 }];
      }
      return rec(s.expression, true).filter((l) => l.type === "raw");
    });
    return [...leaf("template", text), ...holes];
  }
  if (ts.isConditionalExpression(node)) return [...rec(node.whenTrue), ...rec(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) return [...rec(node.left), ...rec(node.right)];
    if (op === ts.SyntaxKind.PlusToken) return [...rec(node.left, true), ...rec(node.right, true)];
    return leaf("opaque", node.getText(sf));
  }
  if (ts.isAwaitExpression(node)) return rec(node.expression);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const prop = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : "";
    if (RAW_PROPS.has(prop)) return leaf("raw", node.getText(sf).replace(/\s+/g, " "));
    return leaf("opaque", node.getText(sf).replace(/\s+/g, " "));
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") return [];
    const r = resolveName(node, node.text);
    if (r.kind === "value") return r.values.flatMap((v) => rec(v));
    if (r.kind === "caught") return leaf("raw", node.text);
    if (r.kind === "param") {
      // `const fail = (msg) => toast.error(msg)` — follow every same-file call
      // of that named local function to the argument it passes.
      const fnName = ts.isFunctionDeclaration(r.fn) ? r.fn.name?.text : r.fn.parent && ts.isVariableDeclaration(r.fn.parent) && ts.isIdentifier(r.fn.parent.name) ? r.fn.parent.name.text : null;
      if (fnName) {
        const args = [];
        const find = (n) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fnName && n.arguments[r.index]) {
            const target = resolveName(n.expression, fnName);
            if (target.kind === "function" && target.fn === r.fn) args.push(n.arguments[r.index]);
          }
          ts.forEachChild(n, find);
        };
        find(sf);
        if (args.length) return args.flatMap((a) => rec(a));
      }
    }
    return leaf("opaque", node.text);
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node);
    if (name && Object.hasOwn(ERROR_MAPPERS, name)) return ERROR_MAPPERS[name].flatMap((i) => (node.arguments[i] ? rec(node.arguments[i]) : []));
    if (name && Object.hasOwn(PASS_THROUGH, name)) return PASS_THROUGH[name].flatMap((i) => (node.arguments[i] ? rec(node.arguments[i]) : []));
    if (name === "String" && node.arguments[0]) {
      const a = unwrap(node.arguments[0]);
      if (ts.isIdentifier(a) && ERRORISH.test(a.text)) return leaf("raw", node.getText(sf));
      return rec(a);
    }
    if (ts.isPropertyAccessExpression(node.expression) && PASS_THROUGH_METHODS.has(node.expression.name.text)) return rec(node.expression.expression);
    if (name) {
      const r = resolveName(node, name);
      if (r.kind === "function") return returnedExpressions(r.fn).flatMap((e) => rec(e));
    }
    return leaf("opaque", node.getText(sf).replace(/\s+/g, " ").slice(0, 160));
  }
  if (isFunctionLike(node)) return returnedExpressions(node).flatMap((e) => rec(e));
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return leaf("opaque", "<jsx>");
  return leaf("opaque", node.getText(sf).replace(/\s+/g, " ").slice(0, 160));
}

/** Every copy piece in an entry, with where it sits. */
export function copyPieces(entry) {
  const pieces = [];
  const push = (slot, c) => {
    if (!c) return;
    pieces.push({ slot, ...c });
    for (const b of c.branches ?? []) push(slot, b);
  };
  push("title", entry.title);
  push("description", entry.description);
  for (const [k, v] of Object.entries(entry.promise ?? {})) push(`promise.${k}`, v);
  return pieces;
}

export function inventory(root = ROOT) {
  const files = walk(join(root, "src")).sort();
  const toasts = files.flatMap((f) => scanFile(f, readFileSync(f, "utf8")));
  const byKind = {};
  const byForm = { literal: 0, template: 0, dynamic: 0, jsx: 0 };
  for (const t of toasts) {
    byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    const top = [t.title, t.description, ...Object.values(t.promise ?? {})].filter(Boolean);
    for (const c of top) byForm[c.form] += 1;
  }
  const sortedKinds = Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b)));
  return {
    what: "Every toast call in src/ (TypeScript AST). Regenerate: node scripts/toast-inventory.mjs. Guarded by src/test/toastCopy.test.ts.",
    summary: {
      calls: toasts.length,
      files: new Set(toasts.map((t) => t.file)).size,
      rendering: toasts.filter((t) => t.renders).length,
      suppressedByPolicy: toasts.filter((t) => !t.renders).length,
      byKind: sortedKinds,
      copyPiecesByForm: byForm,
    },
    toasts,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inv = inventory();
  const json = JSON.stringify(inv, null, 2) + "\n";
  if (process.argv.includes("--stdout")) process.stdout.write(json);
  else {
    writeFileSync(join(ROOT, OUTPUT), json);
    console.log(`${OUTPUT}: ${inv.summary.calls} toast calls in ${inv.summary.files} files (${inv.summary.rendering} render, ${inv.summary.suppressedByPolicy} suppressed by toastPolicy).`);
  }
}
