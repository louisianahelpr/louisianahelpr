/**
 * Working-forwards change 1 (owner, 2026-09-12): no global element rule may
 * out-rank Tailwind size utilities.
 *
 * index.css's touch floor `button:not([role=checkbox])… { min-height: 44px }`
 * sat outside any layer with specificity (0,3,1), so it beat every utility
 * (0,1,0): `min-h-[60px]` on /complete-profile rendered 49.5px, and 3,910 size
 * classes across the sweep did nothing. This fails any rule that sets a sizing
 * property on a selector with NO class in it (element / attribute / pseudo
 * only) unless the whole selector is wrapped in :where(), which has zero
 * specificity and therefore always loses to a utility, as a default should.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const SIZING = /^(min-|max-)?(height|width|block-size|inline-size)$|^padding/;

/**
 * Selectors whose subject is a CONTROL — the class this incident belongs to.
 * Layout scaffolding (main, [data-app-shell], scrollbars) is a separate concern.
 *
 * `[data-job-step-row] > …` is here because index.css states, beside those
 * rules, that they are "the row's complete child set: the primary slot's
 * controls, and every chip" — i.e. an attribute-only spelling of the same
 * control class. 2026-09-21: before it was added, the guard SURVIVED its own
 * registered mutation. Unwrapping the job-step width floor's `:where()` — the
 * literal 2026-09-19 regression, two bare attribute selectors out-ranking the
 * `min-w-0` that JOB_ACTION_CHIP_CLASS carries, reported by the a11y-prod
 * sweep as "asks min-w-0 (0px), renders 44.0px" — left this file GREEN,
 * because no `button`/`[role=…]` token appears anywhere in those selectors.
 */
const CONTROL_SELECTOR =
  /(^|[\s>+~(,])(button|a|input|select|summary|label)\b|\[role=["']?(button|link|tab|switch|checkbox|radio|menuitem)|\[data-job-step-row\]\s*>/;

/** `0`, `0px`, `0rem`… — the CSS initial a flex child needs to be allowed to shrink. */
const ZERO = /^0(?:[a-z%]*)$/i;

export interface CssScan {
  offenders: string[];
  /** Class-less control rules skipped only because every sizing value was 0. */
  zeroExempt: string[];
}

function scan(css: string): CssScan {
  const offenders: string[] = [];
  const zeroExempt: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    // Keyframe steps and @font-face-like at-rule bodies are not element rules.
    if (rule.parent?.type === "atrule" && /keyframes/.test((rule.parent as postcss.AtRule).name)) return;
    const sizes = rule.nodes.filter((n) => n.type === "decl" && SIZING.test((n as postcss.Declaration).prop));
    if (!sizes.length) return;
    // A `min-*: 0` cannot inflate a control past what its own class asks for —
    // it IS what `min-w-0` asks for, and restoring the CSS initial is the only
    // way a flex/grid child is allowed to shrink at all. The incident this
    // guard exists for is the opposite direction: a global rule handing a
    // control a size it did not ask for (min-h-[60px] rendering 49.5px). A
    // non-zero value is therefore the offence, and `zeroExempt` is floored
    // below so this carve-out can never quietly stop matching anything.
    const nonZero = sizes.filter((d) => !ZERO.test((d as postcss.Declaration).value.trim()));
    for (const sel of rule.selectors) {
      const s = sel.trim();
      if (/^:where\(/.test(s) && s.endsWith(")")) continue;
      if (/[.#]/.test(s.replace(/\[[^\]]*\]/g, ""))) continue; // has a class or id: component rule
      if (!CONTROL_SELECTOR.test(s)) continue;
      if (!nonZero.length) {
        zeroExempt.push(`${s} { ${sizes.map((d) => (d as postcss.Declaration).prop).join(", ")}: 0 }`);
        continue;
      }
      offenders.push(`${s} { ${nonZero.map((d) => (d as postcss.Declaration).prop).join(", ")} }`);
    }
  });
  return { offenders, zeroExempt };
}

function offenders(css: string): string[] {
  return scan(css).offenders;
}

describe("global CSS never out-ranks size utilities", () => {
  it("catches the original touch-floor rule", () => {
    const bad = `button:not([role="checkbox"]):not([role="radio"]), [role="button"] { min-height: 44px; }`;
    expect(offenders(bad).length).toBe(2);
    expect(offenders(`:where(button, [role="button"]) { min-height: 44px; }`)).toEqual([]);
  });

  it("catches the job-step width floor unwrapped — the 2026-09-19 regression", () => {
    const bad = `[data-job-step-row] > [data-job-step-primary] > *,\n[data-job-step-row] > :not([data-job-step-primary]) { min-width: 44px; }`;
    expect(offenders(bad).length).toBe(2);
    expect(offenders(`:where([data-job-step-row] > :not([data-job-step-primary])) { min-width: 44px; }`)).toEqual([]);
    // …and the zero carve-out really is about the VALUE, not the selector.
    expect(offenders(`[data-job-step-row] > * { min-width: 0; }`)).toEqual([]);
    expect(offenders(`[data-job-step-row] > * { min-width: 1px; }`).length).toBe(1);
  });

  it("src/index.css has no class-less sizing rule outside :where()", () => {
    const { offenders: found, zeroExempt } = scan(readFileSync("src/index.css", "utf8"));
    // FLOOR the corpus: an empty parse, a moved file or a SIZING regex that
    // stopped matching all pass `toEqual([])` by describing nothing.
    expect(zeroExempt.length, "the min-*:0 carve-out matched nothing — it is dead and must be removed")
      .toBeGreaterThan(0);
    expect(found, "wrap these selectors in :where() (see the touch-floor note in index.css):\n  " + found.join("\n  ")).toEqual([]);
  });
});

// Shown able to fail 2026-09-21: unwrapping the touch floor's `:where()` is the
// ORIGINAL incident — (0,3,1) beats every Tailwind size utility (0,1,0), so
// `min-h-[60px]` on /complete-profile rendered 49.5px and 3,910 size classes
// across the sweep did nothing.
// @mutate src/index.css | :where(\n    button:not([role="checkbox"]):not([role="radio"]):not([role="switch"]),\n    [role="button"],\n    input[type="checkbox"],\n    input[type="radio"]\n  ) {\n    min-height: 44px; | button:not([role="checkbox"]):not([role="radio"]):not([role="switch"]),\n  [role="button"],\n  input[type="checkbox"],\n  input[type="radio"] {\n    min-height: 44px;
// The job-step width floor, same shape, added 2026-09-19 after two bare
// attribute selectors silently defeated JOB_ACTION_CHIP_CLASS's `min-w-0`.
// @mutate src/index.css | :where([data-job-step-row] > [data-job-step-primary] > *),\n:where([data-job-step-row] > :not([data-job-step-primary])) { | [data-job-step-row] > [data-job-step-primary] > *,\n[data-job-step-row] > :not([data-job-step-primary]) {
