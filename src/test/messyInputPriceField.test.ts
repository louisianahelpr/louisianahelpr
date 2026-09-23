/**
 * Q132 (docs/OPEN.md): prod-audit run 35844514386 skipped messy-input's
 * "post-job: ... price 0, negative, decimal and 1e9 are refused before
 * checkout" with "GAP: no price field reached with the generic stepper". Not
 * a missing fixture: the spec looked for getByRole("spinbutton"), and the
 * budget is CurrencyInput, type="text" — a textbox. It could never be found.
 *
 * The spec now finds it by BudgetSection's own aria-label. This guard holds
 * the two sides together from source: the spec's label regex must match the
 * label the app renders on the budget field, the field must still be the
 * text-typed CurrencyInput (or the spec's reasoning is stale), and the price
 * probe must not go back to the spinbutton role.
 *
 * @mutate e2e/prod-audit/messy-input.spec.ts | const p = page.getByLabel(BUDGET_FIELD_LABEL).filter({ visible: true }).first(); | const p = page.getByRole("spinbutton").filter({ visible: true }).first();
 * @mutate e2e/prod-audit/messy-input.spec.ts | const BUDGET_FIELD_LABEL = /job budget in dollars/i; | const BUDGET_FIELD_LABEL = /job price/i;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("Q132: messy-input reaches the post-job price field", () => {
  const spec = read("e2e/prod-audit/messy-input.spec.ts");
  const budget = read("src/components/postjob/BudgetSection.tsx");
  const currency = read("src/components/ui/currency-input.tsx");
  const test = spec.slice(spec.indexOf('scoped("post-job: whitespace-only title'), spec.indexOf('test.skip(!price, "GAP: no price field'));

  it("finds the price probe and the app's budget field (floor)", () => {
    expect(test.length).toBeGreaterThan(200);
    expect(budget).toMatch(/<CurrencyInput\s+id="budget"/);
  });

  it("the spec's label regex matches the aria-label BudgetSection gives the budget field", () => {
    const rx = /const BUDGET_FIELD_LABEL = \/(.+?)\/([a-z]*);/.exec(spec);
    expect(rx, "BUDGET_FIELD_LABEL not found").not.toBeNull();
    const re = new RegExp(rx![1], rx![2]);
    const field = budget.slice(budget.indexOf('<CurrencyInput\n            id="budget"') >= 0 ? budget.indexOf('<CurrencyInput\n            id="budget"') : budget.search(/<CurrencyInput\s+id="budget"/));
    const label = /aria-label="([^"]+)"/.exec(field.slice(0, 600))?.[1];
    expect(label, "budget field aria-label").toBeTruthy();
    expect(re.test(label!), `"${label}" vs ${re}`).toBe(true);
  });

  it("CurrencyInput renders a text input (so the spinbutton role cannot find it)", () => {
    expect(currency).toMatch(/type="text"/);
  });

  it("the price probe looks the field up by that label, not by the spinbutton role", () => {
    expect(test).toContain("page.getByLabel(BUDGET_FIELD_LABEL)");
    expect(test).not.toContain('getByRole("spinbutton")');
  });
});
