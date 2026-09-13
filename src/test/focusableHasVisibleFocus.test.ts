/**
 * Anything that removes the browser's focus outline must draw one of its own
 * (owner, 2026-09-12: "prevent, don't chase").
 *
 * The date-of-birth wheel (DateWheelPicker) made each column a
 * `tabIndex={0}` listbox with `focus-visible:outline-none` and nothing in its
 * place, so a keyboard user tabbing into the picker saw no change at all —
 * three focus stops, all invisible. Found by the keyboard sweep of Signup.
 *
 * Rule: a JSX tag whose className strips the outline (`outline-none`,
 * `focus:outline-none`, `focus-visible:outline-none`) must, in the SAME tag,
 * paint a replacement — a ring, a focus border/background/shadow/underline,
 * an `outline-<colour>` — unless it is a programmatic focus target
 * (`tabIndex={-1}`, or a Radix `*Content` dialog panel, including the
 * `asChild` element it renders as: headings/dialogs focused on screen change)
 * or carries `glass-field`, whose `:focus-visible` outline lives in index.css.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STRIPS_OUTLINE = /(?:^|[\s"'`:])(?:focus(?:-visible|-within)?:)?outline-none\b/;
const PAINTS_FOCUS =
  /\bring-(?:\d|\[)|focus(?:-visible|-within)?:(?:border|bg|shadow|underline|text|ring)-|focus(?:-visible)?:outline-(?!none\b)|data-\[state=open\]:/;

/** shadcn stock; the palette is the focus context. Countdown list — never add. */
const LEGACY = new Set(["src/components/ui/command.tsx"]);

export function offenders(file: string, src: string): string[] {
  const out: string[] = [];
  let prev = "";
  for (const m of src.matchAll(/<[A-Za-z][\w.]*\b(?:[^<>]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*?>/gs)) {
    const tag = m[0];
    // `<X.Content asChild>` hands its focus-target role to the very next tag.
    const renderedAsContent = /^<[\w.]*Content\b/.test(prev) && /\basChild\b/.test(prev);
    prev = tag;
    if (!STRIPS_OUTLINE.test(tag)) continue;
    if (/tabIndex=\{-1\}/.test(tag)) continue;
    if (/^<[\w.]*Content\b/.test(tag) || renderedAsContent) continue;
    if (/\bglass-field\b/.test(tag)) continue;
    if (PAINTS_FOCUS.test(tag)) continue;
    out.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  return out;
}

describe("a focusable that hides the outline paints its own focus", () => {
  it("catches the original DateWheelPicker column", () => {
    const before = `<div role="listbox" tabIndex={0} className={cn("relative h-[200px] overflow-y-auto", "focus-visible:outline-none", className)} />`;
    expect(offenders("x.tsx", before)).toHaveLength(1);
    const after = `<div role="listbox" tabIndex={0} className={cn("relative h-[200px]", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--olivewood))]", className)} />`;
    expect(offenders("x.tsx", after)).toEqual([]);
    expect(offenders("x.tsx", `<h1 tabIndex={-1} className="sr-only focus:outline-none">t</h1>`)).toEqual([]);
    expect(offenders("x.tsx", `<input className="glass-field focus:outline-none" />`)).toEqual([]);
  });

  it("glass-field really does paint its own focus-visible outline", () => {
    expect(readFileSync("src/index.css", "utf8")).toMatch(/\.glass-field:focus-visible\s*\{[^}]*outline-color/);
  });

  it("no outline-stripping tag without a focus paint anywhere in src/", () => {
    const hits: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n) && !LEGACY.has(p)) hits.push(...offenders(p, readFileSync(p, "utf8")));
      }
    })("src");
    expect(hits, "add focus-visible:ring-2 (or a focus border/bg) beside outline-none").toEqual([]);
  });

  it("the legacy list only shrinks", () => {
    for (const p of LEGACY) expect(offenders(p, readFileSync(p, "utf8")).length, `${p} is clean — remove it from LEGACY`).toBeGreaterThan(0);
  });
});

/**
 * Second shape of the same defect: the focus paint is declared and then
 * DEFEATED. Tailwind's `ring-*` is a box-shadow, so a tag that also sets an
 * inline `style={{ boxShadow }}` never shows its ring — the inline style wins.
 * PhotoUpload's "+" chip got `focus-within:ring-2` in dbed7befd and the ring
 * never appeared over its parchment shadow (found on prod, 2026-09-12); the
 * selected AtAGlance cell had the same shape. Likewise an inline `outline*`
 * beside a `focus*:outline-*` class. Use the OTHER property for focus.
 */
export function defeatedFocusPaint(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<[A-Za-z][\w.]*\b(?:[^<>]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*?>/gs)) {
    const tag = m[0];
    if (/focus(?:-visible|-within)?:ring-/.test(tag) && /\bboxShadow\s*:/.test(tag)) out.push(`${file}: ring vs inline boxShadow: ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
    if (/focus(?:-visible|-within)?:outline\b/.test(tag) && /\boutline(?:Style|Width|Color|Offset)?\s*:/.test(tag)) out.push(`${file}: outline vs inline outline: ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
  }
  return out;
}

describe("a declared focus paint is not defeated by an inline style", () => {
  it("catches the original PhotoUpload chip", () => {
    const before = `<label className="w-20 h-20 focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.45)]" style={{ background: "x", boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.65)" }}>`;
    expect(defeatedFocusPaint("x.tsx", before)).toHaveLength(1);
    const after = `<label className="w-20 h-20 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[hsl(var(--bark)/0.45)]" style={{ background: "x", boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.65)" }}>`;
    expect(defeatedFocusPaint("x.tsx", after)).toEqual([]);
    // the conditional-style shape from AtAGlanceCard
    expect(defeatedFocusPaint("x.tsx", `<button className={cn("focus-visible:ring-2", sel && "x")} style={sel ? { boxShadow: "0 1px 2px" } : { background: "y" }}>`)).toHaveLength(1);
    expect(defeatedFocusPaint("x.tsx", `<button className="focus-visible:outline focus-visible:outline-2" style={{ outlineColor: "red" }}>`)).toHaveLength(1);
  });

  it("no ring-plus-inline-boxShadow (or outline-plus-inline-outline) tag anywhere in src/", () => {
    const hits: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) hits.push(...defeatedFocusPaint(p, readFileSync(p, "utf8")));
      }
    })("src");
    expect(hits, "the inline style wins; paint focus with the other property (outline for a shadowed surface)").toEqual([]);
  });
});
