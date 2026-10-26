/**
 * THE JOB SHEET'S CORNER ICONS ARE ONE CONTROL (owner 2026-10-25, Browse -> tap a job: "the 4 icons at top do
 * different stuff on hover"). Measured at 1440 on 25fc6a8ef9 (Playwright hover, computed style): Share, Save and
 * Report were a 6px square with NO hover wash, an ink that never changed (an inline colour beat
 * `hover:text-foreground`) and a glyph that hopped 2px or tilted 12deg; the close X was a 9999px disc that washed
 * olivewood/0.08, darkened its ink and held still. After: all four measure 44x44, 9999px, olivewood/0.08,
 * rgb(46,47,34), glyph transform none.
 *
 * THE CLASS: every icon button in DialogContent's corner slot is drawn from the ONE look, CHROME_ICON_LOOK
 * (src/components/ui/chromeIcon.ts): IconActionButton and ShareJobButton wear it in their `bare` form, the X spells
 * the same tokens (scripts/back-control-inventory.mjs reads exit shapes from a literal class list), nothing overrides
 * its wash or ink, every corner icon is the same size, and no corner glyph moves on hover.
 *
 * @mutate src/components/dashboard/IconActionButton.tsx | ? `${CHROME_ICON_LOOK} ${compact ? "h-8 w-8" : "h-11 w-11"} shrink-0` | ? `group rounded-md ${compact ? "h-8 w-8" : "h-11 w-11"} shrink-0 btn-press hover:bg-transparent`
 * @mutate src/components/jobs/ShareJobButton.tsx | ? `${CHROME_ICON_LOOK} ${compact ? "h-8 w-8" : "h-11 w-11"} shrink-0` | ? `${CHROME_ICON_LOOK} ${compact ? "h-8 w-8" : "h-11 w-11"} shrink-0 hover:bg-transparent`
 * @mutate src/components/dashboard/IconActionButton.tsx | ...(pressed ? { color: pressedColor } : {}), | color: pressed ? pressedColor : "hsl(var(--muted-foreground))",
 * @mutate src/components/dashboard/JobDetailDialog.tsx | <Flag className="w-4 h-4" /> | <Flag className="w-4 h-4 group-hover:-rotate-12" />
 * @mutate src/components/jobs/ShareJobButton.tsx | <Share2 className={bare ? "w-4 h-4" : | <Share2 className={bare ? "w-4 h-4 group-hover:-translate-y-0.5" :
 * @mutate src/components/ui/chromeIcon.ts | ctl-exit btn-press ctl-tint | btn-press ctl-tint
 * @mutate src/components/dashboard/JobDetailDialog.tsx |       <IconActionButton\n        ariaLabel="Report this job" |       <IconActionButton compact\n        ariaLabel="Report this job"
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { CHROME_ICON_LOOK } from "@/components/ui/chromeIcon";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));
const LOOK = CHROME_ICON_LOOK.split(/\s+/);
/** Classes that would override the look's wash, ink or shape, or move the target. */
const OVERRIDE = /^(?:hover:|active:)?(?:bg-transparent|rounded(?:-[\w[\]]+)?)$|^hover:(?:bg-|scale-|translate-|-translate-|rotate-|-rotate-)/;
/** A glyph that moves when its button is hovered. */
const GLYPH_MOTION = /(?:group-)?hover:-?(?:translate-[xy]-|rotate-|scale-)/;

/** The `bare` branch of a `bare ? A : B` className ternary. */
function bareBranch(src: string): string {
  const m = /className=\{\s*(?:cn\(\s*)?bare\s*\?\s*(`[^`]*`|"[^"]*")/.exec(src);
  expect(m, "the bare className branch").not.toBeNull();
  return m![1];
}

/** A JSX opening tag from `<` to its closing `>`, skipping `>` inside `{...}` (arrow functions) and strings. */
function openingTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

/** The JSX of JobDetailDialog's corner slot (`const cornerActions = ... );`). */
function cornerSlot(): string {
  const src = read("components/dashboard/JobDetailDialog.tsx");
  const at = src.indexOf("const cornerActions =");
  expect(at).toBeGreaterThan(-1);
  const end = src.indexOf("\n  );", at);
  expect(end).toBeGreaterThan(at);
  return src.slice(at, end);
}

describe("the job sheet's corner icons share one hover, focus and press look", () => {
  it("the look is the X's: the exit disc, the neutral wash, muted -> foreground ink, the one press, the focus ring", () => {
    expect(LOOK.length).toBeGreaterThan(8);
    for (const t of ["ctl-exit", "ctl-tint", "btn-press", "text-muted-foreground", "hover:text-foreground", "focus-visible:ring-2"]) expect(LOOK).toContain(t);
    expect(LOOK.filter((c) => OVERRIDE.test(c))).toEqual([]);
  });

  it("every icon button in the corner slot is a bare IconActionButton / ShareJobButton, one size (no compact)", () => {
    const slot = cornerSlot();
    const tags = [...slot.matchAll(/<(\w*Button|button)\b/g)].map((m) => [m[1], openingTag(slot, m.index!)] as const);
    expect(tags.length, "corner slot icon buttons").toBeGreaterThan(2);
    for (const [name, attrs] of tags) {
      expect(["IconActionButton", "ShareJobButton"], `${name} in the corner slot`).toContain(name);
      expect(attrs, `${name} is bare`).toMatch(/\bbare\b/);
      expect(attrs, `${name} is the 44px size, like the X`).not.toMatch(/\bcompact\b/);
    }
    // No glyph in the slot moves on hover (the old Bookmark hop and Flag tilt).
    expect(slot.match(GLYPH_MOTION) ?? []).toEqual([]);
  });

  for (const file of ["components/dashboard/IconActionButton.tsx", "components/jobs/ShareJobButton.tsx"]) {
    it(`${file}: the bare form wears CHROME_ICON_LOOK and nothing that overrides it`, () => {
      const src = read(file);
      expect(src).toMatch(/import \{ CHROME_ICON_LOOK \} from "@\/components\/ui\/chromeIcon";/);
      const branch = bareBranch(src);
      expect(branch).toContain("${CHROME_ICON_LOOK}");
      const extra = branch.replace(/\$\{[^}]*\}/g, " ").replace(/[`"]/g, "").split(/\s+/).filter(Boolean);
      expect(extra.filter((c) => OVERRIDE.test(c)), branch).toEqual([]);
      // The bare inline style sets no resting ink: an inline colour beats `hover:text-foreground`.
      const style = /style=\{\s*bare\s*\?\s*\(?\{([\s\S]*?)\}\s*(?:as CSSProperties\))?\s*:/.exec(src) ?? /const style = bare\s*\?\s*\(\{([\s\S]*?)\}\s*as CSSProperties\)/.exec(src);
      expect(style, "the bare inline style").not.toBeNull();
      expect(style![1]).not.toMatch(/^\s*color:/m);
    });
  }

  it("ShareJobButton's bare glyph holds still on hover", () => {
    const src = read("components/jobs/ShareJobButton.tsx");
    const m = /<Share2 className=\{bare \? "([^"]*)"/.exec(src);
    expect(m, "the bare Share glyph").not.toBeNull();
    expect(m![1]).not.toMatch(GLYPH_MOTION);
  });

  it("DialogContent's X spells every token of the same look (it stays a literal for the back-control inventory)", () => {
    const dialog = read("components/ui/dialog.tsx");
    const at = dialog.indexOf("<DialogPrimitive.Close");
    expect(at).toBeGreaterThan(-1);
    const cls = /className=\{`([^`]*)`\}/.exec(dialog.slice(at))?.[1] ?? "";
    const tokens = cls.replace(/\$\{[^}]*\}/g, " ").split(/\s+/).filter(Boolean);
    expect(tokens.length).toBeGreaterThan(8);
    expect(LOOK.filter((t) => !tokens.includes(t)), "look tokens the X is missing").toEqual([]);
    expect(tokens.filter((c) => OVERRIDE.test(c))).toEqual([]);
  });
});
