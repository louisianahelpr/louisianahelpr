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

/**
 * Blank comments and string BODIES, preserving every offset and the line count,
 * so a helper named in prose isn't counted as a "use".
 *
 * WAS a chain of deleting regexes. It was measured on 2026-09-21 to destroy
 * **53 of the 96 edge files** — not distort them, destroy them: `brand-asset/
 * index.ts` came out 100% empty, every `stripe-webhook` handler lost 92%+, and
 * `arrival-confirm-reminder` lost 87% INCLUDING its `postSlackOpsAlert(` call.
 * Deleting the import from that file left this guard fully green, while the
 * identical mutation on `release-payout` failed it. The guard was covering
 * whichever files happened to survive its own stripper.
 *
 * Cause is the documented one, one line up from where it was documented: a
 * non-greedy `/\*[\s\S]*?\*\//` has no idea it is inside a string, so the
 * `/*` in a URL, a regex literal, or a `"https://…"` opens a comment that runs
 * to the next `*` + `/` anywhere in the file and takes everything between.
 * The guard already knew — its `definedLocally` check reads RAW precisely
 * because "the comment stripper above is regex-based and can over-match". That
 * mitigation only ever protected against a FALSE POSITIVE. The same defect in
 * the other direction — a swallowed span hiding a REAL call — went unnoticed,
 * which is the direction that matters for a guard.
 *
 * A single left-to-right scan cannot be fooled this way: it knows whether it is
 * inside a string before it looks at a `/`. Blanking rather than deleting keeps
 * offsets and line numbers usable, so a violation still points at the right
 * place.
 */
function stripNoise(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      blank(i + 1, j); // quotes kept, body blanked
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

describe("edge functions — _shared helpers are imported before use", () => {
  const exported = sharedExports();

  it("finds the _shared export surface", () => {
    // Sanity: if this ever collapses to nothing the test below would pass
    // vacuously and quietly stop guarding anything.
    expect(exported.size).toBeGreaterThan(10);
    expect(exported.has("postSlackOpsAlert")).toBe(true);
  });

  /*
   * THE PROPERTY THAT WAS MISSING, and the reason this guard silently covered
   * only 43 of 96 files for months: nothing asserted that the noise-stripper
   * preserves the code. Blanking does; deleting does not. Checking the length
   * is exact, cheap, and would have gone red the day the regex version shipped
   * — `brand-asset/index.ts` came out of it 100% empty.
   *
   * This is a property of the stripper, not a sample of files, so it cannot rot
   * as functions are added or rewritten.
   */
  it("the noise-stripper preserves every byte position (it blanks, never deletes)", () => {
    const damaged: string[] = [];
    for (const file of functionFiles()) {
      const raw = readFileSync(file, "utf8");
      const stripped = stripNoise(raw);
      if (stripped.length !== raw.length || stripped.split("\n").length !== raw.split("\n").length) {
        damaged.push(
          `${file.replace(process.cwd() + "/", "")}: ${raw.length} bytes -> ${stripped.length}`,
        );
      }
    }
    expect(
      damaged,
      "a stripper that deletes shifts every later offset and can swallow whole spans of real code, " +
        "hiding the very calls this guard exists to find. It must blank in place.",
    ).toEqual([]);
  });

  it("actually sees a call in a file the old regex stripper destroyed", () => {
    // arrival-confirm-reminder lost 87% of itself to the previous stripper,
    // INCLUDING this call — deleting its import left the guard green. Pinning
    // one known-destroyed file keeps the regression concrete as well as
    // property-checked.
    const raw = readFileSync(
      join(FUNCTIONS_DIR, "arrival-confirm-reminder", "index.ts"),
      "utf8",
    );
    expect(/(?<![.\w$])postSlackOpsAlert\s*\(/.test(stripNoise(raw))).toBe(true);
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

// PROVEN RED 2026-09-21: removing `import { postSlackOpsAlert }` from
// arrival-confirm-reminder/index.ts — a file the OLD regex stripper destroyed
// 87% of, so the identical mutation was invisible before this session — now
// fails with "calls postSlackOpsAlert() without importing it".
// SOURCE-TEXT PIN: this reads repo source. It cannot see a runtime
// ReferenceError in a function deployed out of step with main, and it only
// knows helpers that `_shared/*.ts` exports by a top-level `export function|
// const|let|class` — a re-export or a default export is outside its inventory.
// @mutate supabase/functions/arrival-confirm-reminder/index.ts | import { postSlackOpsAlert } from "../_shared/slack-alerts.ts"; |
