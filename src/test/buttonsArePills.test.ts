/**
 * CLASS GUARD: every button is a pill.
 *
 * Owner, 2026-10-29, with a screenshot of the Home empty feed, whose "Post a
 * job" (EmptyFeedActions.tsx) was a rounded rectangle: "should all be pill
 * shaped". The cause was the Button base itself (`rounded-ds-md` in
 * `buttonVariants`) plus 69 `<Button>` call sites and 8 raw glossy primary
 * CTAs that restated `rounded-ds-md` (or `rounded-ds-sm` / `rounded-2xl`) on
 * their own. The base is now `rounded-full` and every override is gone.
 *
 * Three checks, all read from the TypeScript AST (so a comment, or a `>` in a
 * comment inside a JSX tag, cannot hide or invent a hit):
 *   1. The `buttonVariants` base string carries `rounded-full`, and no part of
 *      the cva call (base, variants, sizes) carries any other radius.
 *   2. Every `<Button>` in src/ (tracked .tsx, tests excluded): no string inside
 *      its `className` (including a same-file const it names, and a `cn(...)`
 *      wrapper) carries a non-pill radius.
 *   3. Every string literal in src/ that wears `btn-grad-primary` (the glossy
 *      primary surface, raw `<button>`s and their sliding selected pills
 *      included) carries no non-pill radius.
 * Cards, inputs, sheets, chips and avatars are not buttons and are not read.
 *
 * @mutate src/components/ui/button.tsx | whitespace-nowrap rounded-full text-ds-15 | whitespace-nowrap rounded-ds-md text-ds-15
 * @mutate src/components/dashboard/EmptyFeedActions.tsx | <Button onClick={gate("post", () => navigate("/post-job"))} {...gatedProps("post")}> | <Button onClick={gate("post", () => navigate("/post-job"))} {...gatedProps("post")} className="rounded-ds-md">
 * @mutate src/components/sections/AppTopBar.tsx | "h-10 w-10 shrink-0 self-center btn-press | "h-10 w-10 shrink-0 self-center rounded-ds-md btn-press
 * @mutate src/components/series/SeriesDatesPanel.tsx | btn-grad-primary min-h-[44px] px-4 rounded-full text-ds-12 | btn-grad-primary min-h-[44px] px-4 rounded-ds-md text-ds-12
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");

/** A Tailwind radius token that is not a pill: `rounded`, `rounded-ds-md`, `sm:rounded-2xl`, `rounded-t-lg`... `rounded-full` (with or without modifiers) is the one allowed. */
export function nonPillRadii(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])((?:[a-z0-9-]+:)*rounded(?:-[a-z0-9[\]/.-]+)?)(?![\w-])/g)]
    .map((m) => m[1])
    .filter((t) => !/(^|:)rounded-full$/.test(t));
}

const parse = (file: string, src: string) =>
  ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Every string / template piece under `node` (comments are trivia, never visited). */
function stringsUnder(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Same-file `const NAME = <initializer>` map, for a className that names a constant. */
function constInitializers(sf: ts.SourceFile): Map<string, ts.Expression> {
  const m = new Map<string, ts.Expression>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) m.set(n.name.text, n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return m;
}

export interface Hit { where: string; tokens: string[] }

/** The second check, for one file: `<Button>` className strings, following same-file constants one level. */
export function buttonRadiusHits(file: string, src: string): { buttons: number; hits: Hit[] } {
  const sf = parse(file, src);
  const consts = constInitializers(sf);
  const hits: Hit[] = [];
  let buttons = 0;
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === "Button") {
      buttons++;
      for (const attr of n.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== "className" || !attr.initializer) continue;
        const texts = stringsUnder(attr.initializer);
        const ids = new Set<string>();
        const collect = (x: ts.Node) => {
          if (ts.isIdentifier(x)) ids.add(x.text);
          ts.forEachChild(x, collect);
        };
        collect(attr.initializer);
        for (const id of ids) {
          const init = consts.get(id);
          if (init && !ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) texts.push(...stringsUnder(init));
        }
        const tokens = texts.flatMap(nonPillRadii);
        if (tokens.length) hits.push({ where: `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`, tokens: [...new Set(tokens)] });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { buttons, hits };
}

/** The third check, for one file: every string literal wearing btn-grad-primary. */
export function primaryRadiusHits(file: string, src: string): { primaries: number; hits: Hit[] } {
  const sf = parse(file, src);
  const hits: Hit[] = [];
  let primaries = 0;
  const visit = (n: ts.Node) => {
    const text =
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
        ? n.text
        : null;
    if (text !== null && /(?<![\w-])btn-grad-primary(?![\w-])/.test(text)) {
      primaries++;
      const tokens = nonPillRadii(text);
      if (tokens.length) hits.push({ where: `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`, tokens });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { primaries, hits };
}

const SOURCES = trackedFiles("src").filter(
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/") && !f.endsWith(".d.ts"),
);
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

describe("every button is a pill (owner, 2026-10-29)", () => {
  it("the buttonVariants base is rounded-full, and no variant or size restates a radius", () => {
    const file = "src/components/ui/button.tsx";
    const sf = parse(file, read(file));
    let cvaCall: ts.CallExpression | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "buttonVariants" && n.initializer && ts.isCallExpression(n.initializer)) cvaCall = n.initializer;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(cvaCall, "buttonVariants = cva(...) not found in button.tsx").toBeDefined();
    const [base, config] = cvaCall!.arguments;
    const baseText = stringsUnder(base).join(" ");
    expect(baseText.split(/\s+/), "the Button base lost rounded-full").toContain("rounded-full");
    expect(nonPillRadii(baseText), "the Button base carries a non-pill radius").toEqual([]);
    // Variant strings are built from constants (ELEV_FILLED, GREEN_CTA_HOVER), so read those too.
    const consts = constInitializers(sf);
    const configTexts = config ? stringsUnder(config) : [];
    for (const id of ["ELEV_FILLED", "GREEN_CTA_HOVER", "SHIMMER"]) {
      const init = consts.get(id);
      if (init) configTexts.push(...stringsUnder(init));
    }
    expect(configTexts.length).toBeGreaterThan(5);
    expect(configTexts.flatMap(nonPillRadii), "a Button variant or size restates a radius").toEqual([]);
  });

  it("no <Button> sets a non-pill radius in its className", () => {
    let buttons = 0;
    const hits: Hit[] = [];
    for (const f of SOURCES.filter((x) => x.endsWith(".tsx"))) {
      const r = buttonRadiusHits(f, read(f));
      buttons += r.buttons;
      hits.push(...r.hits);
    }
    // Inventory floor: the scan really reached the app's buttons (measured 2026-10-29: 621).
    expect(buttons).toBeGreaterThan(600);
    expect(hits.map((h) => `${h.where}  ${h.tokens.join(" ")}`), "these <Button>s are not pills — drop the radius, the base is rounded-full").toEqual([]);
  });

  it("no glossy primary (btn-grad-primary) carries a non-pill radius", () => {
    let primaries = 0;
    const hits: Hit[] = [];
    for (const f of SOURCES) {
      const r = primaryRadiusHits(f, read(f));
      primaries += r.primaries;
      hits.push(...r.hits);
    }
    expect(primaries).toBeGreaterThan(20);
    expect(hits.map((h) => `${h.where}  ${h.tokens.join(" ")}`), "these primary CTAs are not pills — use rounded-full").toEqual([]);
  });

  it("the scanners catch what they claim to (fixtures)", () => {
    expect(nonPillRadii("w-full rounded-ds-md sm:rounded-2xl rounded rounded-full md:rounded-full")).toEqual(["rounded-ds-md", "sm:rounded-2xl", "rounded"]);
    const src = `
      const CLS = "h-10 rounded-ds-sm";
      export const A = () => (<>
        <Button
          // a comment with a > and rounded-ds-md in it is not a class
          className={cn("w-full rounded-ds-md", x)} />
        <Button className={CLS}>x</Button>
        <Button className="rounded-full">ok</Button>
        <button className="btn-grad-primary rounded-ds-md">raw</button>
      </>);`;
    const b = buttonRadiusHits("f.tsx", src);
    expect(b.buttons).toBe(3);
    expect(b.hits.map((h) => h.tokens)).toEqual([["rounded-ds-md"], ["rounded-ds-sm"]]);
    expect(primaryRadiusHits("f.tsx", src).hits.map((h) => h.tokens)).toEqual([["rounded-ds-md"]]);
  });
});
