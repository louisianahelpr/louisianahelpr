/*
 * GUARD (docs/OPEN.md Q237): a floating panel never lets the page show through.
 *
 * The composer's "+" panel (AttachSourceSheet) painted itself with
 * `style={{ background: "var(--surface-premium)" }}`. That token is a gradient
 * that fades to 74% alpha, and the `background` shorthand also resets the
 * colour underneath to transparent, so the primitive's opaque `bg-popover`
 * class was overridden and the open thread read straight through the Camera /
 * Photo Library / Files rows (screenshot at 375, 2026-10-17).
 *
 * The class: every Radix floating-content element (popover, dropdown, select,
 * hover card, context menu, menubar, tooltip) sits over arbitrary page content,
 * so its fill must be opaque. Its inline style may not paint a translucent
 * `background` shorthand or `backgroundColor`, and a translucent
 * `backgroundImage` needs an opaque `backgroundColor` under it. The primitives
 * themselves must keep their opaque `bg-popover` default.
 */
// @mutate src/components/richMessageInput/AttachSourceSheet.tsx | style={{ backgroundColor: "hsl(var(--popover))", backgroundImage: "var(--surface-premium)" }} | style={{ background: "var(--surface-premium)" }}
// @mutate src/components/richMessageInput/AttachSourceSheet.tsx | style={{ backgroundColor: "hsl(var(--popover))", backgroundImage: "var(--surface-premium)" }} | style={{ backgroundImage: "var(--surface-premium)" }}
// @mutate src/components/ui/popover.tsx | rounded-md border bg-popover p-4 | rounded-md border p-4
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const CONTENT_TAGS = ["PopoverContent", "DropdownMenuContent", "DropdownMenuSubContent", "SelectContent", "HoverCardContent", "ContextMenuContent", "ContextMenuSubContent", "MenubarContent", "TooltipContent"];
const TAG_RE = new RegExp(`<(${CONTENT_TAGS.join("|")})\\b`, "g");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/** The JSX opening tag starting at `at` (up to its closing `>`), braces and strings respected. */
function openingTag(src: string, at: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

/** Translucent: the premium gradient token, an alpha channel, or transparent. */
const translucent = (v: string) => /--surface-premium|\/\s*0?\.\d|hsla|rgba|transparent/.test(v);

/** `prop: <value>` pairs inside the tag's `style={{ … }}`. */
function styleValue(tag: string, prop: string): string | null {
  const style = /style=\{\{([\s\S]*?)\}\}/.exec(tag)?.[1];
  if (!style) return null;
  const m = new RegExp(`(?:^|[\\s,{])${prop}\\s*:\\s*((?:"[^"]*"|'[^']*'|\`[^\`]*\`|[^,}])+)`).exec(style);
  return m ? m[1].trim() : null;
}

function floatingPanelFillProblems(tag: string): string[] {
  const problems: string[] = [];
  const shorthand = styleValue(tag, "background");
  const color = styleValue(tag, "backgroundColor");
  const image = styleValue(tag, "backgroundImage");
  if (shorthand && translucent(shorthand)) problems.push(`background: ${shorthand} (the shorthand also clears the opaque colour)`);
  if (color && translucent(color)) problems.push(`backgroundColor: ${color}`);
  if (image && translucent(image) && !(color && !translucent(color))) problems.push(`backgroundImage: ${image} with no opaque backgroundColor under it`);
  return problems;
}

describe("floating panels are opaque (Q237)", () => {
  const files = walk(SRC);
  const tags: { file: string; tag: string }[] = [];
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(TAG_RE)) tags.push({ file: relative(ROOT, f), tag: openingTag(src, m.index ?? 0) });
  }

  it("finds the floating panels it is checking", () => {
    expect(tags.length).toBeGreaterThan(30);
  });

  it("no floating panel paints a translucent fill over the page", () => {
    const bad = tags.flatMap(({ file, tag }) => floatingPanelFillProblems(tag).map((p) => `${file}: ${p}`));
    expect(bad).toEqual([]);
  });

  it("the shared primitives keep their opaque bg-popover default", () => {
    for (const f of ["popover", "dropdown-menu", "select", "hover-card", "context-menu", "menubar", "tooltip"]) {
      const path = join(SRC, "components", "ui", `${f}.tsx`);
      let src: string;
      try { src = blankComments(readFileSync(path, "utf8")); } catch { continue; }
      const contents = [...src.matchAll(/<\w+Primitive\.(?:Sub)?Content\b/g)].map((m) => openingTag(src, m.index ?? 0));
      for (const c of contents) {
        expect(/bg-popover|bg-primary|bg-card/.test(c), `${f}.tsx: a Content element lost its opaque fill class`).toBe(true);
      }
    }
  });

  it("the rule itself tells a translucent fill from an opaque one", () => {
    expect(floatingPanelFillProblems(`<PopoverContent style={{ background: "var(--surface-premium)" }}>`)).toHaveLength(1);
    expect(floatingPanelFillProblems(`<PopoverContent style={{ backgroundImage: "var(--surface-premium)" }}>`)).toHaveLength(1);
    expect(floatingPanelFillProblems(`<PopoverContent style={{ backgroundColor: "hsl(var(--popover))", backgroundImage: "var(--surface-premium)" }}>`)).toEqual([]);
    expect(floatingPanelFillProblems(`<PopoverContent style={{ background: "hsl(var(--card))" }}>`)).toEqual([]);
  });
});
