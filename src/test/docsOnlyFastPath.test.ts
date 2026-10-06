/**
 * Docs-only fast path (owner, 2026-10-06: "why are the ticks taking so long").
 * A PR that changes only docs/ runs just the tests that read the changed files;
 * anything else runs the whole suite. The danger is a fast path that skips a
 * test a change could break, so the picker is pinned here: a code file anywhere
 * means everything runs, and a test reaches a doc either directly or through a
 * repo script it imports.
 *
 * @mutate scripts/ci/docs-only-tests.mjs | export const DOCS_ONLY = /^docs\//; | export const DOCS_ONLY = /^/;
 * @mutate scripts/ci/docs-only-tests.mjs |       if (s && (names(s) \|\| viaScripts(target, s, depth + 1))) return true; |       if (false) return true;
 * @mutate .github/workflows/vitest.yml |         if: ${{ steps.scope.outputs.docs_only != 'true' }}\n        run: npx vitest run --reporter=default --shard= |         if: ${{ false }}\n        run: npx vitest run --reporter=default --shard=
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { pickTests } from "../../scripts/ci/docs-only-tests.mjs";

const files: Record<string, string> = {
  "src/test/openGuard.test.ts": 'readFileSync("docs/OPEN.md")',
  "src/test/viaScript.test.ts": 'import { x } from "../../scripts/lib/reader.mjs";',
  "scripts/lib/reader.mjs": 'export const x = readFileSync("docs/audit/ledger.jsonl");',
  "src/lib/unrelated.test.ts": "expect(1).toBe(1)",
};
const read = (p: string) => {
  if (!(p in files)) throw new Error(`no ${p}`);
  return files[p];
};
const tests = Object.keys(files).filter((f) => f.includes(".test."));

describe("docs-only fast path", () => {
  it("a docs-only change runs exactly the tests that read the changed docs", () => {
    expect(pickTests(["docs/OPEN.md"], tests, read)).toEqual(["src/test/openGuard.test.ts"]);
  });

  it("reaches a doc through a repo script the test imports", () => {
    expect(pickTests(["docs/audit/ledger.jsonl"], tests, read)).toEqual(["src/test/viaScript.test.ts"]);
  });

  it("any changed file outside docs/ runs the whole suite", () => {
    expect(pickTests(["docs/OPEN.md", "src/lib/x.ts"], tests, read)).toBeNull();
    expect(pickTests([".github/workflows/vitest.yml"], tests, read)).toBeNull();
  });

  it("a docs change no test reads, or no change at all, runs the whole suite (never zero tests)", () => {
    expect(pickTests(["docs/nobody-reads-this.md"], tests, read)).toBeNull();
    expect(pickTests([], tests, read)).toBeNull();
  });

  it("the workflow runs the whole suite unless the scope step says docs-only, and keeps the required check", () => {
    const wf = readFileSync(join(process.cwd(), ".github/workflows/vitest.yml"), "utf8");
    expect(wf).toMatch(/if: \$\{\{ steps\.scope\.outputs\.docs_only != 'true' \}\}\n\s+run: npx vitest run --reporter=default --shard=/);
    expect(wf).toMatch(/if: \$\{\{ steps\.scope\.outputs\.docs_only == 'true' && matrix\.shard == 1 \}\}/);
    expect(wf).toMatch(/name: Vitest unit tests/);
    // Only a pull request can take the fast path; a push to main always runs everything.
    expect(wf).toMatch(/if \[ "\$EVENT" = "pull_request" \]; then[\s\S]{0,400}else[\s\S]{0,120}\{"docsOnly":false,"files":\[\]\}/);
  });
});
