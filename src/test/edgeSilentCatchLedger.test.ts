/**
 * Q2378 (lh-silent-failure@4cf0f6e4cd#10): ESLint never checked
 * supabase/functions/**, so local/no-silent-catch skipped every edge function
 * (the money and payout code included). eslint.config.js now lints them with
 * that rule, and the catches that predate it are on
 * scripts/eslint-rules/edge-silent-catch-legacy.json, which ONLY SHRINKS.
 *
 * This guard re-runs the rule itself over every edge source file (inventory
 * from disk, tests excluded as eslint.config.js excludes them) and pins the
 * ledger EXACTLY, both ways: a listed file that is now clean must come off, and
 * an unlisted file with a silent catch is red here as well as in `npm run lint`.
 * It also reads eslint.config.js so the edge block cannot be dropped back into
 * the global ignores.
 */
// @mutate eslint.config.js | ".remember/**", "src/test/edge/**/*.gen.ts" | ".remember/**", "supabase/functions/**", "src/test/edge/**/*.gen.ts"
// @mutate eslint.config.js |     rules: { "local/no-silent-catch": "error" },\n  },\n  { | rules: { "local/no-silent-catch": "off" },\n  },\n  {
// @mutate scripts/eslint-rules/edge-silent-catch-legacy.json |   "supabase/functions/_shared/cardHold.ts",\n |
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
// @ts-expect-error -- plain JS eslint rule, no declaration file
import rule from "../../scripts/eslint-rules/no-silent-catch.js";

const ROOT = "supabase/functions";
const LEDGER = JSON.parse(readFileSync("scripts/eslint-rules/edge-silent-catch-legacy.json", "utf8")) as string[];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const linter = new Linter({ configType: "flat" });
const config = {
  files: ["**/*.{ts,tsx}"],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { local: { rules: { "no-silent-catch": rule } } },
  rules: { "local/no-silent-catch": "error" as const },
};
const offenders = walk(ROOT)
  .filter((f) => linter.verify(readFileSync(f, "utf8"), config, f).some((m) => m.ruleId === "local/no-silent-catch"))
  .sort();

describe("Q2378: edge functions are under no-silent-catch", () => {
  it("eslint.config.js lints supabase/functions with the rule (not globally ignored)", () => {
    const cfg = readFileSync("eslint.config.js", "utf8");
    const globalIgnores = /\{\s*ignores:\s*\[([^\]]*)\]\s*\}/.exec(cfg)?.[1] ?? "";
    expect(globalIgnores.length).toBeGreaterThan(10);
    expect(globalIgnores).not.toContain('"supabase/functions/**"');
    expect(cfg).toMatch(/files: \["supabase\/functions\/\*\*\/\*\.\{ts,tsx\}"\][\s\S]{0,900}"local\/no-silent-catch": "error"/);
    expect(cfg).toContain("files: EDGE_SILENT_CATCH_LEGACY,");
  });

  it("the legacy ledger is exact both ways (it only shrinks)", () => {
    expect(walk(ROOT).length).toBeGreaterThan(200);
    expect(offenders.length).toBeGreaterThan(0);
    expect([...LEDGER].sort()).toEqual(offenders);
  });
});
