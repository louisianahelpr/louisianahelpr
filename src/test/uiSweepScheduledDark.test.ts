/**
 * @mutate .github/workflows/ui-sweep.yml | (github.event_name == 'schedule' && 'phone-light,phone-dark') | (github.event_name == 'schedule' && 'phone-light')
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Q256: the weekly scheduled UI sweeps must include dark mode, not only phone-light.
const wf = readFileSync(".github/workflows/ui-sweep.yml", "utf8");

describe("ui-sweep scheduled variants (Q256)", () => {
  it("a scheduled run resolves VARIANTS to include phone-dark", () => {
    const line = wf.split("\n").find((l) => /^\s+VARIANTS:/.test(l)) ?? "";
    expect(line).toMatch(/github\.event_name == 'schedule' && '[^']*phone-dark/);
  });
});
