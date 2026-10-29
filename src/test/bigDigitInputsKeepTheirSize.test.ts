/**
 * A big-digit field keeps its size on a phone (Declutter deep audit #43, 2026-10-28, shot a3-10-sell-s3-390 in
 * ~/.lh-shots/declutter-audit3-1028): on Sell step 3 the price digits drew at 16px beside a 40px "$".
 *
 * Why: index.css stops iOS zooming into a field by flooring every input on a touch screen at
 * `font-size: max(16px, 1em)` with a selector (four :not()s) that outweighs any text-size utility. So an input's
 * own `text-ds-40` loses there, and `1em` is the PARENT's size. A field meant to be big therefore states its size
 * on the element that holds it as well.
 *
 * Inventory from source: every `<input>` in a .tsx under src/ whose own className sets a text-ds size above 16
 * without a breakpoint prefix (a phone sees it). Its nearest enclosing JSX element must set a text-ds size at least
 * as big.
 *
 * @mutate src/components/declutter/SellFormParts.tsx | <div className="flex min-w-0 items-baseline justify-center text-ds-40 text-[hsl(var(--burnt-sienna))]"> | <div className="flex min-w-0 items-baseline justify-center text-[hsl(var(--burnt-sienna))]">
 * @mutate src/components/quotes/QuotePriceStepper.tsx | <span className="inline-flex items-baseline text-ds-40 text-[hsl(var(--burnt-sienna))]"> | <span className="inline-flex items-baseline text-[hsl(var(--burnt-sienna))]">
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

/** The phone-visible text-ds size a className sets (no sm:/md:/lg:/xl: prefix), or null. */
function phoneSize(cls: string): number | null {
  const m = cls.match(/(?:^|[\s"'`])text-ds-(\d+)\b/);
  return m ? Number(m[1]) : null;
}

/** Each JSX tag, braces counted, in order: [name, whole tag]. Fragments are "". */
function tags(src: string): { name: string; tag: string; closing: boolean; selfClosing: boolean }[] {
  const out: { name: string; tag: string; closing: boolean; selfClosing: boolean }[] = [];
  const re = /<(\/?)([A-Za-z][\w.]*)?(?=[\s>/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // A TypeScript generic (`useState<number>`, `Array<string>`) follows a name with no space: not a tag.
    if (/[\w)\]]/.test(src[m.index - 1] ?? "")) continue;
    let depth = 0;
    let i = m.index + 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(m.index, i + 1);
    out.push({ name: m[2] ?? "", tag, closing: m[1] === "/", selfClosing: /\/>$/.test(tag) });
    re.lastIndex = i + 1;
  }
  return out;
}

function shrunkInputs(src: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  for (const t of tags(blankComments(src))) {
    if (t.closing) {
      stack.pop();
      continue;
    }
    if (t.name === "input") {
      const own = phoneSize(t.tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)?.slice(1).find(Boolean) ?? "");
      if (own !== null && own > 16) {
        const parent = stack[stack.length - 1] ?? "";
        const held = phoneSize(parent.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)?.slice(1).find(Boolean) ?? "");
        if (held === null || held < own) out.push(`${t.tag.replace(/\s+/g, " ").slice(0, 90)} (parent ${held ?? "none"})`);
      }
    }
    if (!t.selfClosing) stack.push(t.tag);
  }
  return out;
}

describe("a big-digit field keeps its size on a phone (deep audit #43)", () => {
  it("index.css still floors touch-screen inputs at max(16px, 1em), the reason for this rule", () => {
    expect(readFileSync(join(ROOT, "src/index.css"), "utf8")).toMatch(/@media \(pointer: coarse\)[\s\S]{0,1200}font-size: max\(16px, 1em\)/);
  });

  it("catches the original Sell price field", () => {
    const before = `<div className="flex text-[hsl(var(--burnt-sienna))]">\n<span className="text-ds-40" aria-hidden>$</span>\n<input id="sell-price" className="max-w-[7ch] text-ds-40 font-bold" />\n</div>`;
    expect(shrunkInputs(before)).toHaveLength(1);
    expect(shrunkInputs(before.replace('className="flex text-', 'className="flex text-ds-40 text-'))).toEqual([]);
    expect(shrunkInputs(`<div>\n<input className="w-full text-ds-15 lg:text-ds-17" />\n</div>`)).toEqual([]);
  });

  it("every big-digit input in src/ is held by an element of at least its size", () => {
    const files = walkSource([join(ROOT, "src")]).filter((f) => f.endsWith(".tsx") && !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(300);
    let big = 0;
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/<input\b/.test(src) || !/text-ds-(?:1[7-9]|[2-9]\d)/.test(src)) continue;
      if (/<input\b(?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?text-ds-(?:1[7-9]|[2-9]\d)/s.test(src)) big++;
      hits.push(...shrunkInputs(src).map((h) => `${f.slice(ROOT.length + 1)}: ${h}`));
    }
    expect(big, "files with a big-digit input (Sell price, quote price)").toBeGreaterThanOrEqual(2);
    expect(hits, "put the input's text-ds size on its wrapper too").toEqual([]);
  });
});
