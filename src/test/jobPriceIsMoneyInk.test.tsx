/**
 * HELPR-DESIGN-SPEC v2 §1.1: rust is for money, so a job card's price is
 * painted in the money ink (--burnt-sienna, the token every money figure in
 * the app uses), never plain ink. Design lane A found "T3" in src/index.css
 * forcing every .money-chip price to hsl(var(--foreground)) (2026-10-20).
 *
 * The class: every rule in src/index.css that sets `color` on a .money-chip
 * (inventory: read from the stylesheet, comments blanked) is applied to the
 * real MoneyChip in jsdom, and the COMPUTED colour of the price (the amount
 * and its "$") must be the money token. The inline bark colour on
 * MoneyAmount loses to the stylesheet's !important, as it does in a browser.
 *
 * @mutate src/index.css | .money-chip, .money-chip * { color: hsl(var(--burnt-sienna)) !important; } | .money-chip, .money-chip * { color: hsl(var(--foreground)) !important; }
 *
 * NO PILL (lead decision 11-03 for the owner, Q2036: "show the price as plain
 * bold text, Marketplace style"): the T3 `.money-chip` rule strips the chip's
 * fill, border, shadow and padding, so the price reads as plain bold text on
 * every card. Measured on Builder 86's photo-first card shots
 * (~/.lh-shots/b86-cards/after-*.png): "$123" etc. in bold rust, no pill.
 * @mutate src/index.css | .money-chip {\n  background: transparent !important; | .money-chip {\n  background: hsl(var(--muted)) !important;
 * @mutate src/index.css |   box-shadow: none !important;\n  padding: 0 !important;\n}\n.money-chip, .money-chip * { |   box-shadow: none !important;\n}\n.money-chip, .money-chip * {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { blankCssComments } from "./helpers/blankNonCode";
import { MoneyChip } from "@/components/job/MoneyChip";

const css = blankCssComments(readFileSync(resolve(__dirname, "..", "index.css"), "utf8"));

/** Top-level-or-nested plain rules whose selector names .money-chip and whose body sets `color`. */
function moneyChipColourRules(): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const body = m[2];
    if (!/\.money-chip\b/.test(selector)) continue;
    if (!/(^|[;\s])color\s*:/.test(body)) continue;
    out.push(`${selector} {${body}}`);
  }
  return out;
}

describe("a job card's price wears the money ink (spec §1.1)", () => {
  it("every stylesheet rule that colours a .money-chip names the money token", () => {
    const rules = moneyChipColourRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      const colour = r.match(/(^|[;\s{])color\s*:\s*([^;]+)/)?.[2] ?? "";
      expect(colour, r).toMatch(/hsl\(var\(--burnt-sienna\)\)/);
    }
  });

  it("computed: the rendered MoneyChip's amount and '$' are the money token", () => {
    const style = document.createElement("style");
    style.textContent = moneyChipColourRules().join("\n");
    document.head.appendChild(style);
    try {
      const { container } = render(<MoneyChip amount="90" />);
      const chip = container.querySelector(".money-chip") as HTMLElement;
      const amount = chip.firstElementChild as HTMLElement;
      const dollar = amount.firstElementChild as HTMLElement;
      for (const el of [amount, dollar]) {
        expect(getComputedStyle(el).color).toBe("hsl(var(--burnt-sienna))");
      }
    } finally {
      style.remove();
    }
  });

  it("no pill: the price is plain bold text (no fill, border, shadow or padding)", () => {
    const body = [...css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === ".money-chip")?.[2] ?? "";
    const decl = (p: string) => new RegExp(`(^|[;\\s])${p}\\s*:\\s*([^;]+);`).exec(body)?.[2].trim();
    expect(decl("background")).toBe("transparent !important");
    expect(decl("border-color")).toBe("transparent !important");
    expect(decl("box-shadow")).toBe("none !important");
    expect(decl("padding")).toBe("0 !important");
    expect(css).toMatch(/\.money-chip > :first-child \{[^}]*font-weight: 800 !important/);
  });
});
