import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import ts from "typescript";
import { blankComments } from "./helpers/blankNonCode";

/**
 * EVERY ROUTED PAGE RENDERS THROUGH A SHARED SHELL. No exceptions without a
 * reason written here.
 *
 * The owner has asked for this repeatedly, in these words: "THEY SHIULD ALL BE
 * THE SAME EVERY SINGLIE FUCKING ONE". It kept being re-asked because nothing
 * enforced it — a page could hand-roll its own frame and every gate stayed
 * green, so the drift was only ever caught by a human noticing that one screen
 * looked different from its neighbours. That is not a check, it is a tax on
 * the owner's attention.
 *
 * WHY THIS FILE PARSES INSTEAD OF GREPPING (2026-09-19). It used to decide a
 * page's shell by testing the literal `<AppShell` (etc.) against the WHOLE FILE
 * with a regex. `npm run vacuity` proved that vacuous the first night it ran:
 * replacing Profile's real shell with a `<div>` left this file GREEN, because
 * Profile's loading branch renders a second <AppShell> forty lines further up
 * and the regex only ever asked "does this token appear anywhere". A page could
 * lose its shell entirely — the thing the owner asked for, three times — and
 * the guard that exists to say so said nothing.
 *
 * So the question asked here is now the real one: does the component's RENDERED
 * OUTPUT root in a sanctioned shell? Every return statement of the page
 * component is walked on the TypeScript AST, through both arms of every
 * conditional, and each one must land on a shell. Tokens elsewhere in the file
 * — a skeleton branch, a comment, a dead import — count for nothing.
 *
 * DERIVED FROM THE WORLD, NOT FROM A LIST. The set of pages under test comes
 * from what `App.tsx` actually imports, so adding a page adds a case
 * automatically. CLAUDE.md records this trap three times over: a registry that
 * is both a test's input AND its definition of correctness cannot fail for a
 * missing member. The ALLOWED shells are a list; the pages checked against
 * them are not.
 *
 * It also catches the inverse, which is how this got confusing: a page file
 * that exists, imports a shell, and is routed by nothing. Seven of those were
 * found on 2026-09-11 (AutoTip, HelprWrapped, HomeHistory, PetProfiles,
 * StrSettings, HelperAnalytics, WorkRecord) — every one a leftover from the
 * move to Profile tabs, and every one still readable by an auditor who would
 * reasonably believe they were live.
 */

const REPO = process.cwd();
const SRC_DIR = join(REPO, "src");
const PAGES_DIR = join(SRC_DIR, "pages");
const APP_TSX = readFileSync(join(SRC_DIR, "App.tsx"), "utf8");

/**
 * The approved shells. A page must render one of these — they are what own the
 * viewport lock, the safe-area insets, the scroll container and the bottom-nav
 * clearance, and re-implementing any of that per page is what CLAUDE.md's
 * "never hand-roll anything" rule exists to stop.
 */
const ALLOWED_SHELLS = [
  "AppShell",        // the one fixed-viewport primitive
  "PageScaffold",    // AppShell + the two-card layout
  "AppPage",         // AppShell + ProfileTabHeader
  "PublicHeaderPage", // PublicLayout + PageHeader (legal, help, support)
  "PublicLayout",    // marketing chrome
  "AuthShell",       // the signed-out / account-state card treatment
] as const;
const SHELL_SET: ReadonlySet<string> = new Set(ALLOWED_SHELLS);

/** The three that own the 100dvh viewport lock — the family the DOCUMENT_SCROLL_ROUTES agreement is about. */
const FIXED_SHELLS = ["AppShell", "PageScaffold", "AppPage"];

/**
 * Components that render no DOM at all, so a return that lands on one is not a
 * page body and needs no shell. Kept to the two router primitives on purpose:
 * this is the only place in the walk where a NAME is trusted rather than a
 * structure, so it is checked — `theNonRenderingComponentsAreWhatWeThink`
 * below asserts each is imported from react-router-dom where it is used, and
 * that at least one page actually relies on it.
 */
const NON_RENDERING: Record<string, string> = {
  Navigate: "react-router-dom",
  Redirect: "react-router-dom",
};

/**
 * Pages that legitimately render no shell, each with the reason. Anything not
 * here MUST use a shell — that is the point of the file.
 */
const NO_SHELL_BY_DESIGN: Record<string, string> = {
  "ActivityLegacyRedirect.tsx": "renders <Navigate>, never any UI",
  "ShortLinkRedirect.tsx": "renders <Navigate>, never any UI",
  "Messages.tsx": "delegates entirely to ConversationList / ChatView, each of which owns a shell",
};

/**
 * DOCUMENT-SCROLL PAGES ARE NOT OFFENDERS — they are the other correct answer.
 *
 * This file used to carry a KNOWN_OFFENDERS set naming Admin.tsx and
 * UserProfile.tsx as debt, because they hand-roll `min-h-screen` instead of
 * rendering a shell. That was wrong, and dangerously so. CLAUDE.md defines TWO
 * legitimate page shapes, not one: fixed-shell pages build on AppShell, and
 * document-scroll pages use "a plain `min-h-screen bg-premium-page pb-safe-nav`
 * wrapper" and explicitly "do NOT use AppShell". Both `/admin` and `/user` are
 * in DOCUMENT_SCROLL_ROUTES. They were never offenders; ALLOWED_SHELLS simply
 * had no entry for the category they belong to, so the test manufactured two.
 *
 * The danger was not the false positive, it was the framing. The old comment
 * said the list "must only ever SHRINK" and that "deleting an entry is the
 * fix", which points the next reader at wrapping both pages in AppShell — and
 * that BREAKS them twice over: `html.app-shell { overflow: hidden }` would clip
 * everything below the fold on a page that is taller than the viewport by
 * design, and the shell's rail inset would land on top of the one
 * `html.web-desktop.desktop-rail:not(.app-shell) #root` already applies,
 * shoving the column over by a second rail width (the PostJob bug). An
 * exemption list that reads as a to-do list is worse than no list at all.
 *
 * So the category is DERIVED FROM THE WORLD, the same way the page set is: a
 * page is allowed to render no shell when the route that reaches it is in
 * DOCUMENT_SCROLL_ROUTES and it renders the documented wrapper. Nothing is
 * exempt by name, so nothing can outlive its reason — and a page that drops out
 * of DOCUMENT_SCROLL_ROUTES starts failing here immediately, which is exactly
 * the coupling CLAUDE.md asks for when it says a page's shell choice and its
 * entry in that list must agree.
 */
const VIEWPORT_HOOK = readFileSync(
  join(SRC_DIR, "hooks/useAppShellViewport.ts"),
  "utf8",
);

/**
 * The route strings inside DOCUMENT_SCROLL_ROUTES, read from the hook itself.
 *
 * Comments are stripped FIRST. That list is more comment than code — each entry
 * carries a paragraph explaining why it is there — and several of those
 * paragraphs quote OTHER route names in double quotes. A naive string scan
 * therefore reports routes that are not on the list at all, which is how
 * "/profile" first appeared here: it is named in a comment saying the six
 * settings sub-pages left the list, and nowhere else.
 */
function documentScrollRoutes(): string[] {
  const body = VIEWPORT_HOOK.slice(
    VIEWPORT_HOOK.indexOf("DOCUMENT_SCROLL_ROUTES = ["),
  );
  // blankComments, not blankNonCode: the very next line harvests the route
  // strings out of this slice, so string BODIES must survive. Comments must
  // not — a commented-out route would otherwise join the list. The old pair of
  // deleting regexes could not tell the two apart, and `//` inside any route
  // string would have eaten the rest of its line. (2026-09-21)
  const list = blankComments(body.slice(0, body.indexOf("];")));
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Routes that keep the app shell on NATIVE while scrolling the document on web.
 * DashboardGuest and Legal both branch on `isNativePlatform` and render a fixed
 * shell on one side of it, so their presence in DOCUMENT_SCROLL_ROUTES is the
 * design, not a disagreement.
 */
function nativeAppShellRoutes(): string[] {
  const m = /NATIVE_APP_SHELL_ROUTES = \[([^\]]*)\]/.exec(VIEWPORT_HOOK);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

/**
 * Page file -> the route paths App.tsx mounts it at.
 *
 * Line-based on purpose. A `<Route … />` regex spanning the element looks
 * obvious and is wrong: every route here nests self-closing components
 * (`<Admin />`) inside the element prop, so a non-greedy match to the first
 * `/>` ends INSIDE the element and consumes the very token you then test for.
 * One `<Route>` is always one line in this file, so the line is the unit.
 *
 * The mount pattern is `<Name` followed by a boundary character, not the old
 * "optional whitespace then a self-closing slash". That propless form missed
 * every page mounted WITH props —
 * `<Activity defaultTab="applied" />` is two routes (/my-jobs, /my-posts) and
 * both came back as "no routes at all", which silently excused Activity from
 * the DOCUMENT_SCROLL_ROUTES agreement check below. The boundary class is what
 * keeps `<Profile` from also matching `<ProfileRouteSkeleton`.
 */
function routePathsForPage(file: string): string[] {
  const component = file.replace(/\.tsx$/, "");
  const mounted = new RegExp(`<${component}[\\s/>]`);
  return APP_TSX.split("\n")
    .filter((line) => line.includes("<Route path=") && mounted.test(line))
    .map((line) => /<Route\s+path="([^"]+)"/.exec(line)?.[1])
    .filter((p): p is string => !!p);
}

/**
 * The documented document-scroll wrapper. `min-h-screen` is the load-bearing
 * half; the page must also paint the page canvas rather than inherit nothing.
 */
const DOC_SCROLL_WRAPPER = /min-h-screen[^"'`]*bg-premium-page|bg-premium-page[^"'`]*min-h-screen/;

/** Page files imported by App.tsx — i.e. the ones a user can actually reach. */
function routedPageFiles(): string[] {
  return readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .filter((f) => {
      const name = f.replace(/\.tsx$/, "");
      // Matches both `import X from "./pages/Name"` and the lazy form
      // `lazyWithPreload(() => import("./pages/Name"))`.
      return new RegExp(`pages/${name}["']`).test(APP_TSX);
    });
}

// ───────────────────────────────────────────────────────────────────────────
// THE AST WALK
//
// Everything below answers ONE question per return statement: what does this
// return actually RENDER, and does that root in a sanctioned shell?
//
// The rule that makes it a real check rather than a deeper grep is the one
// about host elements. Descent passes THROUGH capitalised components — a
// provider like <Tabs> or <SidebarProvider> or <Suspense> wraps a shell
// without framing it — and STOPS DEAD at the first lowercase host element,
// because a <div>/<main>/<section> IS a frame: it establishes the layout box
// the shell exists to own. A host element at the root is therefore a
// hand-rolled page frame, and the only host root that passes is the documented
// document-scroll wrapper on a route that is in DOCUMENT_SCROLL_ROUTES.
//
// Two forms of indirection are followed rather than excused, because both are
// how real pages here are written:
//   - a childless component (`<DashboardBannedScreen />`, `<ActivityPageSkeleton />`)
//     is resolved through its import and the SAME question asked of its returns;
//   - a call to a local JSX helper (`return wrap(<>…</>)` in UserProfile) is
//     resolved to the helper and the same question asked of what IT returns.
// Both were proven to kill: breaking the shell inside DashboardBlockedScreen.tsx,
// or dropping `min-h-screen` from UserProfile's `wrap`, turns this file red.
// ───────────────────────────────────────────────────────────────────────────

const parsed = new Map<string, ts.SourceFile>();
function parseFile(abs: string): ts.SourceFile {
  const hit = parsed.get(abs);
  if (hit) return hit;
  const src = ts.createSourceFile(
    abs,
    readFileSync(abs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  parsed.set(abs, src);
  return src;
}

type FnLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFnLike = (n: ts.Node): n is FnLike =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
  return cur;
}

/** A component body, or a bare JSX const (`const Screen = (<AppShell>…</AppShell>)`). */
type Component = { fn: FnLike } | { jsx: ts.Expression };

/** The declaration for `name`, or for the default export when `name` is null. */
function componentIn(src: ts.SourceFile, name: string | null): Component | null {
  if (name === null || name === "default") {
    let defaultName: string | null = null;
    let inline: FnLike | null = null;
    for (const n of src.statements) {
      if (ts.isExportAssignment(n) && !n.isExportEquals) {
        const e = unwrap(n.expression);
        if (ts.isIdentifier(e)) defaultName = e.text;
        else if (isFnLike(e)) inline = e;
        else if (ts.isCallExpression(e) && e.arguments.length) {
          const a = unwrap(e.arguments[0]);
          if (isFnLike(a)) inline = a; // export default memo(() => …)
        }
      }
      if (ts.isFunctionDeclaration(n) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) inline = n;
    }
    if (inline) return { fn: inline };
    return defaultName ? componentIn(src, defaultName) : null;
  }
  for (const n of src.statements) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) return { fn: n };
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== name || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (isFnLike(init)) return { fn: init };
        // memo(fn) / forwardRef(fn)
        if (ts.isCallExpression(init) && init.arguments.length) {
          const a = unwrap(init.arguments[0]);
          if (isFnLike(a)) return { fn: a };
        }
        if (ts.isJsxElement(init) || ts.isJsxSelfClosingElement(init) || ts.isJsxFragment(init)) return { jsx: init };
      }
    }
  }
  return null;
}

/**
 * Every expression this component can return. Nested function bodies are NOT
 * descended into — a `const renderCard = () => <div/>` inside the component is
 * a fragment of a page, not the page, and treating its return as a page return
 * would flag every page that has one.
 */
function returnsOf(c: Component): (ts.Expression | null)[] {
  if ("jsx" in c) return [c.jsx];
  const fn = c.fn;
  if (fn.body && !ts.isBlock(fn.body)) return [fn.body]; // concise arrow body
  const out: (ts.Expression | null)[] = [];
  const walk = (n: ts.Node): void => {
    if (n !== fn && (isFnLike(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n))) return;
    if (ts.isReturnStatement(n)) {
      out.push(n.expression ?? null);
      return;
    }
    n.forEachChild(walk);
  };
  fn.body?.forEachChild(walk);
  return out;
}

/** The module specifier a JSX tag name comes from — plain imports and `lazy(() => import("…"))`. */
function specifierFor(src: ts.SourceFile, name: string): { spec: string; imported: string } | null {
  for (const n of src.statements) {
    if (ts.isImportDeclaration(n) && n.importClause && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      if (n.importClause.name?.text === name) return { spec, imported: "default" };
      const b = n.importClause.namedBindings;
      if (b && ts.isNamedImports(b)) {
        for (const el of b.elements) if (el.name.text === name) return { spec, imported: (el.propertyName ?? el.name).text };
      }
    }
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== name || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (ts.isCallExpression(init)) {
          const m = /import\(\s*["']([^"']+)["']\s*\)/.exec(init.getText());
          if (m) return { spec: m[1], imported: "default" };
        }
      }
    }
  }
  return null;
}

function resolveSpec(fromAbs: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC_DIR, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromAbs), spec);
  else return null; // node_modules — nothing in this repo to read
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** A local `const wrap = (inner) => (<div …>{inner}</div>)`, at file OR component scope. */
function localHelper(src: ts.SourceFile, name: string): FnLike | null {
  let found: FnLike | null = null;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      isFnLike(unwrap(n.initializer))
    ) {
      found = unwrap(n.initializer) as FnLike;
      return;
    }
    n.forEachChild(walk);
  };
  src.forEachChild(walk);
  return found;
}

const openingOf = (el: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(el) ? el.openingElement : el);
const tagOf = (el: ts.JsxElement | ts.JsxSelfClosingElement) => openingOf(el).tagName.getText();
function classNameOf(el: ts.JsxElement | ts.JsxSelfClosingElement): string {
  for (const a of openingOf(el).attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === "className") return a.initializer?.getText() ?? "";
  }
  return "";
}
const substantiveChildren = (el: ts.JsxElement | ts.JsxFragment) =>
  el.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));

type Verdict = { v: "shell" | "none" | "fail"; why?: string };
type Ctx = {
  abs: string;
  src: ts.SourceFile;
  routes: string[];
  doc: string[];
  depth: number;
  trail: string[];
  shells: Set<string>;
};

const SHELL: Verdict = { v: "shell" };

function classify(expr: ts.Node | null, ctx: Ctx): Verdict {
  const here = ctx.trail.length ? ctx.trail.join(" > ") : "the root of the return";
  if (ctx.depth > 16) return { v: "fail", why: `descent limit reached at ${here}` };
  if (expr === null) return { v: "none", why: "bare return" };

  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr))
    return classify(expr.expression, { ...ctx, depth: ctx.depth + 1 });
  if (ts.isJsxExpression(expr))
    return expr.expression ? classify(expr.expression, { ...ctx, depth: ctx.depth + 1 }) : { v: "none" };

  const k = expr.kind;
  if (
    k === ts.SyntaxKind.NullKeyword ||
    k === ts.SyntaxKind.FalseKeyword ||
    k === ts.SyntaxKind.TrueKeyword ||
    ts.isStringLiteral(expr) ||
    (ts.isIdentifier(expr) && expr.text === "undefined")
  )
    return { v: "none", why: "renders nothing" };

  // BOTH arms, always. A page whose shell survives on one branch of a ternary
  // and is a hand-rolled div on the other is exactly the drift this catches.
  if (ts.isConditionalExpression(expr)) {
    const a = classify(expr.whenTrue, { ...ctx, depth: ctx.depth + 1 });
    if (a.v === "fail") return a;
    const b = classify(expr.whenFalse, { ...ctx, depth: ctx.depth + 1 });
    if (b.v === "fail") return b;
    return a.v === "shell" || b.v === "shell" ? SHELL : { v: "none" };
  }

  if (ts.isBinaryExpression(expr)) {
    const operands = [expr.left, expr.right].filter(
      (o) =>
        ts.isJsxElement(o) ||
        ts.isJsxSelfClosingElement(o) ||
        ts.isJsxFragment(o) ||
        ts.isParenthesizedExpression(o) ||
        ts.isConditionalExpression(o) ||
        ts.isCallExpression(o),
    );
    if (!operands.length) return { v: "none", why: "renders no JSX" };
    const rs = operands.map((o) => classify(o, { ...ctx, depth: ctx.depth + 1 }));
    if (rs.some((r) => r.v === "shell")) return SHELL;
    return rs.find((r) => r.v === "fail") ?? { v: "none" };
  }

  // `return wrap(<>…</>)` — follow the local helper rather than excuse it.
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const helper = localHelper(ctx.src, expr.expression.text);
    if (!helper)
      return {
        v: "fail",
        why: `returns ${expr.expression.text}(…) at ${here}, which is not a local JSX helper — nothing here can see what it renders`,
      };
    const rs = returnsOf({ fn: helper }).map((r) =>
      classify(r, { ...ctx, depth: ctx.depth + 1, trail: [...ctx.trail, `${expr.expression.getText()}()`] }),
    );
    if (rs.some((r) => r.v === "shell")) return SHELL;
    return rs.find((r) => r.v === "fail") ?? { v: "none" };
  }

  if (ts.isJsxFragment(expr)) {
    const kids = substantiveChildren(expr);
    const rs = kids.map((c) => classify(c, { ...ctx, depth: ctx.depth + 1 }));
    if (rs.some((r) => r.v === "shell")) return SHELL;
    if (rs.every((r) => r.v === "none")) return { v: "none" };
    return {
      v: "fail",
      why:
        `the fragment at ${here} renders no sanctioned shell. Its children are: ` +
        kids
          .map((c) =>
            ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) ? `<${tagOf(c)}>` : ts.SyntaxKind[c.kind],
          )
          .join(", "),
    };
  }

  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) {
    const tag = tagOf(expr);
    if (SHELL_SET.has(tag)) {
      ctx.shells.add(tag);
      return SHELL;
    }
    if (tag in NON_RENDERING) return { v: "none", why: `<${tag}> renders no DOM` };

    // A lowercase tag is a HOST element, i.e. a layout box. This is where the
    // descent stops: a page that roots its body in one has hand-rolled the
    // frame the shell exists to own. The one legitimate host root is the
    // documented document-scroll wrapper, and only on a route that says so.
    if (/^[a-z]/.test(tag)) {
      const cn = classNameOf(expr);
      const onDocRoute = ctx.routes.some((p) => ctx.doc.some((r) => p === r || p.startsWith(`${r}/`)));
      if (DOC_SCROLL_WRAPPER.test(cn) && onDocRoute) return { v: "none", why: "documented document-scroll wrapper" };
      return {
        v: "fail",
        why:
          `renders a hand-rolled <${tag}${cn ? ` className=${cn.slice(0, 70)}` : ""}> at ${here}. ` +
          (DOC_SCROLL_WRAPPER.test(cn)
            ? `It looks like the document-scroll wrapper, but none of this page's routes (${ctx.routes.join(", ") || "none found"}) are in DOCUMENT_SCROLL_ROUTES.`
            : `Use one of ${ALLOWED_SHELLS.join(", ")}, or the documented "min-h-screen bg-premium-page" wrapper on a DOCUMENT_SCROLL_ROUTES route.`),
      };
    }

    // A capitalised component WITH children is a wrapper, not a frame
    // (<Tabs>, <SidebarProvider>, <Suspense>) — look inside it.
    const kids = ts.isJsxElement(expr) ? substantiveChildren(expr) : [];
    if (kids.length) {
      const rs = kids.map((c) => classify(c, { ...ctx, depth: ctx.depth + 1, trail: [...ctx.trail, `<${tag}>`] }));
      if (rs.some((r) => r.v === "shell")) return SHELL;
      if (rs.every((r) => r.v === "none")) return { v: "none" };
      return rs.find((r) => r.v === "fail") ?? { v: "none" };
    }

    // A childless component IS the whole output — follow it to its file and
    // ask the same question there.
    const spec = specifierFor(ctx.src, tag);
    if (!spec) return { v: "fail", why: `<${tag} /> at ${here} — no import for it in this file, so nothing can see what it renders` };
    const target = resolveSpec(ctx.abs, spec.spec);
    if (!target)
      return {
        v: "fail",
        why: `<${tag} /> at ${here} comes from "${spec.spec}", outside src/, so nothing here can see whether it renders a shell`,
      };
    const tsrc = parseFile(target);
    const comp = componentIn(tsrc, spec.imported === "default" ? null : spec.imported);
    if (!comp)
      return { v: "fail", why: `<${tag} /> at ${here} — no component declaration found in ${relative(REPO, target)}` };
    const rs = returnsOf(comp).map((r) =>
      classify(r, {
        ...ctx,
        abs: target,
        src: tsrc,
        depth: ctx.depth + 1,
        trail: [...ctx.trail, `<${tag} /> → ${relative(REPO, target)}`],
      }),
    );
    if (rs.some((r) => r.v === "shell")) return SHELL;
    if (rs.every((r) => r.v === "none")) return { v: "none" };
    return rs.find((r) => r.v === "fail") ?? { v: "none" };
  }

  return { v: "fail", why: `the return at ${here} is a ${ts.SyntaxKind[expr.kind]} — nothing here can see what it renders` };
}

type PageReport = {
  file: string;
  routes: string[];
  returns: number;
  shells: Set<string>;
  failures: string[];
  /** true when no component declaration could be found at all — a hole, not a pass. */
  unreadable: boolean;
};

function pageReport(file: string, doc = documentScrollRoutes()): PageReport {
  const abs = join(PAGES_DIR, file);
  const src = parseFile(abs);
  const comp = componentIn(src, null);
  const routes = routePathsForPage(file);
  const shells = new Set<string>();
  if (!comp) return { file, routes, returns: 0, shells, failures: [], unreadable: true };
  const returns = returnsOf(comp);
  const failures = returns
    .map((r) => classify(r, { abs, src, routes, doc, depth: 0, trail: [], shells }))
    .filter((v) => v.v === "fail")
    .map((v) => v.why ?? "unexplained failure");
  return { file, routes, returns: returns.length, shells, failures, unreadable: false };
}

// @mutate src/pages/Profile.tsx | <AppShell\n      scrollable={false} | <div\n      data-was-appshell={false}
// @mutate src/pages/Support.tsx | <PublicHeaderPage | <div
// @mutate src/pages/PostJob.tsx | <AppPage | <main
// @mutate src/pages/UserProfile.tsx | min-h-screen bg-premium-page pb-safe-nav | bg-premium-page pb-safe-nav
// @mutate src/components/dashboard/DashboardBlockedScreen.tsx | <AppShell reserveBottomNav={false} className="bg-premium-page"> | <div className="bg-premium-page">
// @mutate src/hooks/useAppShellViewport.ts | const DOCUMENT_SCROLL_ROUTES = [\n | const DOCUMENT_SCROLL_ROUTES = [\n  "/profile",\n
// @mutate src/hooks/useAppShellViewport.ts | const DOCUMENT_SCROLL_ROUTES = [\n | const DOCUMENT_SCROLL_ROUTES = [\n] as string[];\nconst _EMPTIED = [\n

describe("shell consistency", () => {
  /**
   * THE FLOOR. Every test below derives its inventory from `routedPageFiles()`,
   * which is `readdirSync(src/pages)` ∩ `App.tsx` imports. If either side of
   * that intersection came back empty — a moved directory, a rewritten App.tsx,
   * a regex that stopped matching the lazy import form — every `for` loop below
   * would iterate nothing, every `expect(offenders).toEqual([])` would pass, and
   * this file would report green while checking no page at all.
   *
   * CLAUDE.md: "inventory from source, minus what was checked, must be empty,
   * and every check must be shown able to fail." An empty inventory satisfies
   * the first half and destroys the second.
   */
  it("the routed-page inventory is not empty", () => {
    const routed = routedPageFiles();
    expect(
      routed.length,
      `routedPageFiles() found ${routed.length} routed pages under ${PAGES_DIR}. ` +
        `Every other test in this file iterates that list, so an empty or ` +
        `near-empty inventory makes all of them pass vacuously. If pages really ` +
        `did move, fix PAGES_DIR / the App.tsx import regex — do not lower this floor.`,
    ).toBeGreaterThan(20);
  });

  /**
   * THE SECOND FLOOR, and the one the old grep version never had. The AST walk
   * can go quiet in ways the page list cannot see: `componentIn` failing to
   * find the default export, `returnsOf` descending into nothing, a TS upgrade
   * changing a node predicate. Every one of those yields "no failures" — a
   * green run that examined nothing.
   *
   * So the walk must be shown to have DONE something: every checked page must
   * yield at least one return, and the shells it lands on must actually be
   * found, not merely not-absent.
   */
  it("the AST walk actually reads every page", () => {
    const doc = documentScrollRoutes();
    const reports = routedPageFiles()
      .filter((f) => !(f in NO_SHELL_BY_DESIGN))
      .map((f) => pageReport(f, doc));

    const unreadable = reports.filter((r) => r.unreadable).map((r) => r.file);
    expect(
      unreadable,
      "No component declaration could be found in these page files, so the shell " +
        "check below silently examined nothing in them. Teach componentIn() the " +
        "export form they use — do not let them pass by being unreadable:\n" +
        unreadable.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);

    const noReturns = reports.filter((r) => r.returns === 0).map((r) => r.file);
    expect(noReturns, `returnsOf() found no return statement in: ${noReturns.join(", ")}`).toEqual([]);

    const withShell = reports.filter((r) => r.shells.size > 0);
    expect(
      withShell.length,
      `Only ${withShell.length} of ${reports.length} pages were seen to ROOT in a sanctioned shell. ` +
        `The document-scroll pages legitimately root in a wrapper instead, but most pages are ` +
        `shell pages — a number this low means the walk stopped resolving shells, not that the app changed.`,
    ).toBeGreaterThan(14);

    // Every shell family must be observed in use somewhere. A rename that
    // orphaned one would otherwise just quietly stop matching.
    const seen = new Set(reports.flatMap((r) => [...r.shells]));
    const unseen = ALLOWED_SHELLS.filter((s) => !seen.has(s));
    expect(
      unseen,
      `These sanctioned shells are named in ALLOWED_SHELLS but no routed page was seen to render one: ` +
        `${unseen.join(", ")}. Either a page lost its shell or the walk stopped resolving it.`,
    ).toEqual([]);
  });

  it("every routed page renders through a shared shell", () => {
    const doc = documentScrollRoutes();
    const offenders: string[] = [];
    for (const file of routedPageFiles()) {
      if (file in NO_SHELL_BY_DESIGN) continue;
      const r = pageReport(file, doc);
      for (const why of r.failures) offenders.push(`${file}: ${why}`);
    }
    expect(
      offenders,
      `These pages have a return that renders page content OUTSIDE any shared shell. ` +
        `Root it in one of ${ALLOWED_SHELLS.join(", ")} — or, if a page genuinely renders no UI, ` +
        `add it to NO_SHELL_BY_DESIGN with a reason:\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("a page's shell choice and DOCUMENT_SCROLL_ROUTES agree", () => {
    // CLAUDE.md: "A page's shell choice and its entry in that list must agree."
    // The failure this catches is one-directional and silent: a fixed-shell
    // page whose route is ALSO in DOCUMENT_SCROLL_ROUTES gets no viewport lock
    // (the hook withholds `html.app-shell`), so AppShell's 100dvh frame and the
    // bottom-nav clearance both stop applying and the page quietly scrolls the
    // document instead. Nothing errors; it just stops being the shell it says
    // it is.
    const docRoutes = documentScrollRoutes();
    // FLOOR. This test only ever reports a DISAGREEMENT — a fixed-shell page
    // whose route is in docRoutes. An empty docRoutes therefore makes it pass
    // no matter what the pages do, and `documentScrollRoutes()` parses the hook
    // by string slicing, so a rename or a reformat empties it silently. The
    // mutation runner (scripts/vacuity/) proved exactly that: emptying
    // DOCUMENT_SCROLL_ROUTES left this test green.
    expect(
      docRoutes.length,
      "documentScrollRoutes() parsed 0 routes out of src/hooks/useAppShellViewport.ts. " +
        "That makes the agreement check below pass vacuously — fix the parse, don't lower this floor.",
    ).toBeGreaterThan(5);
    const nativeShell = nativeAppShellRoutes();
    const disagreements: string[] = [];
    for (const file of routedPageFiles()) {
      if (file in NO_SHELL_BY_DESIGN) continue;
      const r = pageReport(file, docRoutes);
      // AuthShell is the documented exception: it is a shell AND it scrolls the
      // document, so its routes belong on the list by design. PublicLayout /
      // PublicHeaderPage are marketing chrome and scroll the document too — the
      // lock only matters for the AppShell family.
      //
      // The shells here are the ones the page ROOTS in, from the AST walk, not
      // every shell token in the file. That distinction is the whole point:
      // Profile mentions AppShell twice and Legal renders AppShell on native
      // and PublicHeaderPage on web, and only what is actually at a root of a
      // return can tell you which lock the page is asking for.
      if (r.shells.has("AuthShell")) continue;
      if (!FIXED_SHELLS.some((s) => r.shells.has(s))) continue;
      for (const path of r.routes) {
        if (nativeShell.includes(path)) continue;
        if (docRoutes.some((d) => path === d || path.startsWith(`${d}/`))) {
          disagreements.push(`${file} renders a fixed shell but ${path} is in DOCUMENT_SCROLL_ROUTES`);
        }
      }
    }
    expect(
      disagreements,
      "A fixed-shell page whose route is in DOCUMENT_SCROLL_ROUTES never gets " +
        "the viewport lock, so its shell silently stops working:\n" +
        disagreements.map((d) => `  - ${d}`).join("\n"),
    ).toEqual([]);
  });

  it("no page file is left behind, importing a shell but routed by nothing", () => {
    const all = readdirSync(PAGES_DIR).filter(
      (f) => f.endsWith(".tsx") && !f.includes(".test."),
    );
    const routed = new Set(routedPageFiles());
    const orphans = all.filter((f) => {
      if (routed.has(f)) return false;
      const src = readFileSync(join(PAGES_DIR, f), "utf8");
      // Only flag files that LOOK like pages — one that renders a shell is
      // claiming to be a screen, so an auditor will read it as live. A literal
      // scan is the right tool HERE and the wrong one above: the question is
      // "does this file read as a live screen", which a mention answers.
      return ALLOWED_SHELLS.some((shell) => new RegExp(`<${shell}[\\s/>]`).test(src));
    });
    expect(
      orphans,
      "These files render a page shell but no route reaches them, so they are dead " +
        "code that still reads as live to anyone auditing the app. Delete them, or " +
        "route them:\n" + orphans.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("the shells it names actually exist", () => {
    // Guards the list above against a rename silently turning every assertion
    // into a no-op — the failure mode where a check passes because it is
    // looking for something that no longer exists anywhere.
    const missing = ALLOWED_SHELLS.filter((shell) => {
      const candidates = [
        `src/components/${shell}.tsx`,
        `src/components/ui/${shell}.tsx`,
        `src/components/marketing/${shell}.tsx`,
        `src/components/auth/${shell}.tsx`,
      ];
      return !candidates.some((c) => existsSync(join(REPO, c)));
    });
    expect(missing, `ALLOWED_SHELLS names components that do not exist: ${missing.join(", ")}`).toEqual([]);
  });

  it("the non-rendering components are what we think they are", () => {
    // NON_RENDERING is the one place the walk trusts a NAME. So it is checked:
    // each entry must come from the module it claims wherever a page imports
    // it, and at least one page must actually depend on the exemption — an
    // exemption nothing uses is an exemption nobody re-reads.
    const wrong: string[] = [];
    let used = 0;
    for (const file of readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx") && !f.includes(".test."))) {
      const src = parseFile(join(PAGES_DIR, file));
      for (const [name, from] of Object.entries(NON_RENDERING)) {
        const spec = specifierFor(src, name);
        if (!spec) continue;
        used++;
        if (spec.spec !== from) wrong.push(`${file} imports ${name} from "${spec.spec}", not "${from}"`);
      }
    }
    expect(wrong, `NON_RENDERING assumes these render no DOM, but they are not the components it thinks:\n${wrong.join("\n")}`).toEqual([]);
    expect(used, "No page imports any NON_RENDERING component — the exemption is dead weight; delete it.").toBeGreaterThan(0);
  });
});
