/**
 * Q1920: fixtureSchemaContract grades every `{ … }` literal objectLiterals finds. Its bracket matcher respects
 * quotes but did not know comments, so an apostrophe in a comment opened a "string" and a brace in an @mutate
 * comment shifted the depth: one comment could turn a whole test file into one graded "row" (a false red), or as
 * easily hide a bad fixture. objectLiterals now reads the source with its comments blanked.
 *
 * @mutate src/test/helpers/schemaConstraints.ts |   const code = blankComments(src); |   const code = src;
 * @mutate src/test/helpers/schemaConstraints.ts |     if (/(?:\)\|=>\|\belse\|\btry\|\bfinally\|\bdo)$/.test(before)) continue; |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { objectLiterals } from "./helpers/schemaConstraints";

const keysOf = (lit: string) => [...lit.matchAll(/(?:^\s*|[{,]\s*)([a-z0-9_]+):/gm)].map((m) => m[1]);

describe("objectLiterals reads code, not comments (Q1920)", () => {
  it("an apostrophe in a comment inside a literal does not open a string and lose the literal", () => {
    const src = [
      "const a = {",
      "  // the job's status before the cancel",
      '  status: "cancelled", budget: 40,',
      "};",
      'const b = { payment_status: "refunded" };',
    ].join("\n");
    const lits = objectLiterals(src).map(keysOf);
    expect(lits).toEqual([["status", "budget"], ["payment_status"]]);
  });

  it("a brace in a block comment inside a literal does not end it early", () => {
    const src = 'const row = {\n  /* @mutate x.ts | } | { */\n  status: "open", budget: 5,\n};';
    expect(objectLiterals(src).map(keysOf)).toEqual([["status", "budget"]]);
  });

  it("a function or arrow body is a block, not a row; the object literals inside it still count", () => {
    const src = 'it("x", () => {\n  const r = { status: "held" };\n  if (r) {\n    use({ budget: 5 });\n  } else {\n    use({ title: "t" });\n  }\n});';
    expect(objectLiterals(src).map(keysOf)).toEqual([["status"], ["budget"], ["title"]]);
  });

  it("a comment inside a literal is blanked, not graded, and strings keep their text", () => {
    const src = 'const r = {\n  // it\'s held until Friday\n  status: "held", note: "it\'s // not a comment",\n};';
    const [lit] = objectLiterals(src);
    expect(keysOf(lit)).toEqual(["status", "note"]);
    expect(lit).toContain('"it\'s // not a comment"');
    expect(lit).not.toContain("held until Friday");
  });

  it("still finds the real fixtures in a real test file (cannot pass vacuously)", () => {
    const src = readFileSync(join(__dirname, "fixtureSchemaContract.test.ts"), "utf8");
    expect(objectLiterals(src).length).toBeGreaterThan(20);
  });
});
