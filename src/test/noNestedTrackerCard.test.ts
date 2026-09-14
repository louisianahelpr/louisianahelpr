/**
 * CLASS CHECK: no bordered card nested inside another bordered card, for the
 * two job-status panels that carry their own card chrome.
 *
 * JobTracking and JobConfirmation (card variant) each render a
 * `rounded-2xl liquid-glass p-3` box. Rendered inside something that is
 * already a liquid-glass card, that is a doubled card: a bordered box inside a
 * bordered box. Two shapes existed:
 *   - Helpr side: HelperTrackerPanel's own glass wrapper around JobTracking,
 *     hidden by a CSS override (`.tracker-merged > .liquid-glass`) that left
 *     the nested card in the DOM.
 *   - Poster side: PostedJobCard rendering both panels inside JobCardShell,
 *     whose root is `rounded-2xl liquid-glass`.
 * The fix is one prop, `embedded`, which drops the panel's own chrome and
 * keeps its content. JobConfirmation's `variant="inline"` (no box at all)
 * also counts as chrome-free.
 *
 * Inventory comes from source:
 *   - every JSX use of either panel under src/;
 *   - every CARD COMPONENT: a component under src/ whose returned root element
 *     wears `liquid-glass` (found by parsing, not by a hand-kept list).
 * For each panel use, walk its JSX ancestors inside the same file. An
 * intrinsic element wearing `liquid-glass`, or a card component, above it
 * means the use must be chrome-free.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "..");
const PANELS = new Set(["JobTracking", "JobConfirmation"]);
const GLASS = /(^|\s)liquid-glass(\s|$)/;

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const parse = (file: string, source: string) =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Every string fragment a className expression could produce. */
function classText(expr: ts.Node | undefined): string {
  if (!expr) return "";
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) parts.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return parts.join(" ");
}

function attrs(el: ts.JsxOpeningLikeElement) {
  const map = new Map<string, ts.JsxAttribute>();
  for (const a of el.attributes.properties) {
    if (ts.isJsxAttribute(a)) map.set(a.name.getText(), a);
  }
  return map;
}

const openingOf = (n: ts.Node): ts.JsxOpeningLikeElement | null =>
  ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;

/**
 * Names of components whose returned ROOT element wears liquid-glass.
 * Only the first JSX a component returns is its root; a glass element deeper
 * inside (a dialog, a sheet) does not make the component a card.
 */
export function findCardComponents(file: string, source: string): string[] {
  const sf = parse(file, source);
  const names: string[] = [];
  const rootIsGlass = (body: ts.Node): boolean => {
    let found: ts.JsxOpeningLikeElement | null = null;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (n !== body && ts.isFunctionLike(n)) return; // nested callbacks are not the root
      if (ts.isReturnStatement(n) && n.expression) {
        let e: ts.Expression = n.expression;
        while (ts.isParenthesizedExpression(e)) e = e.expression;
        const el = openingOf(e) ?? (ts.isJsxFragment(e) ? null : null);
        if (el) found = el;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(body);
    if (!found) return false;
    const el = found as ts.JsxOpeningLikeElement;
    return /^[a-z]/.test(el.tagName.getText()) && GLASS.test(classText(attrs(el).get("className")?.initializer));
  };
  const consider = (name: string | undefined, fn: ts.Node | undefined) => {
    if (name && /^[A-Z]/.test(name) && fn && rootIsGlass(fn)) names.push(name);
  };
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n)) consider(n.name?.text, n);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        const init = d.initializer;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          consider(d.name.text, init);
        }
      }
    }
  });
  return names;
}

function isChromeFree(el: ts.JsxOpeningLikeElement): boolean {
  const a = attrs(el);
  const embedded = a.get("embedded");
  if (embedded) {
    const init = embedded.initializer;
    if (!init) return true;
    if (ts.isJsxExpression(init) && init.expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
  }
  const variant = a.get("variant")?.initializer;
  return (
    el.tagName.getText() === "JobConfirmation" &&
    !!variant &&
    ts.isStringLiteral(variant) &&
    variant.text === "inline"
  );
}

export type NestedCardViolation = { file: string; line: number; panel: string; wrapper: string };

export function findNestedPanelCards(file: string, source: string, cardComponents: Set<string>) {
  const sf = parse(file, source);
  const uses: Array<{ line: number; panel: string }> = [];
  const violations: NestedCardViolation[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && PANELS.has(n.tagName.getText())) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const panel = n.tagName.getText();
      uses.push({ line, panel });
      if (!isChromeFree(n)) {
        let p: ts.Node | undefined = ts.isJsxOpeningElement(n) ? n.parent.parent : n.parent;
        while (p && !ts.isFunctionLike(p)) {
          if (ts.isJsxElement(p)) {
            const tag = p.openingElement.tagName.getText();
            const cls = classText(attrs(p.openingElement).get("className")?.initializer);
            const wrapper = /^[a-z]/.test(tag)
              ? GLASS.test(cls) ? `<${tag} className="${cls.trim()}">` : null
              : cardComponents.has(tag) ? `<${tag}> (card component)` : null;
            if (wrapper) {
              violations.push({ file: path.relative(SRC, file), line, panel, wrapper });
              break;
            }
          }
          p = p.parent;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { uses, violations };
}

describe("no bordered card nested inside another (JobTracking / JobConfirmation)", () => {
  const files = walkFiles(SRC).map((f) => ({ f, src: fs.readFileSync(f, "utf8") }));
  const cards = new Set(files.flatMap(({ f, src }) => findCardComponents(f, src)));
  const results = files.map(({ f, src }) => ({ f, ...findNestedPanelCards(f, src, cards) }));
  const uses = results.flatMap((r) => r.uses.map((u) => `${path.relative(SRC, r.f)}:${u.line} ${u.panel}`));
  const violations = results.flatMap((r) => r.violations);

  it("found the inventories (a checker that sees nothing proves nothing)", () => {
    expect(uses.length, uses.join("\n")).toBeGreaterThanOrEqual(4);
    expect(uses.some((u) => u.includes("HelperTrackerPanel.tsx"))).toBe(true);
    expect(uses.filter((u) => u.includes("PostedJobCard.tsx")).length).toBe(2);
    // Derived, not listed: the shared job card shell and both panels are cards.
    for (const name of ["JobCardShell", "JobTracking", "HelperTrackerPanel"]) {
      expect(cards.has(name), `${name} not detected as a card component`).toBe(true);
    }
  });

  it("every panel use inside a liquid-glass element or card component is chrome-free", () => {
    expect(
      violations.map((v) => `${v.file}:${v.line} <${v.panel}> inside ${v.wrapper}`),
    ).toEqual([]);
  });

  it("the checker flags both pre-fix shapes (Helpr glass wrapper, poster JobCardShell)", () => {
    const helpr = `export function P() {
      return (
        <div className="tracker-merged rounded-2xl liquid-glass p-3 space-y-2">
          <JobTracking jobId="j" />
          <div className="pt-2 border-t"><JobConfirmation variant="inline" jobId="j" /></div>
        </div>
      );
    }`;
    expect(findNestedPanelCards("h.tsx", helpr, cards).violations.map((x) => x.panel)).toEqual(["JobTracking"]);
    expect(findNestedPanelCards("h.tsx", helpr.replace("<JobTracking ", "<JobTracking embedded "), cards).violations).toEqual([]);

    const poster = `export function C() {
      return (
        <JobCardShell rail="x">
          <div className="px-4 py-2.5 space-y-2">
            <div onClick={() => {}}><JobTracking includePostingSteps jobId="j" /></div>
          </div>
          <div className="px-4 pb-3 space-y-3"><JobConfirmation jobId="j" isOwner /></div>
        </JobCardShell>
      );
    }`;
    expect(findNestedPanelCards("p.tsx", poster, cards).violations.map((x) => x.panel)).toEqual(["JobTracking", "JobConfirmation"]);
    const fixed = poster.replace("<JobTracking ", "<JobTracking embedded ").replace("<JobConfirmation ", "<JobConfirmation embedded ");
    expect(findNestedPanelCards("p.tsx", fixed, cards).violations).toEqual([]);
    // A non-card component in between does not hide the card above it.
    const wrapped = poster.replace('<div onClick={() => {}}>', "<Collapsible>").replace("</JobTracking></div>", "");
    expect(findNestedPanelCards("p.tsx", wrapped.replace('jobId="j" /></div>', 'jobId="j" /></Collapsible>'), cards).violations.length).toBeGreaterThan(0);
  });

  it("card-component detection reads the returned ROOT only", () => {
    const root = `export function Shell({ children }) { return (<div className="relative rounded-2xl liquid-glass">{children}</div>); }`;
    const deep = `export function Page() { const x = () => <div className="liquid-glass" />; return (<section className="p-4"><div className="liquid-glass" /></section>); }`;
    expect(findCardComponents("a.tsx", root)).toEqual(["Shell"]);
    expect(findCardComponents("b.tsx", deep)).toEqual([]);
  });

  it("`embedded` really removes the chrome: every liquid-glass box in both panels is the embedded=false branch", () => {
    for (const rel of ["components/JobTracking.tsx", "components/JobConfirmation.tsx"]) {
      const file = path.join(SRC, rel);
      const sf = parse(file, fs.readFileSync(file, "utf8"));
      const bad: number[] = [];
      let seen = 0;
      const visit = (n: ts.Node) => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && GLASS.test(n.text)) {
          seen++;
          const c = n.parent;
          const ok = ts.isConditionalExpression(c) && c.whenFalse === n && c.condition.getText() === "embedded";
          if (!ok) bad.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      expect(seen, `${rel} has no liquid-glass box at all`).toBeGreaterThan(0);
      expect(bad, `${rel}: liquid-glass not gated on embedded at lines ${bad.join(",")}`).toEqual([]);
    }
  });
});
