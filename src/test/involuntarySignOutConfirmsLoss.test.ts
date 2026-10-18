/**
 * Every path that sends a signed-in person to Log In WITHOUT them asking must
 * first prove the session is gone with confirmSessionLost() (src/lib/sessionLoss.ts),
 * which tries refreshSession() and never answers "lost" on a network error.
 *
 * Why (owner incident, 2026-10-09 21:45Z, measured in prod edge/auth logs and
 * error_logs): the owner's Mac woke with an expired access token, the refresh
 * failed on the network, getSession() returned null, ~35 requests went out with
 * no JWT, two came back "permission denied", and ProtectedRoute's session-lost
 * net read the null getSession() as "signed out" and hard-redirected to /login.
 * The same device's refresh succeeded 230 ms later; the session was alive.
 *
 * The CLASS, read from source with the TypeScript parser (so comments are never
 * code): every HARD navigation in src/ (non-test), each OCCURRENCE on its own:
 *   - `<…>location.replace(x)` / `<…>location.assign(x)` (bare `location` too),
 *   - `<…>location.href = x`,
 *   - `window|document|globalThis|self|top|parent.location = x`,
 * whatever `x` is: a literal, an identifier or any expression. Each one must be
 *   1. provably not /login: a string literal, or a template whose first path
 *      segment is written out, that does not contain "/login"; or
 *   2. guarded IN ITS OWN FUNCTION by an awaited confirmSessionLost() result:
 *      the function is `confirmSessionLost().then((lost) => …)`'s callback, or
 *      holds `const lost = await confirmSessionLost()`, and before the
 *      navigation an `if (!lost …) return|throw` (or `||` chain holding `!lost`)
 *      exits, or the navigation sits inside `if (lost …)`; or
 *   3. on ALLOWED, keyed per occurrence, with its reason. ALLOWED is exact in
 *      both directions: an entry that matches nothing, or matches a navigation
 *      that is now provably not /login or now guarded, fails.
 * A user's own Log Out goes through React Router's navigate after a click and
 * is not a hard navigation, so it is not in this class.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

/**
 * Hard navigations allowed to reach /login (or an unknown target) without a
 * confirmSessionLost() guard. Key: `<file> | <enclosing function> | <navigation
 * text, whitespace collapsed>`; one occurrence per key.
 */
// @two-way src/test/involuntarySignOutConfirmsLoss.test.ts:an entry is one occurrence, drop or fix it
const ALLOWED = new Map<string, string>([
  [
    "src/hooks/useSessionTimeout.ts | (anonymous) | window.location.href = \"/login\"",
    "the 30-minute idle sign-out of a session that IS present, and not mounted at all (SessionManager.tsx, mounted by App.tsx; a test below keeps it unmounted while it is listed)",
  ],
  [
    "src/lib/openExternalUrl.ts | openExternalUrl | window.location.href = url",
    "the web hand-off to an external URL its caller asked for (Stripe checkout and onboarding): a voluntary tap, never a session check",
  ],
  [
    "src/lib/nativeReturnBounce.ts | bounceToNativeAppIfReturning | window.location.href = target",
    "the website-in-a-sheet bouncing to the helpr:// scheme; the target always starts with NATIVE_RETURN_SCHEME, never /login",
  ],
  [
    "src/lib/chunkReload.ts | hardReloadBypassCache | window.location.replace(url.toString())",
    "reloads the CURRENT page with a cache-buster; it goes wherever the person already is",
  ],
  [
    "src/lib/openSignedDocument.ts | openSignedDocument | tab.location.href = url",
    "points the admin's freshly opened document tab at a signed storage URL; a new tab, never this page",
  ],
  [
    "src/lib/appleSubscriptions.ts | openAppleSubscriptions | window.location.assign(APPLE_SUBSCRIPTIONS_URL)",
    "an Apple member's Manage tap opening Apple's manage-subscriptions page (a constant https://apps.apple.com URL, Q1797): a voluntary tap, never a session check",
  ],
]);

type Target = "login" | "unknown" | "not-login";
type Nav = { file: string; line: number; key: string; text: string; target: Target; guarded: boolean };

const WINDOWISH = new Set(["window", "document", "globalThis", "self", "top", "parent"]);
const isLocationExpr = (e: ts.Expression): boolean =>
  (ts.isIdentifier(e) && e.text === "location") || (ts.isPropertyAccessExpression(e) && e.name.text === "location");

const classifyTarget = (e: ts.Expression | undefined): Target => {
  if (!e) return "unknown";
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.includes("/login") ? "login" : "not-login";
  if (ts.isTemplateExpression(e)) {
    if ([e.head.text, ...e.templateSpans.map((sp) => sp.literal.text)].some((t) => t.includes("/login"))) return "login";
    // `/jobs/${id}` is provably not /login: its first path segment is written out.
    const m = /^\/([^/?#]+)[/?#]/.exec(e.head.text);
    return m && m[1] !== "login" ? "not-login" : "unknown";
  }
  return "unknown";
};

const isConfirmCall = (e: ts.Node): boolean =>
  ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "confirmSessionLost";
const isAwaitedConfirm = (e: ts.Node): boolean => {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return ts.isAwaitExpression(e) && isConfirmCall(e.expression);
};
/** `name` (or an awaited confirm call) as one operand of a chain joined by `op`. */
const chainHas = (e: ts.Expression, op: ts.SyntaxKind, leaf: (x: ts.Expression) => boolean): boolean => {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === op) return chainHas(e.left, op, leaf) || chainHas(e.right, op, leaf);
  return leaf(e);
};
const isName = (name: string | null) => (e: ts.Expression): boolean =>
  (name !== null && ts.isIdentifier(e) && e.text === name) || isAwaitedConfirm(e);
const isNotName = (name: string | null) => (e: ts.Expression): boolean =>
  ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken && isName(name)(e.operand);
const exits = (s: ts.Statement): boolean => {
  if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return true;
  if (ts.isBlock(s)) {
    const last = s.statements[s.statements.length - 1];
    return !!last && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
  }
  return false;
};

const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n);

const functionName = (fn: ts.FunctionLikeDeclaration | undefined): string => {
  if (!fn) return "(module)";
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
  return "(anonymous)";
};

/** Is `nav` guarded by an awaited confirmSessionLost() result inside its own function `fn`? */
const isGuarded = (nav: ts.Node, fn: ts.FunctionLikeDeclaration | undefined): boolean => {
  if (!fn || !fn.body) return false;
  // Which name holds the awaited answer in this function?
  let name: string | null = null;
  const call = fn.parent;
  if (
    call && ts.isCallExpression(call) && call.arguments[0] === fn &&
    ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "then" &&
    isConfirmCall(call.expression.expression) && fn.parameters[0] && ts.isIdentifier(fn.parameters[0].name)
  ) {
    name = fn.parameters[0].name.text;
  } else {
    const visit = (n: ts.Node): void => {
      if (name !== null || n.pos >= nav.pos) return;
      if (n !== fn && isFunctionLike(n)) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isAwaitedConfirm(n.initializer)) {
        name = n.name.text;
        return;
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn.body, visit);
  }
  // Walk up from the navigation to its function, looking for the check.
  for (let child: ts.Node = nav, n = nav.parent; n && child !== fn.body; child = n, n = n.parent) {
    if (ts.isIfStatement(n) && n.thenStatement === child && chainHas(n.expression, ts.SyntaxKind.AmpersandAmpersandToken, isName(name))) return true;
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      const idx = n.statements.indexOf(child as ts.Statement);
      for (const s of n.statements.slice(0, Math.max(idx, 0))) {
        if (ts.isIfStatement(s) && !s.elseStatement && exits(s.thenStatement) && chainHas(s.expression, ts.SyntaxKind.BarBarToken, isNotName(name))) return true;
      }
    }
    if (n === fn) break;
  }
  return false;
};

/** Every hard navigation in one file's source. */
const hardNavigations = (file: string, code: string): Nav[] => {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Nav[] = [];
  const record = (node: ts.Node, target: ts.Expression | undefined) => {
    let fn: ts.FunctionLikeDeclaration | undefined;
    for (let p = node.parent; p; p = p.parent) if (isFunctionLike(p)) { fn = p; break; }
    const text = node.getText(sf).replace(/\s+/g, " ");
    out.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      key: `${file} | ${functionName(fn)} | ${text}`,
      text,
      target: classifyTarget(target),
      guarded: isGuarded(node, fn),
    });
  };
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === "replace" || n.expression.name.text === "assign") &&
      isLocationExpr(n.expression.expression)
    ) {
      record(n, n.arguments[0]);
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left)) {
      const { expression: obj, name } = n.left;
      if (name.text === "href" && isLocationExpr(obj)) record(n, n.right);
      else if (name.text === "location" && ts.isIdentifier(obj) && WINDOWISH.has(obj.text)) record(n, n.right);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

const inventory = (): Nav[] => {
  const out: Nav[] = [];
  (function walk(d: string) {
    for (const dirent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, dirent.name);
      if (dirent.isDirectory()) {
        if (p === join("src", "test")) continue;
        walk(p);
      } else if (/\.tsx?$/.test(dirent.name) && !/\.test\./.test(dirent.name) && !/\.d\.ts$/.test(dirent.name)) {
        out.push(...hardNavigations(p, readFileSync(p, "utf8")));
      }
    }
  })("src");
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.line - b.line);
};

const needsGuard = (n: Nav) => n.target !== "not-login";

describe("involuntary sign-outs confirm the session is really gone", () => {
  const nav = (code: string) => hardNavigations("x.ts", code);

  it("the detector sees every navigation shape and target kind, and ignores comments", () => {
    expect(nav("window.location.replace(`/login?redirect=x`)")[0].target).toBe("login");
    expect(nav('window.location.href = "/login";')[0].target).toBe("login");
    expect(nav('location.assign("/login")')[0].target).toBe("login");
    expect(nav('window.location = "/login"')[0].target).toBe("login");
    expect(nav("location.replace(x)")[0].target).toBe("unknown");
    expect(nav("window.location.assign(next)")[0].target).toBe("unknown");
    expect(nav("tab.location.href = buildUrl()")[0].target).toBe("unknown");
    expect(nav("window.location.href = `${base}/login`")[0].target).toBe("login");
    expect(nav("window.location.href = `/${seg}`")[0].target).toBe("unknown");
    expect(nav("window.location.href = `/jobs/${id}`")[0].target).toBe("not-login");
    expect(nav('window.location.assign("/account-banned")')[0].target).toBe("not-login");
    expect(nav('// window.location.replace("/login")')).toEqual([]);
    expect(nav(blankComments('/* location.href = "/login" */'))).toEqual([]);
    expect(nav('navigate("/login")')).toEqual([]);
    expect(nav('errors.location = "Add your city"; a.href = url;')).toEqual([]);
  });

  it("the guard check is per occurrence and needs an AWAITED result check in the same function", () => {
    const guarded = (code: string) => nav(code).map((n) => n.guarded);
    // .then callback with an early exit on !lost (ProtectedRoute's shape).
    expect(guarded('void confirmSessionLost().then((lost) => { if (c || !lost) return; location.replace("/login"); });')).toEqual([true]);
    // .then callback with the redirect inside if (lost).
    expect(guarded('confirmSessionLost().then((lost) => { if (lost) location.replace("/login"); });')).toEqual([true]);
    // awaited const + early exit.
    expect(guarded('async function f() { const lost = await confirmSessionLost(); if (!lost) { return; } location.href = "/login"; }')).toEqual([true]);
    // awaited call straight in the condition.
    expect(guarded('async function f() { if (await confirmSessionLost()) location.assign("/login"); }')).toEqual([true]);
    // NOT awaited: a Promise is always truthy.
    expect(guarded('async function f() { const lost = confirmSessionLost(); if (!lost) return; location.href = "/login"; }')).toEqual([false]);
    // Called but never checked.
    expect(guarded('async function f() { await confirmSessionLost(); location.href = "/login"; }')).toEqual([false]);
    // The check is AFTER the redirect.
    expect(guarded('async function f() { const lost = await confirmSessionLost(); location.href = "/login"; if (!lost) return; }')).toEqual([false]);
    // A second, unguarded redirect beside a guarded one: per occurrence.
    expect(
      guarded('function g() { void confirmSessionLost().then((lost) => { if (!lost) return; location.replace("/login"); }); window.addEventListener("x", () => location.replace("/login")); }'),
    ).toEqual([true, false]);
    // A guard in the OUTER function does not cover a nested handler.
    expect(guarded('async function f() { const lost = await confirmSessionLost(); if (!lost) return; setTimeout(() => { location.href = "/login"; }); }')).toEqual([false]);
  });

  it("every hard navigation in src is provably not /login, guarded, or allowlisted (per occurrence)", () => {
    const all = inventory();
    // Floor: 14 hard navigations in src on 2026-10-11 (ProtectedRoute, main.tsx,
    // the account-banned redirects, openExternalUrl, chunkReload, …).
    expect(all.length).toBeGreaterThan(12);

    const keyCounts = new Map<string, number>();
    for (const n of all) keyCounts.set(n.key, (keyCounts.get(n.key) ?? 0) + 1);
    const offenders = all
      .filter((n) => needsGuard(n) && !n.guarded && !ALLOWED.has(n.key))
      .map((n) => `${n.file}:${n.line} ${n.text} [target ${n.target}] key: ${n.key}`);
    expect(offenders, "await confirmSessionLost() and exit on !lost before this navigation (src/lib/sessionLoss.ts), or allowlist it with a reason").toEqual([]);

    // ProtectedRoute's session-lost net is in the inventory, and guarded.
    const pr = all.filter((n) => n.file === join("src", "components", "ProtectedRoute.tsx"));
    expect(pr.map((n) => [n.target, n.guarded])).toEqual([["login", true]]);

    // Two-way: each entry matches exactly one occurrence that still needs it.
    for (const key of ALLOWED.keys()) {
      const hits = all.filter((n) => n.key === key);
      expect(hits.length, `${key}: matches ${hits.length} navigations; an entry is one occurrence, drop or fix it`).toBe(1);
      expect(needsGuard(hits[0]), `${key}: its target is provably not /login now, drop it from ALLOWED`).toBe(true);
      expect(hits[0].guarded, `${key}: confirms now, drop it from ALLOWED`).toBe(false);
      expect(keyCounts.get(key)).toBe(1);
    }
  });

  it("the allowlisted idle sign-out stays unmounted", () => {
    // App.tsx and the boot-hook component it mounts (moved out of App.tsx, Q806).
    for (const f of [join("src", "App.tsx"), join("src", "components", "SessionManager.tsx")]) {
      const app = blankComments(readFileSync(f, "utf8"));
      expect(app.length, `${f} is empty`).toBeGreaterThan(200);
      expect(/\buseSessionTimeout\s*\(/.test(app), f).toBe(false);
    }
  });

  it("confirmSessionLost() refreshes first and treats a network failure as NOT lost", () => {
    const code = blankComments(readFileSync(join("src", "lib", "sessionLoss.ts"), "utf8"));
    expect(code).toMatch(/auth\.refreshSession\s*\(/);
    expect(code).toMatch(/AuthRetryableFetchError/);
  });
});

// @mutate src/components/ProtectedRoute.tsx |       void confirmSessionLost().then((lost) => { |       void Promise.resolve(true).then((lost) => {
// @mutate src/components/ProtectedRoute.tsx |     window.addEventListener(PERMISSION_DENIED_EVENT, onDenied); |     window.addEventListener(PERMISSION_DENIED_EVENT, onDenied);\n    window.addEventListener(PERMISSION_DENIED_EVENT, () => window.location.replace("/login?signed_out=session-lost"));
// @mutate src/components/CancellationDialog.tsx |         window.location.assign("/account-banned"); |         window.location.assign(String("/account-banned"));
