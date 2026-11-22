/**
 * Deep audit 11-22 #9 (Medium): on a phone the Post a job price step drew "$80" as a 28px "$" beside 16px digits.
 *
 * The anti-zoom rule in src/index.css (`@media (pointer: coarse)`) sets every text input to `max(16px, 1em)` with a
 * selector that outranks any size utility, and `1em` is the PARENT's font size. So an input that asks for more than
 * 16px (text-ds-40 = 28px) shows at 16px on every touch device, the app included, unless an ancestor carries the same
 * size (QuotePriceStepper already did, deep audit #43) or the input opts out with `data-zoom-guard-off`.
 *
 * CLASS CHECK (TypeScript AST, every non-test .tsx under src/): each JSX `input` / `Input` / `textarea` / `Textarea`
 * whose className sets a text size above 16px must have, in the same file, a JSX ancestor whose className sets a size
 * at least as big, or carry `data-zoom-guard-off`. Sizes resolve through tailwind.config.ts's fontSize map.
 *
 * @mutate src/components/ui/currency-input.tsx | rounded-ds-md px-2 text-ds-40 focus-within:ring-2 | rounded-ds-md px-2 focus-within:ring-2
 * @mutate src/components/quotes/QuotePriceStepper.tsx | <span className="inline-flex items-baseline text-ds-40 text-[hsl(var(--burnt-sienna))]"> | <span className="inline-flex items-baseline text-[hsl(var(--burnt-sienna))]">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** tailwind.config.ts fontSize: token -> px. */
function fontSizes(): Map<string, number> {
  const cfg = read("tailwind.config.ts");
  const block = cfg.slice(cfg.indexOf("fontSize: {"), cfg.indexOf("},\n      spacing"));
  const map = new Map<string, number>();
  for (const m of block.matchAll(/"?([\w-]+)"?:\s*\["(\d+)px"/g)) map.set(m[1], Number(m[2]));
  return map;
}
const SIZES = fontSizes();

/** The biggest unprefixed `text-<size>` in a className expression's string parts (variants like sm: ignored). */
function sizeOf(attr: ts.JsxAttribute | undefined): number | null {
  if (!attr?.initializer) return null;
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) parts.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(attr.initializer);
  let best: number | null = null;
  for (const tok of parts.join(" ").split(/\s+/)) {
    const m = tok.match(/^text-([\w-]+)$/);
    const px = m ? SIZES.get(m[1]) : undefined;
    if (px !== undefined) best = Math.max(best ?? 0, px);
  }
  return best;
}

function attrsOf(el: ts.JsxOpeningLikeElement) {
  const find = (name: string) => el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
  return { className: find("className"), optOut: find("data-zoom-guard-off") };
}

const INPUT_TAGS = new Set(["input", "Input", "textarea", "Textarea"]);

function offenders(rel: string, text = read(rel)): string[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && INPUT_TAGS.has(n.tagName.getText())) {
      const { className, optOut } = attrsOf(n);
      const own = sizeOf(className);
      if (own !== null && own > 16 && !optOut) {
        let carried = false;
        for (let p: ts.Node | undefined = (ts.isJsxSelfClosingElement(n) ? n : n.parent).parent; p; p = p.parent) {
          if (ts.isJsxElement(p)) {
            const s = sizeOf(attrsOf(p.openingElement).className);
            if (s !== null) { carried = s >= own; break; }
          }
        }
        if (!carried) out.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} (${own}px)`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));

describe("big inputs keep their size on phones (deep audit 11-22 #9)", () => {
  it("reads the real tree and the real size scale (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(SIZES.get("ds-40")).toBeGreaterThan(16);
    expect(SIZES.get("ds-15")).toBe(16);
    // The rule this guards against is still there, and still measured against the parent (1em).
    expect(read("src/index.css")).toContain("font-size: max(16px, 1em);");
  });

  it("the checker catches the 11-22 shape: a 28px input inside a box with no size", () => {
    const bad = `export const X = () => (<div className="flex"><span className="text-ds-40">$</span><Input className="text-ds-40 font-bold" /></div>);`;
    expect(offenders("fixture.tsx", bad)).toHaveLength(1);
    const ok = `export const X = () => (<div className="flex text-ds-40"><Input className="text-ds-40" /></div>);`;
    expect(offenders("fixture.tsx", ok)).toHaveLength(0);
  });

  it("no input asks for more than 16px without an ancestor carrying it (or an opt-out)", () => {
    const bad = files.flatMap((f) => offenders(f));
    expect(bad).toEqual([]);
  });

  it("the Post a job price field is one of the inputs this covers", () => {
    const sf = read("src/components/ui/currency-input.tsx");
    expect(sf).toMatch(/className="h-auto min-h-\[56px\][^"]*\btext-ds-40\b/);
    expect(sf).toMatch(/rounded-ds-md px-2 text-ds-40 focus-within:ring-2/);
  });
});
