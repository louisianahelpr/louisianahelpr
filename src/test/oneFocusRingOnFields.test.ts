/**
 * ONE focus ring on a typing field (Declutter deep audit #46, 2026-10-28,
 * shots 07, 25 and 30 in ~/.lh-shots/declutter-deep-audit-1028): the Browse
 * search, the offer field and the counter-offer field each showed two rings.
 *
 * Two shapes, one cause: src/index.css's unlayered `:focus-visible` outline
 * (2px, offset 2px) comes after `@tailwind utilities`, so
 *   1. on a bordered field it drew a second ring 2px outside the border
 *      (border, gap, outline: the offer and counter fields), and
 *   2. it beat a bare `outline-none` (same specificity, later in the file), so
 *      a field inside a pill that rings itself on focus-within also drew a
 *      square box around the text (the Browse search row).
 * Fix: index.css lays the outline OVER a typing field's border (offset -1px),
 * and an input that hides the outline says so for `:focus-visible` too.
 *
 * @mutate src/index.css | textarea, select):focus-visible {\n  outline-offset: -1px; | textarea, select):focus-visible {\n  outline-offset: 2px;
 * @mutate src/components/sections/SectionSearchRow.tsx | outline-none focus-visible:outline-none placeholder | outline-none placeholder
 * @mutate src/components/sections/SectionSearchRow.tsx | bg-card focus-within:outline focus-within:outline-2 | bg-card focus-within:ring-2
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const CSS = join(ROOT, "src/index.css");

/**
 * Inputs whose bare `outline-none` still loses to the global outline. Countdown list: never add.
 * HeroSection: `.landing-search input:focus-visible { outline: none }` in index.css removes it.
 * ConversationList: the Messages search; its pill has no focus ring of its own yet, so the
 * outline is its only focus mark (not part of #46).
 */
// @two-way src/test/oneFocusRingOnFields.test.ts:the legacy list only shrinks
const LEGACY = new Set(["src/components/landing/HeroSection.tsx", "src/components/messages/ConversationList.tsx"]);

const NOT_TYPING = /\btype=["'](?:checkbox|radio|range|file|color|button|submit|reset|hidden)["']/;

/** `<input>` tags with a bare `outline-none` and no `focus-visible:outline-none`. */
function bareOutlineNoneInputs(src: string): string[] {
  const out: string[] = [];
  for (const m of blankComments(src).matchAll(/<input\b(?:[^<>{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*?>/gs)) {
    const tag = m[0];
    if (NOT_TYPING.test(tag)) continue;
    if (!/(?:^|[\s"'`])outline-none\b/.test(tag)) continue;
    if (/focus-visible:!?outline-none\b/.test(tag)) continue;
    out.push(tag.replace(/\s+/g, " ").slice(0, 120));
  }
  return out;
}

describe("a typing field shows one focus ring (deep audit #46)", () => {
  it("index.css lays the outline over a typing field's border, after the global rule", () => {
    const css = blankCssComments(readFileSync(CSS, "utf8"));
    const utilities = css.indexOf("@tailwind utilities;");
    const global = css.search(/\n:focus-visible\s*\{/);
    const rule = css.match(/\n:is\(input:not\(([^)]*)\), textarea, select\):focus-visible\s*\{([^}]*)\}/);
    expect(utilities).toBeGreaterThan(0);
    expect(global).toBeGreaterThan(utilities);
    expect(rule, "the typing-field :focus-visible rule").not.toBeNull();
    expect(css.indexOf(rule![0])).toBeGreaterThan(global);
    for (const t of ["checkbox", "radio", "range", "file"]) expect(rule![1]).toContain(`[type="${t}"]`);
    const offset = rule![2].match(/outline-offset:\s*(-?\d+(?:\.\d+)?)px/);
    expect(offset, "outline-offset in px").not.toBeNull();
    expect(Number(offset![1])).toBeLessThanOrEqual(0);
  });

  it("the Browse search pill rings itself with an outline (a ring-* box-shadow loses to the .bg-card !important shadow)", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/sections/SectionSearchRow.tsx"), "utf8"));
    const form = src.match(/data-section-search=""[\s\S]*?className="([^"]+)"/);
    expect(form, "the search row form's className").not.toBeNull();
    const cls = form![1].split(/\s+/);
    expect(cls).toContain("bg-card");
    expect(cls).toEqual(expect.arrayContaining(["focus-within:outline", "focus-within:outline-2"]));
    expect(cls.some((c) => c.startsWith("focus-within:outline-[") || c === "focus-within:outline-ring")).toBe(true);
    expect(readFileSync(CSS, "utf8")).toMatch(/:where\(\.bg-card\)[\s\S]{0,200}box-shadow:[^;]*!important/);
  });

  it("catches the original Browse search row input", () => {
    const before = `<input type="search" className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />`;
    expect(bareOutlineNoneInputs(before)).toHaveLength(1);
    expect(bareOutlineNoneInputs(before.replace("outline-none", "outline-none focus-visible:outline-none"))).toEqual([]);
    expect(bareOutlineNoneInputs(`<input type="radio" className="outline-none" />`)).toEqual([]);
  });

  it("no input in src/ hides the outline with a bare outline-none", () => {
    const files = walkSource([join(ROOT, "src")]).filter((f) => f.endsWith(".tsx") && !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(300);
    const withInputs = files.filter((f) => /<input\b/.test(readFileSync(f, "utf8")));
    expect(withInputs.length).toBeGreaterThan(50);
    const hits = withInputs
      .map((f) => f.slice(ROOT.length + 1))
      .filter((rel) => !LEGACY.has(rel))
      .flatMap((rel) => bareOutlineNoneInputs(readFileSync(join(ROOT, rel), "utf8")).map((t) => `${rel}: ${t}`));
    expect(hits, "add focus-visible:outline-none (and ring the field's wrapper on focus-within)").toEqual([]);
  });

  it("the legacy list only shrinks", () => {
    for (const rel of LEGACY) expect(bareOutlineNoneInputs(readFileSync(join(ROOT, rel), "utf8")).length, `${rel} is clean: remove it from LEGACY`).toBeGreaterThan(0);
  });
});
