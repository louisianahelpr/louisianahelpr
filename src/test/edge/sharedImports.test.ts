import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: an edge function may not USE a `_shared` helper it never IMPORTED.
 *
 * Why this exists — a real bug that reached main on 2026-08-10:
 * `release-payout/index.ts` called `postSlackOpsAlert(...)` inside the
 * group-job refusal branch without importing it. At runtime that is a
 * ReferenceError, so instead of refusing the payout and paging ops, the
 * function would throw — in a money path.
 *
 * Nothing caught it. `npm run typecheck` runs `tsc -b` over tsconfig, which
 * covers `src/` plus a handful of individually-listed `_shared` files — it does
 * NOT compile `supabase/functions/**`. Those are Deno modules with URL imports
 * that tsc cannot resolve, Deno is not installed here, and no CI workflow
 * checks them. So ~61 edge functions, nearly all of them money or auth code,
 * had zero static analysis of any kind.
 *
 * A full type-check would need Deno in CI. This is the cheap 90% instead: it
 * catches undefined-identifier bugs, which is the class that actually shipped.
 * It is deliberately conservative — it only inspects helpers that `_shared`
 * genuinely exports, and only flags a call when there is no import binding that
 * name in the same file. Aliased and namespace imports are accepted.
 */

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");
const SHARED_DIR = join(FUNCTIONS_DIR, "_shared");

/** Every named export across `_shared/*.ts`. */
function sharedExports(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SHARED_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(SHARED_DIR, file), "utf8");
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(m[1]);
    }
    for (const m of src.matchAll(/^export\s+(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(m[1]);
    }
  }
  return names;
}

/** Every .ts file under supabase/functions, excluding _shared itself. */
function functionFiles(dir = FUNCTIONS_DIR, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "_shared" || entry === "node_modules") continue;
      functionFiles(full, acc);
    } else if (entry.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Names bound by any import statement in this file (named, aliased, default, namespace). */
function importedBindings(src: string): Set<string> {
  const bound = new Set<string>();
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+["'][^"']+["']/g)) {
    const clause = m[1];
    // { a, b as c }
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const alias = part.split(/\s+as\s+/);
        const name = (alias[1] ?? alias[0]).trim().replace(/^type\s+/, "");
        if (name) bound.add(name);
      }
    }
    // default / * as ns
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) bound.add(ns[1]);
    const def = clause.replace(/\{[\s\S]*?\}/, "").replace(/\*\s+as\s+[\w$]+/, "").trim();
    for (const piece of def.split(",")) {
      const name = piece.trim().replace(/^type\s+/, "");
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
    }
  }
  return bound;
}

/** Strip comments and string literals so a helper named in prose isn't a "use". */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''");
}

describe("edge functions — _shared helpers are imported before use", () => {
  const exported = sharedExports();

  it("finds the _shared export surface", () => {
    // Sanity: if this ever collapses to nothing the test below would pass
    // vacuously and quietly stop guarding anything.
    expect(exported.size).toBeGreaterThan(10);
    expect(exported.has("postSlackOpsAlert")).toBe(true);
  });

  it("has no edge function calling a _shared helper it did not import", () => {
    const violations: string[] = [];

    for (const file of functionFiles()) {
      const raw = readFileSync(file, "utf8");
      const src = stripNoise(raw);
      const bound = importedBindings(raw);

      for (const name of exported) {
        if (bound.has(name)) continue;
        // Only a CALL counts — `name(` — so a same-named local property or a
        // key in an object literal doesn't trip it.
        const called = new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(src);
        if (!called) continue;
        // A local definition of the same name is fine — several functions
        // define their own `jsonResponse`/`corsHeaders` rather than importing
        // the _shared one.
        //
        // Checked against RAW, not the stripped copy, on purpose: the comment
        // stripper above is regex-based and can over-match (a `/*`-like
        // sequence inside a URL or regex literal swallows the span after it),
        // which once hid a real `function jsonResponse(...)` declaration and
        // produced a false violation. Erring toward "it is defined" makes this
        // guard quieter, never noisier — the failure mode we want, since a
        // false positive would block CI on correct code.
        const definedLocally = new RegExp(
          `(?:function|const|let|var|class)\\s+${name}\\b`,
        ).test(raw);
        if (definedLocally) continue;
        violations.push(`${file.replace(process.cwd() + "/", "")} calls ${name}() without importing it`);
      }
    }

    expect(violations).toEqual([]);
  });
});
