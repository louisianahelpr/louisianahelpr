/**
 * Guards the no-button-height-override rule itself:
 *   1. it catches the Enter App / Sign Out repro (a check that cannot fail is
 *      not a check), and allows `size`, `h-auto` and `h-full`;
 *   2. its legacy ledger only shrinks — a listed file that no longer hand-sets
 *      a Button height must be removed from the list.
 */
import { describe, expect, it } from "vitest";
import { ESLint, RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
// @ts-expect-error -- plain JS eslint rule, no declaration file
import rule from "../../scripts/eslint-rules/no-button-height-override.js";
import ledger from "../../scripts/eslint-rules/button-height-legacy.json";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

describe("no-button-height-override", () => {
  tester.run("no-button-height-override", rule as never, {
      valid: [
        `<Button size="lg" className="w-full">Sign Out</Button>`,
        `<Button className="h-auto whitespace-normal">x</Button>`,
        `<Button className="h-full">x</Button>`,
        `<div className="h-12">not a Button</div>`,
      ],
      invalid: [
        { code: `<Button className={cn("w-full", "h-auto !min-h-[60px]")}>Enter App</Button>`, errors: 1 },
        { code: `<Button className="h-7 px-2">Save</Button>`, errors: 1 },
        { code: "<Button className={`w-full ${x} sm:h-12`}>x</Button>", errors: 1 },
        { code: `<Button className={ok ? "min-h-9" : "h-10"}>x</Button>`, errors: 2 },
      ],
  });

  it("legacy ledger only lists files that still violate", async () => {
    // Ledger files have the rule OFF, so lint them with it forced on.
    const forced = new ESLint({
      overrideConfig: { rules: { "local/no-button-height-override": "error" } },
    });
    const forcedResults = await forced.lintFiles(ledger as string[]);
    const nowClean = forcedResults
      .filter((r) => !r.messages.some((m) => m.ruleId === "local/no-button-height-override"))
      .map((r) => r.filePath.replace(process.cwd() + "/", ""));
    expect(nowClean, "remove these from scripts/eslint-rules/button-height-legacy.json — they are clean now").toEqual([]);
  }, 120_000);
});
