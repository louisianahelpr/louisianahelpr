/**
 * Every element in src/ that wears the primary gradient (`btn-grad-primary`),
 * read from the source with the TypeScript parser, as a small DOM fixture that
 * the built stylesheet can be applied to (Q?btn-grad-text-contrast).
 *
 * WHY A FIXTURE AND NOT A SCREEN. 41 sites wear (2026-10-15) the gradient and most of them
 * are a SELECTED or an error state (a picked withdraw reason, a series date
 * waiting to be claimed, a visit over the payment cap, a notifications load
 * that failed). No route walk reaches them all, so the one question that
 * matters (what colour is the text on this gradient, in each theme) is
 * answered per site instead: the site's own class string, inline `color`, and
 * the descendants that carry the text, rendered inside a parent that inherits
 * the page's ink, exactly as an unstated colour would in the app.
 *
 * What it resolves, for the state in which the gradient is ON:
 *  - string literals, templates, `cn()`/`clsx()` arguments, `+` joins;
 *  - `c ? a : b` and `c && a`: the branch that carries `btn-grad-primary`
 *    decides `c`, and every other conditional on the same `c` (the icon's
 *    `active ? "text-…" : "text-…"`, a parent's `color: isActive ? …`) follows
 *    it. A conditional on anything else contributes nothing;
 *  - same-file consts and named imports (`METRIC_CELL_FRAME`), and the
 *    `<Button>` variant's own class string from src/components/ui/button.tsx;
 *  - the PILL shape (LegalTab, Legal, SubscriptionTab): a gradient that has
 *    no children of its own is a backdrop, and the text is its siblings',
 *    coloured by the parent.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const GRAD = "btn-grad-primary";
const GRAD_RE = /(?<![\w-])btn-grad-primary(?![\w-])/;

/** One rendered element of a fixture. */
export type FixtureNode = {
  tag: string;
  cls: string;
  color: string | null;
  /** Carries a glyph a person reads: text (4.5:1) or an icon component (3:1, WCAG 1.4.11). */
  ink: "text" | "icon" | null;
  /** This node is the one painted with the gradient. */
  grad: boolean;
  children: FixtureNode[];
};

/**
 * `resolved` is false when the class string this parser rebuilds for the
 * gradient element does not itself contain the class (the expression is a
 * runtime value it cannot follow). The spec fails on any such site it was not
 * told about, so an unfollowable site is never silently scored as clean.
 */
export type GradSite = { site: string; shape: "self" | "pill"; resolved: boolean; root: FixtureNode };

type Env = { on: Set<string>; off: Set<string> };
type Ctx = { file: string; sf: ts.SourceFile };

const sfCache = new Map<string, ts.SourceFile>();
function sourceFile(file: string): ts.SourceFile {
  let sf = sfCache.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, readFileSync(resolve(REPO, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    sfCache.set(file, sf);
  }
  return sf;
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim();
const negate = (t: string) => (t.startsWith("!") ? t.slice(1) : `!${t}`);

/** A const's initializer, by name: this file first, then a named import. */
function constNamed(name: string, ctx: Ctx): { expr: ts.Expression; ctx: Ctx } | null {
  const local = findConst(ctx.sf, name);
  if (local) return { expr: local, ctx };
  const imp = importedFrom(ctx, name);
  if (!imp) return null;
  const sf = sourceFile(imp.file);
  const init = findConst(sf, imp.name);
  return init ? { expr: init, ctx: { file: imp.file, sf } } : null;
}

/** `chipStyles.chipActive`: the property of a const object literal (shorthand included). */
function propertyOf(expr: ts.PropertyAccessExpression, ctx: Ctx): { expr: ts.Expression; ctx: Ctx } | null {
  if (!ts.isIdentifier(expr.expression)) return null;
  const obj = constNamed(expr.expression.text, ctx);
  if (!obj || !ts.isObjectLiteralExpression(obj.expr)) return null;
  for (const p of obj.expr.properties) {
    if (p.name?.getText(obj.ctx.sf) !== expr.name.text) continue;
    if (ts.isPropertyAssignment(p)) return { expr: p.initializer, ctx: obj.ctx };
    if (ts.isShorthandPropertyAssignment(p)) return constNamed(p.name.text, obj.ctx);
  }
  return null;
}

/** Does this expression carry the class, directly or through a const it names (`chipActive`, `TILE_ACTIVE`)? */
function mentionsGrad(node: ts.Node, ctx: Ctx, depth = 0): boolean {
  let hit = false;
  const visit = (n: ts.Node) => {
    if (hit) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && GRAD_RE.test(n.text)) hit = true;
    else if (ts.isPropertyAccessExpression(n)) {
      const r = depth < 4 ? propertyOf(n, ctx) : null;
      if (r) hit = mentionsGrad(r.expr, r.ctx, depth + 1);
    } else if (ts.isIdentifier(n)) {
      const r = depth < 4 ? constNamed(n.text, ctx) : null;
      if (r) hit = mentionsGrad(r.expr, r.ctx, depth + 1);
    } else ts.forEachChild(n, visit);
  };
  visit(node);
  return hit;
}

/** Record which way the conditional that selects the gradient went. */
function learnConds(expr: ts.Node, env: Env, ctx: Ctx): void {
  const visit = (n: ts.Node) => {
    if (ts.isConditionalExpression(n)) {
      const c = norm(n.condition.getText(ctx.sf));
      if (mentionsGrad(n.whenTrue, ctx)) { env.on.add(c); visit(n.whenTrue); return; }
      if (mentionsGrad(n.whenFalse, ctx)) { env.off.add(c); env.on.add(negate(c)); visit(n.whenFalse); return; }
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && mentionsGrad(n.right, ctx)) {
      env.on.add(norm(n.left.getText(ctx.sf)));
    }
    ts.forEachChild(n, visit);
  };
  visit(expr);
}

/** Which way does `c` go in this state? true / false / unknown. */
function decide(c: string, env: Env): boolean | null {
  if (env.on.has(c)) return true;
  if (env.off.has(c) || env.on.has(negate(c))) return false;
  return null;
}

function findConst(sf: ts.SourceFile, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      const flags = ts.getCombinedNodeFlags(n);
      if (flags & ts.NodeFlags.Const) { found = n.initializer; return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function importedFrom(ctx: Ctx, name: string): { file: string; name: string } | null {
  for (const st of ctx.sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    for (const el of st.importClause.namedBindings.elements) {
      if (el.name.text !== name) continue;
      const spec = (st.moduleSpecifier as ts.StringLiteral).text;
      const base = spec.startsWith("@/") ? resolve(REPO, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(REPO, dirname(ctx.file), spec) : null;
      if (!base) return null;
      for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        if (existsSync(base + ext)) return { file: (base + ext).slice(REPO.length + 1), name: el.propertyName?.text ?? name };
      }
    }
  }
  return null;
}

/** The class string (or colour string) an expression yields in this state. */
function strOf(expr: ts.Expression | undefined, env: Env, ctx: Ctx, depth = 0): string {
  if (!expr || depth > 8) return "";
  const r = (e: ts.Expression | undefined, c: Ctx = ctx) => strOf(e, env, c, depth + 1);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isTemplateExpression(expr)) return expr.head.text + expr.templateSpans.map((s) => ` ${r(s.expression)} ${s.literal.text}`).join("");
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return r(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    const d = decide(norm(expr.condition.getText(ctx.sf)), env);
    return d === true ? r(expr.whenTrue) : d === false ? r(expr.whenFalse) : "";
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) return `${r(expr.left)}${r(expr.right)}`;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return decide(norm(expr.left.getText(ctx.sf)), env) === true ? r(expr.right) : "";
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return r(expr.left) || r(expr.right);
    return "";
  }
  if (ts.isCallExpression(expr)) return expr.arguments.map((a) => r(a)).join(" ");
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.map((a) => r(a as ts.Expression)).join(" ");
  if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
    const hit = ts.isIdentifier(expr) ? constNamed(expr.text, ctx) : propertyOf(expr, ctx);
    return hit ? strOf(hit.expr, env, hit.ctx, depth + 1) : "";
  }
  return "";
}

function attr(el: ts.JsxOpeningLikeElement, name: string): ts.Expression | undefined {
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== name || !p.initializer) continue;
    if (ts.isStringLiteral(p.initializer)) return p.initializer;
    if (ts.isJsxExpression(p.initializer)) return p.initializer.expression;
  }
  return undefined;
}

/** The inline `style={{ color: … }}` in this state, or null. */
function styleColor(el: ts.JsxOpeningLikeElement, env: Env, ctx: Ctx): string | null {
  // `style={selected ? { color: … } : { … }}` (ReviewForm's quick tags, the
  // gift-card occasions): the branch follows the same condition as the class.
  // Reading only a bare object literal scored those two as "no colour" and
  // reported a failure the app does not have (first proof run, 2026-10-15).
  let s = attr(el, "style");
  while (s && (ts.isParenthesizedExpression(s) || ts.isConditionalExpression(s))) {
    if (ts.isParenthesizedExpression(s)) { s = s.expression; continue; }
    const d = decide(norm(s.condition.getText(ctx.sf)), env);
    if (d === null) return null;
    s = d ? s.whenTrue : s.whenFalse;
  }
  if (!s || !ts.isObjectLiteralExpression(s)) return null;
  for (const p of s.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText(ctx.sf) === "color") return strOf(p.initializer, env, ctx) || null;
  }
  return null;
}

/** `<Button>`'s variant class string, read from button.tsx (base + the variant the site names). */
function buttonVariantClasses(el: ts.JsxOpeningLikeElement, ctx: Ctx): string {
  const file = "src/components/ui/button.tsx";
  const sf = sourceFile(file);
  const bctx = { file, sf };
  const v = attr(el, "variant");
  const variant = v && ts.isStringLiteral(v) ? v.text : "default";
  let out = "";
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "cva") {
      out += strOf(n.arguments[0], { on: new Set(), off: new Set() }, bctx);
      const cfg = n.arguments[1];
      if (cfg && ts.isObjectLiteralExpression(cfg)) {
        const variants = cfg.properties.find((p) => p.name?.getText(sf) === "variants") as ts.PropertyAssignment | undefined;
        const vv = variants && ts.isObjectLiteralExpression(variants.initializer)
          ? (variants.initializer.properties.find((p) => p.name?.getText(sf) === "variant") as ts.PropertyAssignment | undefined)
          : undefined;
        const entry = vv && ts.isObjectLiteralExpression(vv.initializer)
          ? (vv.initializer.properties.find((p) => p.name?.getText(sf) === variant) as ts.PropertyAssignment | undefined)
          : undefined;
        if (entry) out += " " + strOf(entry.initializer, { on: new Set(), off: new Set() }, bctx);
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  void ctx;
  return out;
}

const tagName = (el: ts.JsxOpeningLikeElement) => el.tagName.getText();
// `<cell.icon/>` is a component (a member expression), not an intrinsic tag.
const isIntrinsic = (tag: string) => /^[a-z][\w-]*$/.test(tag);

function opening(n: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(n) ? n.openingElement : n;
}

/** JSX children rendered in this state (a `c && <X/>` / `c ? <X/> : <Y/>` follows `c`; unknown = both may show). */
function jsxChildren(n: ts.JsxElement | ts.JsxFragment, env: Env, ctx: Ctx): { kids: (ts.JsxElement | ts.JsxSelfClosingElement)[]; text: boolean } {
  const kids: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  let text = false;
  const take = (e: ts.Node | undefined) => {
    if (!e) return;
    if (ts.isParenthesizedExpression(e)) return take(e.expression);
    if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) { kids.push(e); return; }
    if (ts.isJsxFragment(e)) { const r = jsxChildren(e, env, ctx); kids.push(...r.kids); text ||= r.text; return; }
    if (ts.isConditionalExpression(e)) {
      const d = decide(norm(e.condition.getText(ctx.sf)), env);
      if (d !== false) take(e.whenTrue);
      if (d !== true) take(e.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (decide(norm(e.left.getText(ctx.sf)), env) !== false) take(e.right);
      return;
    }
    if (ts.isIdentifier(e)) {
      // `{body}`: a same-file const holding JSX is walked as if written here.
      let init: ts.Node | null = findConst(ctx.sf, e.text);
      while (init && ts.isParenthesizedExpression(init)) init = init.expression;
      if (init && (ts.isJsxElement(init) || ts.isJsxSelfClosingElement(init) || ts.isJsxFragment(init))) return take(init);
      text = true;
      return;
    }
    if (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e) || ts.isTemplateExpression(e) || ts.isStringLiteral(e)) {
      // `{label}`, `{TAB_LABELS[t]}`, `{fmt(x)}`: text a person reads. A `.map(…)`
      // that returns JSX is walked for its elements instead.
      let jsx = false;
      e.forEachChild(function v(c) { if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) { jsx = true; kids.push(c); return; } c.forEachChild(v); });
      if (!jsx) text = true;
      return;
    }
    if (ts.isElementAccessExpression(e)) { text = true; return; }
  };
  for (const c of n.children) {
    if (ts.isJsxText(c)) { if (c.text.trim()) text = true; }
    else if (ts.isJsxExpression(c)) take(c.expression);
    else take(c);
  }
  return { kids, text };
}

function toNode(n: ts.JsxElement | ts.JsxSelfClosingElement, env: Env, ctx: Ctx, gradEl: ts.Node | null): FixtureNode {
  const el = opening(n);
  const tag = tagName(el);
  let cls = strOf(attr(el, "className"), env, ctx);
  if (tag === "Button") cls = `${buttonVariantClasses(el, ctx)} ${cls}`;
  const color = styleColor(el, env, ctx);
  const { kids, text } = ts.isJsxElement(n) ? jsxChildren(n, env, ctx) : { kids: [], text: false };
  const intrinsic = isIntrinsic(tag);
  return {
    tag: intrinsic ? (/^(svg|path|circle|img|input)$/.test(tag) ? "span" : tag) : "span",
    cls: norm(cls),
    color,
    // A component leaf (an icon) is a glyph too: it paints in currentColor.
    ink: text ? "text" : !intrinsic && !ts.isJsxElement(n) && n !== gradEl ? "icon" : null,
    grad: n === gradEl,
    children: kids.map((k) => toNode(k, env, ctx, gradEl)),
  };
}

function trackedTsx(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "src"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && existsSync(resolve(REPO, f)));
}

/** Every gradient-wearing JSX element in src/, as a fixture. */
export function gradSites(): GradSite[] {
  const out: GradSite[] = [];
  for (const file of trackedTsx()) {
    const sf = sourceFile(file);
    const ctx = { file, sf };
    const visit = (n: ts.Node, parents: (ts.JsxElement | ts.JsxSelfClosingElement)[]) => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        const el = opening(n);
        const cn = attr(el, "className");
        if (cn && mentionsGrad(cn, ctx)) {
          const env: Env = { on: new Set(), off: new Set() };
          learnConds(cn, env, ctx);
          // The JSX conditionals that mount this element (`{isActive && <Pill/>}`) hold too.
          for (let p: ts.Node | undefined = n.parent; p && !ts.isJsxElement(p); p = p.parent) {
            if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) env.on.add(norm(p.left.getText(sf)));
            if (ts.isConditionalExpression(p)) {
              const c = norm(p.condition.getText(sf));
              if (p.whenTrue.pos <= n.pos && n.end <= p.whenTrue.end) env.on.add(c); else { env.off.add(c); env.on.add(negate(c)); }
            }
          }
          const resolved = GRAD_RE.test(strOf(cn, env, ctx));
          const line = sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1;
          const site = `${file}:${line}`;
          const self = ts.isJsxElement(n) ? jsxChildren(n, env, ctx) : { kids: [], text: false };
          const parent = parents[parents.length - 1];
          if (!self.text && self.kids.length === 0 && parent && ts.isJsxElement(parent)) {
            out.push({ site, shape: "pill", resolved, root: toNode(parent, env, ctx, n) });
          } else {
            out.push({ site, shape: "self", resolved, root: toNode(n, env, ctx, n) });
          }
        }
        const next = [...parents, n];
        ts.forEachChild(n, (c) => visit(c, next));
        return;
      }
      ts.forEachChild(n, (c) => visit(c, parents));
    };
    visit(sf, []);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Fixture HTML. Every node is marked SELECTED (aria-pressed/checked/selected,
 * data-state=active) because the gradient is a selected or primary state, so a
 * `data-[state=active]:` or `aria-pressed:` colour applies as it would live.
 */
export function fixtureHtml(node: FixtureNode, id: string): string {
  const attrs = [
    node.cls ? `class="${esc(node.cls)}"` : "",
    node.color ? `style="color:${esc(node.color)}"` : "",
    node.grad ? `data-grad="${id}"` : "",
    node.ink ? `data-ink="${node.ink}"` : "",
    `data-state="active" aria-pressed="true" aria-checked="true" aria-selected="true"`,
  ].filter(Boolean).join(" ");
  const tag = /^(button|a|p|span|div|label|li|ul|section|h\d|strong|em|small|b|i)$/.test(node.tag) ? node.tag : "span";
  const inner = (node.ink ? "Ag " : "") + node.children.map((c) => fixtureHtml(c, id)).join("");
  return `<${tag} ${attrs}>${inner}</${tag}>`;
}
