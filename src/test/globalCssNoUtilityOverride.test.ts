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

function offenders(css: string): string[] {
  const out: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    // Keyframe steps and @font-face-like at-rule bodies are not element rules.
    if (rule.parent?.type === "atrule" && /keyframes/.test((rule.parent as postcss.AtRule).name)) return;
    const sizes = rule.nodes.filter((n) => n.type === "decl" && SIZING.test((n as postcss.Declaration).prop));
    if (!sizes.length) return;
    for (const sel of rule.selectors) {
      const s = sel.trim();
      if (/^:where\(/.test(s) && s.endsWith(")")) continue;
      if (/[.#]/.test(s.replace(/\[[^\]]*\]/g, ""))) continue; // has a class or id: component rule
      // Scoped to CONTROLS, the class this incident belongs to. Layout
      // scaffolding (main, [data-app-shell], scrollbars) is a separate concern.
      if (!/(^|[\s>+~(,])(button|a|input|select|summary|label)\b|\[role=["']?(button|link|tab|switch|checkbox|radio|menuitem)/.test(s)) continue;
      out.push(`${s} { ${sizes.map((d) => (d as postcss.Declaration).prop).join(", ")} }`);
    }
  });
  return out;
}

describe("global CSS never out-ranks size utilities", () => {
  it("catches the original touch-floor rule", () => {
    const bad = `button:not([role="checkbox"]):not([role="radio"]), [role="button"] { min-height: 44px; }`;
    expect(offenders(bad).length).toBe(2);
    expect(offenders(`:where(button, [role="button"]) { min-height: 44px; }`)).toEqual([]);
  });

  it("src/index.css has no class-less sizing rule outside :where()", () => {
    const found = offenders(readFileSync("src/index.css", "utf8"));
    expect(found, "wrap these selectors in :where() (see the touch-floor note in index.css):\n  " + found.join("\n  ")).toEqual([]);
  });
});
