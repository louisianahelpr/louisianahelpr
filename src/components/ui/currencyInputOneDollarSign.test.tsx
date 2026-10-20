// @mutate src/components/ui/currency-input.tsx |     style: "decimal", |     style: "currency", currency: "USD",
/**
 * Cowork design audit 2026-10-20, J2: the Post a Job budget field read
 * "$ $40.00" once it lost focus. The field draws a "$" prefix AND formatted
 * the value as currency, so every blurred CurrencyInput showed two.
 *
 * The class: every money field built on CurrencyInput (inventory = its call
 * sites in src/, read from source) shows exactly ONE "$" in what the person
 * sees (the prefix plus the value), focused or not, for every amount shape.
 */
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "@/test/helpers/trackedFiles";
import { join, resolve } from "node:path";
import { CurrencyInput } from "./currency-input";
import { blankComments } from "@/test/helpers/blankNonCode";

const SRC = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

function Harness({ initial }: { initial?: number }) {
  const [v, setV] = useState<number | undefined>(initial);
  return <CurrencyInput aria-label="amount" value={v} onChange={setV} />;
}

/** What a sighted person reads: the prefix glyph(s) plus the input's value. */
function visible(container: HTMLElement): string {
  const input = container.querySelector("input") as HTMLInputElement;
  const prefix = Array.from(container.querySelectorAll("span")).map((s) => s.textContent ?? "").join("");
  return `${prefix}${input.value}`;
}

describe("J2: a money field shows one dollar sign", () => {
  it("inventory: every CurrencyInput consumer in src is found", () => {
    const users = walk(SRC).filter((f) => /<CurrencyInput\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(users.length).toBeGreaterThan(2);
    expect(users.some((f) => f.endsWith("postjob/BudgetSection.tsx"))).toBe(true);
    // No consumer draws its own "$" next to the field (a second prefix).
    for (const f of users) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/<CurrencyInput\b[\s\S]*?\/>/g)) {
        const before = src.slice(Math.max(0, m.index! - 200), m.index!);
        expect(before, `${f} draws a "$" beside its CurrencyInput`).not.toMatch(/>\s*\$\s*<\/span>\s*$/);
      }
    }
  });

  for (const amount of [5, 40, 40.5, 1234.5, 999999.99]) {
    it(`$${amount}: one "$" blurred and focused`, () => {
      const { container } = render(<Harness initial={amount} />);
      expect((visible(container).match(/\$/g) ?? []).length, visible(container)).toBe(1);
      const input = screen.getByLabelText("amount");
      fireEvent.focus(input);
      expect((visible(container).match(/\$/g) ?? []).length, visible(container)).toBe(1);
      fireEvent.change(input, { target: { value: `${amount}` } });
      fireEvent.blur(input);
      expect((visible(container).match(/\$/g) ?? []).length, visible(container)).toBe(1);
    });
  }
});
