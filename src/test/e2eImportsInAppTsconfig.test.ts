/*
 * GUARD: every e2e/ file a src/test file imports (directly or through its own
 * relative imports) is listed in tsconfig.app.json "include".
 *
 * tsconfig.app.json is a composite project, so a file it compiles must be
 * listed. A test importing an unlisted e2e file passes under vitest but fails
 * `npm run typecheck` with TS6307, and lanes only run targeted vitest. It turned
 * the Test workflow red twice on 2026-09-23 (e2eSkipsAreJustified, then
 * fundedOpenJobPlan). This makes the class fail where the lane actually looks.
 */
// @mutate tsconfig.app.json |     "e2e/prod-audit/fundedOpenJobPlan.ts",\n | 
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const tsconfig = readFileSync(join(ROOT, "tsconfig.app.json"), "utf8");
const include = new Set([...tsconfig.matchAll(/^\s*"(e2e\/[^"]+)"/gm)].map((m) => m[1]));

function resolveTs(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c) && c.match(/\.tsx?$/)) return c;
  return null;
}

function e2eClosure(start: string, out: Set<string>) {
  const rel = relative(ROOT, start);
  if (out.has(rel)) return;
  out.add(rel);
  const src = readFileSync(start, "utf8");
  for (const m of src.matchAll(/(?:from|import)\s+"(\.{1,2}\/[^"]+)"/g)) {
    const f = resolveTs(start, m[1]);
    if (f && relative(ROOT, f).startsWith("e2e/")) e2eClosure(f, out);
  }
}

describe("e2e files imported by src/test are in the app tsconfig", () => {
  const tests = walkSource([join(ROOT, "src/test")]).filter((f) => /\.test\.tsx?$/.test(f));
  const needed = new Set<string>();
  let importers = 0;
  for (const t of tests) {
    const src = readFileSync(t, "utf8");
    for (const m of src.matchAll(/from\s+"((?:\.\.\/)+e2e\/[^"]+)"/g)) {
      const f = resolveTs(t, m[1]);
      if (f) { importers++; e2eClosure(f, needed); }
    }
  }

  it("finds the importers", () => {
    expect(importers).toBeGreaterThan(5);
  });

  it("each is listed in tsconfig.app.json include (else TS6307 in typecheck)", () => {
    expect(tests.length).toBeGreaterThan(300); // 347 on 2026-09-23
    expect(needed.size).toBeGreaterThan(5);
    expect([...needed].filter((f) => !include.has(f)).sort()).toEqual([]);
  });
});
