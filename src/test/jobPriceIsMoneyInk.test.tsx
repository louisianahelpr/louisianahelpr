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
});
