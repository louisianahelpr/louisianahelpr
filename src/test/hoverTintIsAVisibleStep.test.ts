/**
 * A HOVER THAT DOES NOT MOVE THE SURFACE IS NOT FEEDBACK.
 *
 * ─── THE MEASUREMENT ───────────────────────────────────────────────────────
 *
 * The popup footer's dismiss (`POPUP_SECONDARY_CLS`, src/components/ui/
 * popupFooter.ts) rests on `bg-[hsl(var(--olivewood)/0.06)]` and carries
 * `.ctl-tint`, whose hover is `hsl(var(--olivewood) / 0.08)`. Measured in
 * headless Chromium against the BUILT stylesheet (`dist/assets/*.css`, never
 * the dev server — the minifier collapses declarations):
 *
 *     rest   rgba(46, 47, 34, 0.06)   over a rgb(240, 242, 244) page
 *     hover  rgba(46, 47, 34, 0.08)
 *
 * Composited, that is rgb(228,230,232) → rgb(225,227,229): a FOUR-UNIT step
 * in each channel. The direction is right and the magnitude does nothing.
 *
 * ─── WHY IT HAPPENS, WHICH IS THE ACTUAL RULE ──────────────────────────────
 *
 * `.ctl-tint` is an 8-point wash, and 8 points is a real step FROM ZERO — a
 * ghost button, an icon button, a nav row all rest on nothing, so they move
 * the full 8. A control that already RESTS on a tint of the same token does
 * not: it moves by the DIFFERENCE, and 8 − 6 = 2. The one interaction
 * treatment says "the surface darkens one step"; a step is measured from where
 * the surface actually is, not from transparent.
 *
 * ─── THE FIX IS ONE CSS RULE, AND IT IS NOT THIS LANE'S FILE ───────────────
 *
 * `src/index.css` belongs to another lane today, so the offender below is
 * LEDGERED, not silently tolerated, and the rule to land is written out here
 * so it can be routed verbatim rather than rediscovered:
 *
 *     @media (hover: hover) {
 *       .ctl-tint-on-tint:hover { background-color: hsl(var(--olivewood) / 0.14); }
 *     }
 *
 * — a FOURTH member of the sanctioned tone set, for controls that rest on a
 * tint: the same 8 points, applied from the control's own rest (0.06 + 0.08)
 * instead of from zero. Verified in the same harness by overriding the built
 * CSS: rest `rgba(46,47,34,0.06)` → hover `rgba(46,47,34,0.14)`, i.e.
 * rgb(228,230,232) → rgb(213,215,215), a ~16-unit step where there were 4.
 * Nothing moves; only the tint changes.
 *
 * Swapping `ctl-tint` for `ctl-tint-on-tint` in `POPUP_SECONDARY_CLS` is then
 * a one-word edit, and removing the ledger entry below is how it is proven.
 *
 * ─── WHY A LEDGER RATHER THAN A RED TEST ───────────────────────────────────
 *
 * The same contract `controlInteractionLedger.json` runs on: the rule lands
 * today, the offender is named, and the ledger MAY ONLY SHRINK — an entry that
 * is no longer a violation fails below, so it cannot become a permanent
 * excuse.
 *
 * Breaking the guarded source: widen the dismiss chip's resting tint so it is
 * no longer squeezed, and the "ledger only shrinks" assertion goes red — which
 * is exactly what must happen the day someone fixes it and forgets the ledger.
 *
 * @mutate src/components/ui/popupFooter.ts | bg-[hsl(var(--olivewood)/0.06)] | bg-[hsl(var(--olivewood)/0.30)]
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A step a person can see. 8 points is what the treatment gives an untinted
 * control; 6 is the floor this guard will accept, which still refuses the 2
 * measured above with room for a designer to pick 7 rather than 8.
 */
const MIN_DELTA = 0.06;

const CSS = readFileSync("src/index.css", "utf8");

/** The sanctioned tones, read out of the stylesheet rather than restated. */
function hoverTones(): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of CSS.matchAll(
    /\.(ctl-tint(?:-brand|-danger|-on-tint)?):hover\s*\{\s*background-color:\s*hsl\(var\(--([\w-]+)\)\s*\/\s*([\d.]+)\)/g,
  )) {
    out.set(m[1], Number(m[3]));
    out.set(`${m[1]}::token`, m[2] as unknown as number); // token, keyed apart
  }
  return out;
}

const TONES = hoverTones();
const toneToken = (cls: string) => String(TONES.get(`${cls}::token`) ?? "");
const toneAlpha = (cls: string) => Number(TONES.get(cls));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const SEGMENTS = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`((?:[^`\\]|\\.)*)`/gs;
const TONE_CLASS = /(?<![\w-])(ctl-tint(?:-brand|-danger|-on-tint)?)(?![\w-])/;
/** A resting fill written as an arbitrary token alpha: `bg-[hsl(var(--x)/0.06)]`. */
const RESTING_TINT = /(?<![\w-:])!?bg-\[hsl\(var\(--([\w-]+)\)\s*\/\s*([\d.]+)\)\]/g;

export type Squeezed = { file: string; tone: string; rest: number; hover: number };

export function squeezed(file: string, src: string): Squeezed[] {
  const out: Squeezed[] = [];
  for (const m of src.matchAll(SEGMENTS)) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    const tone = TONE_CLASS.exec(text)?.[1];
    if (!tone) continue;
    const hover = toneAlpha(tone);
    if (!Number.isFinite(hover)) continue;
    for (const r of text.matchAll(RESTING_TINT)) {
      // Only the SAME token can squeeze the step — a different token is a hue
      // change, which reads as a change whatever the alphas are.
      if (r[1] !== toneToken(tone)) continue;
      const rest = Number(r[2]);
      // SIGNED, not absolute. `Math.abs` caught a step that is too SMALL and
      // missed one in the wrong DIRECTION: a control resting darker than its
      // own hover tone gets PALER on hover, which is backwards against the
      // single rule ("the surface darkened one step") and reads as no feedback
      // at all. It also let this file survive its own mutation — raising the
      // rest to 0.30 against a 0.14 hover produced |−0.16| and looked healthy.
      if (hover - rest < MIN_DELTA) out.push({ file, tone, rest, hover });
    }
  }
  return out;
}

/**
 * THE HAND-BACK LEDGER. One entry: the popup footer's dismiss. It is the
 * measurement at the top of this file, and it clears the moment
 * `.ctl-tint-on-tint` exists in src/index.css and `POPUP_SECONDARY_CLS` uses
 * it. MAY ONLY SHRINK.
 */
// EMPTY, and it earned it: `.ctl-tint-on-tint` landed in index.css on
// 2026-09-19 and popupFooter.ts now uses it, so the only entry is gone. The
// ledger may only shrink — a re-added entry needs a reason, and an entry that
// stops being a violation fails the case below rather than lingering as an
// excuse.
const LEDGER: string[] = [];

const FILES = walk("src");
const found = FILES.flatMap((f) => squeezed(f, readFileSync(f, "utf8")));

describe("a hover tint is a step a person can see", () => {
  it("reads the sanctioned tones out of src/index.css, and there are three", () => {
    // FLOOR: if the tone parser broke, every control below would look clean.
    expect(toneAlpha("ctl-tint"), "the neutral tone is not readable from index.css").toBeGreaterThan(0);
    expect(toneToken("ctl-tint")).toBe("olivewood");
    expect(toneAlpha("ctl-tint-brand")).toBeGreaterThan(0);
    expect(toneAlpha("ctl-tint-danger")).toBeGreaterThan(0);
    // and a real inventory of controls wearing one of them
    // Measured 2026-09-19: 11 files write a tone class directly. It is low
    // because most controls inherit one through the `ghost` / `outline` button
    // variants rather than spelling it themselves, so button.tsx counts once
    // for hundreds of rendered controls. The floor exists to catch the regex
    // silently matching nothing, not to describe the whole app.
    const wearing = FILES.filter((f) => TONE_CLASS.test(readFileSync(f, "utf8")));
    expect(wearing.length, "no controls wear a sanctioned tone — the detector is broken").toBeGreaterThan(8);
    expect(wearing).toContain("src/components/ui/button.tsx");
    expect(wearing).toContain("src/components/ui/popupFooter.ts");
  });

  it("catches a chip that rests on the same token its hover moves to", () => {
    const before = `const X = "px-4 bg-[hsl(var(--olivewood)/0.06)] ctl-tint text-x";`;
    expect(squeezed("x.ts", before)).toEqual([
      { file: "x.ts", tone: "ctl-tint", rest: 0.06, hover: toneAlpha("ctl-tint") },
    ]);
    // Resting on nothing: the full wash, which is the case the tone was for.
    expect(squeezed("x.ts", `const X = "px-4 ctl-tint";`)).toEqual([]);
    // A different token is a hue change, not a squeezed step.
    expect(squeezed("x.ts", `const X = "bg-[hsl(var(--bark)/0.06)] ctl-tint";`)).toEqual([]);
  });

  it("no unledgered control hovers by less than a visible step", () => {
    const bad = found.filter((s) => !LEDGER.includes(s.file));
    expect(
      bad,
      `a control resting on its own hover token moves by the DIFFERENCE; keep at least ${MIN_DELTA}`,
    ).toEqual([]);
  });

  it("the ledger only shrinks — a fixed control must be removed from it", () => {
    for (const f of LEDGER) {
      expect(
        found.map((s) => s.file),
        `${f} hovers visibly now — delete it from LEDGER`,
      ).toContain(f);
    }
  });

  it("the control that documented this now uses the fourth tone, and it is a real step", () => {
    // This case used to pin the DEFECT's measurement (popupFooter resting on
    // 0.06 and hovering to 0.08 — a four-unit step). The fix landed, so an
    // assertion that the violation still exists would be asserting a bug.
    // It now pins the FIX, and still fails in both directions: revert the
    // class and the first expect goes red; revert the index.css tone and the
    // second does.
    // Comments stripped FIRST. The file's own note explains the change by
    // naming the old class, and a bare scan reads that prose as a call site —
    // the same trap that bit twoFontTypeSystem, the vacuity preflight and the
    // hover cva scan today. A guard satisfied (or failed) by a comment is not
    // reading the code.
    const src = readFileSync("src/components/ui/popupFooter.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(
      src,
      "the popup dismiss must use the on-tint tone — it rests on a tint, so the plain wash moves it four units",
    ).toContain("ctl-tint-on-tint");
    expect(src).not.toMatch(/\bctl-tint\b(?!-on-tint)/);

    const css = readFileSync("src/index.css", "utf8");
    const rule = /\.ctl-tint-on-tint:hover\s*\{[^}]*?hsl\(var\(--olivewood\)\s*\/\s*([\d.]+)\)/.exec(css);
    expect(rule, "the fourth tone is not in index.css").toBeTruthy();
    // 0.14 against a 0.06 rest is the same 8 points `.ctl-tint` gives from zero.
    expect(Number(rule![1]) - 0.06).toBeCloseTo(0.08, 5);
  });
});
