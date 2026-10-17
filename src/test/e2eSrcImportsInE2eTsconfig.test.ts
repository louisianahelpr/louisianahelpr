/*
 * GUARD: every src/ file an e2e/ file imports (directly, or through that src
 * file's own relative and "@/" imports) is listed in tsconfig.e2e.json
 * "include". The mirror of e2eImportsInAppTsconfig.test.ts.
 *
 * tsconfig.e2e.json is a composite project that includes "e2e" plus a list of
 * single src files, so a src file an e2e spec reaches must be listed. An e2e
 * spec importing an unlisted src file runs fine under Playwright and passes
 * every targeted vitest, but `npm run typecheck` fails with TS6307. Found
 * 2026-10-17 by sec-c: wip/reds-e2e's 04-admin-safety.spec.ts imported
 * src/lib/refundAmount.ts (and through it src/lib/stripeFees.ts), neither
 * listed, and typecheck exited 2 on exactly those two files.
 */
// @mutate tsconfig.e2e.json | "src/lib/refundAmount.ts", |
// @mutate tsconfig.e2e.json | , "src/lib/stripeFees.ts"] | ]
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const tsconfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.e2e.json"), "utf8")) as { include: string[] };
const include = new Set(tsconfig.include);

function resolveTs(fromFile: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && /\.tsx?$/.test(c)) return c;
  }
  return null;
}

const IMPORT = /(?:from|import)\s*\(?\s*"((?:\.{1,2}\/|@\/)[^"]+)"/g;

/** Every src/ .ts(x) file reachable from `start`, following relative and "@/" imports inside src/. */
function srcClosure(start: string, out: Set<string>) {
  const rel = relative(ROOT, start);
  if (out.has(rel)) return;
  out.add(rel);
  for (const m of blankComments(readFileSync(start, "utf8")).matchAll(IMPORT)) {
    const f = resolveTs(start, m[1]);
    if (f && relative(ROOT, f).startsWith("src/")) srcClosure(f, out);
  }
}

describe("src files reached from e2e/ are in tsconfig.e2e.json", () => {
  const specs = walkSource([join(ROOT, "e2e")]).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
  const needed = new Set<string>();
  let importers = 0;
  for (const s of specs) {
    for (const m of blankComments(readFileSync(s, "utf8")).matchAll(IMPORT)) {
      if (m[1].startsWith("@/")) continue; // e2e has no "@/" alias of its own
      const f = resolveTs(s, m[1]);
      if (f && relative(ROOT, f).startsWith("src/")) {
        importers++;
        srcClosure(f, needed);
      }
    }
  }

  it("finds the e2e files and their src imports", () => {
    expect(specs.length).toBeGreaterThan(100);
    expect(importers).toBeGreaterThan(15); // 23 import lines on 2026-10-17
  });

  it("each is listed in tsconfig.e2e.json include (else TS6307 in typecheck)", () => {
    expect(needed.size).toBeGreaterThan(8);
    expect([...needed].filter((f) => !include.has(f)).sort()).toEqual([]);
  });
});
