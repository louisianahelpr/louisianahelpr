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

/**
 * Module-scope `const NAME = "…"` string constants in a file, so a className
 * that is an IDENTIFIER still yields its classes.
 *
 * Without this the detector went blind the moment a component moved its
 * frame into a shared constant — which is exactly what JobCardShell did on
 * 2026-09-20, so that its placeholder could import the frame instead of
 * redrawing it. `classText` saw an identifier, produced "", and JobCardShell
 * stopped counting as a card component: the nested-card check would have
 * passed on the poster shape it exists to catch. A guard that reads only
 * literals fails silently the first time anyone does the right thing.
 */
function stringConsts(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      if (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer)) {
        out.set(d.name.text, d.initializer.text);
      }
    }
  }
  return out;
}

/** Every string fragment a className expression could produce. */
function classText(expr: ts.Node | undefined, consts?: Map<string, string>): string {
  if (!expr) return "";
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) parts.push(n.text);
    else if (ts.isIdentifier(n) && consts?.has(n.text)) parts.push(consts.get(n.text)!);
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
  const consts = stringConsts(sf);
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
    return /^[a-z]/.test(el.tagName.getText()) && GLASS.test(classText(attrs(el).get("className")?.initializer, consts));
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
  const consts = stringConsts(sf);
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
            const cls = classText(attrs(p.openingElement).get("className")?.initializer, consts);
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

/**
 * CROSS-FILE: a card component rendered anywhere inside a JOB CARD.
 *
 * The same-file walk above cannot see the Helpr side's remaining box:
 * HelperTrackerPanel's root is `rounded-2xl liquid-glass p-3`, and it is
 * rendered by ConfirmedSection / ActiveJobSection, which AppliedJobCard renders
 * inside JobCardShell — three files apart. Owner, 2026-09-14: make the Helpr
 * card's tracker panel flat like the poster card's.
 *
 * Render graph from source: for every component, the capitalised JSX tags its
 * body uses ANYWHERE (props like `tracker: <HelperTrackerPanel/>` included).
 * Seeds are the tags inside `<JobCardShell>` in any file; the closure of the
 * graph from those seeds is everything a job card renders. No card component
 * may be in it. Keyed by component name; names are unique under src/.
 */
export function componentRenderGraph(file: string, source: string) {
  const sf = parse(file, source);
  const graph = new Map<string, Set<string>>();
  const seeds = new Set<string>();
  const tagsIn = (root: ts.Node, into: Set<string>) => {
    const v = (n: ts.Node) => {
      const el = ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n) ? n : null;
      if (el) {
        const tag = el.tagName.getText();
        if (/^[A-Z]/.test(tag)) into.add(tag);
      }
      ts.forEachChild(n, v);
    };
    ts.forEachChild(root, v);
  };
  const add = (name: string | undefined, fn: ts.Node | undefined) => {
    if (!name || !/^[A-Z]/.test(name) || !fn) return;
    const s = graph.get(name) ?? new Set<string>();
    tagsIn(fn, s);
    graph.set(name, s);
  };
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n)) add(n.name?.text, n);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) add(d.name.text, d.initializer);
      }
    }
  });
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === "JobCardShell") {
      // `tagsIn` walks below its root, so hand it the element itself.
      tagsIn(n, seeds);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { graph, seeds };
}

export function cardsInsideJobCards(
  inputs: Array<{ file: string; source: string }>,
  cardComponents: Set<string>,
) {
  const graph = new Map<string, Set<string>>();
  const seeds = new Set<string>();
  for (const { file, source } of inputs) {
    const r = componentRenderGraph(file, source);
    for (const [k, v] of r.graph) graph.set(k, new Set([...(graph.get(k) ?? []), ...v]));
    r.seeds.forEach((s) => seeds.add(s));
  }
  const reached = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const name = queue.pop()!;
    if (reached.has(name)) continue;
    reached.add(name);
    for (const t of graph.get(name) ?? []) queue.push(t);
  }
  // The shell is the card itself; the two status panels have their own
  // per-use `embedded` rule above (their glass is prop-gated, not a fixed root).
  const exempt = (n: string) => n === "JobCardShell" || PANELS.has(n);
  return {
    reached,
    nested: [...reached].filter((n) => cardComponents.has(n) && !exempt(n)).sort(),
  };
}

describe("no card component anywhere inside a job card (cross-file)", () => {
  const files = walkFiles(SRC).map((f) => ({ file: f, source: fs.readFileSync(f, "utf8") }));
  const cards = new Set(files.flatMap(({ file, source }) => findCardComponents(file, source)));
  const { reached, nested } = cardsInsideJobCards(files, cards);

  it("found the job-card render tree (a checker that sees nothing proves nothing)", () => {
    // GroupJobHelpers is the poster card's group-job roster: exempted by name
    // until 2026-09-14, now flat like the tracker panels (owner-approved).
    for (const name of ["ConfirmedSection", "ActiveJobSection", "HelperTrackerPanel", "JobTracking", "GroupJobHelpers"]) {
      expect(reached.has(name), `${name} not reached from JobCardShell`).toBe(true);
    }
  });

  it("no component a job card renders wears its own liquid-glass card root", () => {
    expect(nested).toEqual([]);
  });

  it("flags the pre-fix Helpr shape across three files", () => {
    const shell = `export function Card() { return (<JobCardShell><Section /></JobCardShell>); }`;
    const section = `export function Section() { const shared = { tracker: <Panel /> }; return (<div className="px-4">{shared.tracker}</div>); }`;
    const glass = `export function Panel() { return (<div className="rounded-2xl liquid-glass p-3"><JobTracking embedded /></div>); }`;
    const flat = glass.replace("rounded-2xl liquid-glass p-3", "space-y-2");
    const run = (panel: string) => {
      const inputs = [
        { file: "a.tsx", source: shell },
        { file: "b.tsx", source: section },
        { file: "c.tsx", source: panel },
      ];
      const c = new Set(inputs.flatMap(({ file, source }) => findCardComponents(file, source)));
      return cardsInsideJobCards(inputs, c).nested;
    };
    expect(run(glass)).toEqual(["Panel"]);
    expect(run(flat)).toEqual([]);
  });
});

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
    for (const name of ["JobCardShell", "JobTracking"]) {
      expect(cards.has(name), `${name} not detected as a card component`).toBe(true);
    }
    // HelperTrackerPanel was a card component until 2026-09-14; it is now flat
    // (see the cross-file job-card walk below, which is what keeps it so).
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
