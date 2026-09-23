// @mutate src/test/edge/error-leak-EF5.test.ts | if (literal && imported && x.arguments.length === 2) return;\n | if (true) return;\n
/**
 * EF-5 (hole hunt 2026-09-15): the top-level catch of several handlers returned
 * the raw `err.message` / `String(err)` / raw upstream body to the caller,
 * handing Stripe/PostgREST schema and integration detail to an unauthenticated
 * client. The fix returns a fixed client-safe string and keeps the detail in
 * `console.error`.
 *
 * TWO HALVES, and it needed both (2026-09-19).
 *
 *   1. THE SIX FIXES STAY FIXED. Each entry pins the EXACT leak fragment the
 *      pre-fix source shipped, so the test is genuinely red on origin/main (the
 *      fragment is present) and green now (the fragment is gone). A generic
 *      regex was avoided because `err.message` is legitimately read in
 *      `console.error`/`isStaleAccountErr` — only the leak into a Response body
 *      is a defect.
 *
 *   2. THE CLASS IS SWEPT. Half 1 alone was the whole file, and `npm run
 *      vacuity` called it out as the one edge guard with empty-inventory
 *      vacuity: `LEAKS` is a six-name list written in this file and checked
 *      against itself, so a SEVENTH handler could ship the identical leak and
 *      nothing here would notice — and emptying the list would leave zero `it`
 *      blocks and a green file. CLAUDE.md's rule for exactly this:
 *      "inventory from source, minus what was checked, must be empty".
 *      So every `new Response(JSON.stringify(...))` in all 145 edge-function
 *      files is now parsed, and any that interpolates a caught error is
 *      reported against a ratchet that goes red in BOTH directions.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(process.cwd());
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");

/** function name → the raw-error fragments that must no longer appear. */
const LEAKS: Record<string, string[]> = {
  "stripe-connect": ["JSON.stringify({ error: err.message })"],
  "admin-user-actions": ["JSON.stringify({ error: (err as Error).message })"],
  "admin-resend-verification": ["JSON.stringify({ error: (err as Error).message })"],
  "stripe-idv-start": ["JSON.stringify({ error: (err as Error).message })"],
  "send-marketing-blast": ['JSON.stringify({ error: e.message || "Unknown error" })'],
  "ai-job-builder": [
    'error: e instanceof Error ? e.message : "Unknown error"',
    "${t.slice(0, 200)}",
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// The sweep: every Response body in every edge function, from the world.
// ───────────────────────────────────────────────────────────────────────────

function edgeFunctionFiles(dir = FUNCTIONS_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * A CAUGHT error reaching a response body — the exact EF-5 shape, decided on
 * the AST rather than by grep.
 *
 * The first cut of this sweep matched `err.message` textually inside any
 * `new Response(JSON.stringify(...))` and reported eleven files. Six of them
 * were the property KEY `error:` sitting within forty characters of an
 * unrelated `.message`, and two more were `describeDeleteError(pgErr.message)`
 * — a function whose whole job is to replace the raw text with a safe one. A
 * detector that cries wolf eight times out of eleven does not get read, and a
 * guard nobody reads is decoration.
 *
 * So the question is asked precisely:
 *   1. find every `catch (binding)`;
 *   2. TAINT the binding, and anything assigned from it inside the block —
 *      `const err = error as Error` and `const message = err instanceof Error
 *      ? err.message : String(err)` are both how this leak is actually written
 *      here, and a detector blind to one alias is blind to the class;
 *   3. flag a `new Response(...)` in that block whose BODY reads a tainted
 *      name in a VALUE position. Property keys are skipped, which is what
 *      stops `{ error: "Internal server error" }` inside `catch (error)` from
 *      reading as a leak.
 *
 * `console.error(err)` is untouched by all of it — the detail is supposed to
 * stay server-side, and only the response body is the defect.
 */
function usesTainted(node: ts.Node, names: ReadonlySet<string>): boolean {
  let hit = false;
  const scan = (x: ts.Node): void => {
    if (hit) return;
    // A property KEY is not a read of the variable that shares its name.
    if (ts.isPropertyAssignment(x)) return scan(x.initializer);
    // The ONE sanctioned way a caught error reaches a body:
    // publicErrorMessage(err, fallback) (supabase/functions/_shared/publicError.ts)
    // returns err.message only for a PublicError — a sentence written for the
    // caller — and the fixed fallback for anything raw.
    // Only the REAL helper, with a LITERAL fallback: a same-named local wrapper
    // or `publicErrorMessage(err, err.message)` must still count as a leak
    // (review of 96ae77309).
    if (ts.isCallExpression(x) && x.expression.getText() === "publicErrorMessage") {
      const fallback = x.arguments[1];
      const literal = !!fallback && (ts.isStringLiteral(fallback) || ts.isNoSubstitutionTemplateLiteral(fallback));
      const imported = /import\s*\{[^}]*\bpublicErrorMessage\b[^}]*\}\s*from\s*["'](?:\.\.\/)+_shared\/publicError\.ts["']/.test(x.getSourceFile().text);
      if (literal && imported && x.arguments.length === 2) return;
    }
    // `x.message` reads `x`, not `message`.
    if (ts.isPropertyAccessExpression(x)) return scan(x.expression);
    if (ts.isIdentifier(x) && names.has(x.text)) {
      hit = true;
      return;
    }
    ts.forEachChild(x, scan);
  };
  scan(node);
  return hit;
}

export interface LeakSite {
  file: string;
  line: number;
  /** The catch binding plus every alias tainted from it. */
  tainted: string[];
  snippet: string;
}

export function rawErrorResponseSites(files = edgeFunctionFiles()): LeakSite[] {
  const hits: LeakSite[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    const visit = (n: ts.Node): void => {
      if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) {
        const tainted = new Set<string>([n.variableDeclaration.name.text]);
        // Alias taint, to a fixpoint. Four passes is far more than any real
        // handler needs and keeps a pathological file from spinning.
        for (let pass = 0; pass < 4; pass++) {
          const before = tainted.size;
          const taint = (m: ts.Node): void => {
            if (ts.isVariableDeclaration(m) && ts.isIdentifier(m.name) && m.initializer && usesTainted(m.initializer, tainted))
              tainted.add(m.name.text);
            ts.forEachChild(m, taint);
          };
          ts.forEachChild(n.block, taint);
          if (tainted.size === before) break;
        }
        const inner = (m: ts.Node): void => {
          if (
            ts.isNewExpression(m) &&
            m.expression.getText() === "Response" &&
            m.arguments?.length &&
            usesTainted(m.arguments[0], tainted)
          )
            hits.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1,
              tainted: [...tainted],
              snippet: m.arguments[0].getText().replace(/\s+/g, " ").slice(0, 120),
            });
          ts.forEachChild(m, inner);
        };
        ts.forEachChild(n.block, inner);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits;
}

/**
 * The handlers that still echo a CAUGHT error into their response body, by
 * FILE — the line moves with every edit, so pinning a line number would make
 * this a churn generator.
 *
 * Every entry is a real finding, swept 2026-09-19 and NOT fixed here:
 * `supabase/functions/**` other than instant-job-match is owned by other lanes
 * today, and a guard lane rewriting seven handlers' error paths under its own
 * authority is how a "fix" ships unreviewed. instant-job-match WAS fixed,
 * because this lane owns it — which is also the proof the ratchet shrinks.
 *
 *   (create-payment was here; fixed 2026-09-22 once clients began showing the body.)
 *   admin-delete-user     — admin-authenticated, so the blast radius is small,
 *   admin-update-email      but it is still GoTrue/PostgREST detail on the wire.
 *   auth-email-hook       — called by GoTrue, not a browser; same class.
 *   delete-own-account    — `String(err)` straight into the body, to the account
 *                           owner, on the one path where a thrown Supabase error
 *                           carries table and column names.
 *   instant-payout        — money path; the Stripe error text reaches the helper.
 *   stripe-payouts          Same shape in both.
 *   helpr-pass-wallet     — `error?.message ?? "wallet pass failed"`.
 *
 * This list may only SHRINK, and it goes red in both directions: a NEW leaking
 * handler fails, and a fixed one whose entry is still here fails too.
 */
// @two-way src/test/edge/error-leak-EF5.test.ts:no longer leaks — remove it from KNOWN_LEAK_FILES
const KNOWN_LEAK_FILES: string[] = [
  "supabase/functions/admin-delete-user/index.ts",
  "supabase/functions/admin-update-email/index.ts",
  "supabase/functions/auth-email-hook/index.ts",
  "supabase/functions/delete-own-account/index.ts",
  "supabase/functions/helpr-pass-wallet/index.ts",
  "supabase/functions/instant-payout/index.ts",
  "supabase/functions/stripe-payouts/index.ts",
];

/** Pure, so the "able to fail" proof below can run it against a synthetic world. */
export function leakRatchetDrift(sites: LeakSite[], known: string[]): string[] {
  const now = new Set(sites.map((s) => s.file));
  const drift: string[] = [];
  for (const f of now) {
    if (!known.includes(f)) drift.push(`NEW handler echoes a caught error into its Response body: ${f}`);
  }
  for (const f of known) {
    if (!now.has(f)) drift.push(`${f} no longer leaks — remove it from KNOWN_LEAK_FILES (the list may only shrink)`);
  }
  return drift;
}

describe("EF-5 · handlers do not echo raw internal error text", () => {
  /**
   * THE FLOOR. `LEAKS` is a list declared in this file and iterated by this
   * file — the shape CLAUDE.md warns about nine times over. It cannot fail for
   * a handler it does not name, and if it were ever emptied every `it` below
   * would vanish and the file would report green having asserted nothing. The
   * sweep further down is the real answer to that; this stops the pinned half
   * from quietly evaporating.
   */
  it("the pinned-fragment inventory is intact", () => {
    expect(
      Object.keys(LEAKS).length,
      "LEAKS lost entries. Each one pins a fix that shipped; deleting one deletes the proof it stays fixed.",
    ).toBeGreaterThanOrEqual(6);
    const missing = Object.keys(LEAKS).filter(
      (name) => !fs.existsSync(path.join(FUNCTIONS_DIR, name, "index.ts")),
    );
    expect(
      missing,
      `LEAKS names edge functions that no longer exist, so their assertions pass by ` +
        `reading a file that is not there: ${missing.join(", ")}`,
    ).toEqual([]);
    expect(
      Object.values(LEAKS).flat().length,
      "every entry must pin at least one fragment",
    ).toBeGreaterThanOrEqual(Object.keys(LEAKS).length);
  });

  for (const [name, fragments] of Object.entries(LEAKS)) {
    it(`${name} returns a generic message, not the raw caught error`, () => {
      const src = fs.readFileSync(path.join(FUNCTIONS_DIR, name, "index.ts"), "utf8");
      for (const frag of fragments) {
        expect(src, `${name} still leaks: ${frag}`).not.toContain(frag);
      }
      // And the catch still logs the detail server-side (never silently dropped).
      expect(src).toMatch(/console\.error\(/);
    });
  }

  describe("the whole class, swept from source", () => {
    it("the sweep actually reads the edge functions", () => {
      const files = edgeFunctionFiles();
      expect(
        files.length,
        `Only ${files.length} .ts files found under ${FUNCTIONS_DIR}. The sweep below ` +
          `iterates this list, so a near-empty one makes it pass having read nothing.`,
      ).toBeGreaterThan(100);
    });

    it("the sweep can still SEE a leak", () => {
      // Synthetic, so nothing in the app has to stay broken for this to hold —
      // and it fails if the AST walk, the Response scoping or the regex breaks.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef5-probe-"));
      try {
        // Direct leak.
        fs.writeFileSync(
          path.join(dir, "leaky.ts"),
          'try { x(); } catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500 }); }\n',
        );
        // The same leak through the two aliases real handlers actually use.
        fs.writeFileSync(
          path.join(dir, "aliased.ts"),
          'try { x(); } catch (error) { const err = error as Error; const message = err instanceof Error ? err.message : String(err); ' +
            'return new Response(JSON.stringify({ error: message }), { status: 500 }); }\n',
        );
        // Clean: logs the detail, answers a fixed string — and the property KEY
        // is literally the catch binding's name, which is what a textual
        // detector gets wrong.
        fs.writeFileSync(
          path.join(dir, "clean.ts"),
          'try { x(); } catch (error) { console.error(error); return new Response(JSON.stringify({ error: "Something went wrong" }), { status: 500 }); }\n',
        );
        const found = rawErrorResponseSites([
          path.join(dir, "aliased.ts"),
          path.join(dir, "clean.ts"),
          path.join(dir, "leaky.ts"),
        ]);
        expect(
          found.map((f) => path.basename(f.file)).sort(),
          "the sweep no longer distinguishes a leaking Response body from a clean one " +
            "that only logs the error — every assertion below is then vacuous",
        ).toEqual(["aliased.ts", "leaky.ts"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("no edge function echoes a caught error into its Response body, beyond the known eight", () => {
      const sites = rawErrorResponseSites();
      const drift = leakRatchetDrift(sites, KNOWN_LEAK_FILES);
      expect(
        drift,
        "EF-5 is a CLASS, not six handlers. Return a fixed client-safe string and keep the " +
          "detail in console.error:\n" +
          drift.map((d) => `  - ${d}`).join("\n") +
          "\n\nAll sites currently seen:\n" +
          sites.map((s) => `  ${s.file}:${s.line}  ${s.snippet}`).join("\n"),
      ).toEqual([]);
    });

    it("the ratchet goes red in both directions", () => {
      const site: LeakSite = { file: "supabase/functions/made-up/index.ts", line: 1, tainted: ["err"], snippet: "…" };
      expect(leakRatchetDrift([site], [])).toEqual([
        "NEW handler echoes a caught error into its Response body: supabase/functions/made-up/index.ts",
      ]);
      expect(leakRatchetDrift([], ["supabase/functions/made-up/index.ts"])).toEqual([
        "supabase/functions/made-up/index.ts no longer leaks — remove it from KNOWN_LEAK_FILES (the list may only shrink)",
      ]);
      expect(leakRatchetDrift([site], ["supabase/functions/made-up/index.ts"])).toEqual([]);
    });
  });
});

// ─── proven able to fail, 2026-09-21 ───────────────────────────────────────
// The inventory IS derived (every .ts under supabase/functions, floored at
// >100 files), so a NEW leaking handler is caught: re-leaking the caught error
// from instant-job-match — a function that is NOT in KNOWN_LEAK_FILES — goes
// red. Red:
//   × no edge function echoes a caught error into its Response body, beyond the known eight
//   AssertionError: EF-5 is a CLASS, not six handlers. …
// @mutate supabase/functions/instant-job-match/index.ts | JSON.stringify({ error: "Could not run the job match right now." }) | JSON.stringify({ error: (error as Error).message })

describe("the publicErrorMessage exemption cannot be abused", () => {
  const sites = (code: string) => {
    const sf = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true);
    let hit = false;
    const visit = (n: ts.Node): void => {
      if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) {
        const names = new Set([n.variableDeclaration.name.text]);
        const find = (m: ts.Node): void => {
          if (ts.isNewExpression(m) && m.expression.getText() === "Response" && m.arguments?.[0] && usesTainted(m.arguments[0], names)) hit = true;
          ts.forEachChild(m, find);
        };
        find(n.block);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return hit;
  };
  const IMPORT = 'import { publicErrorMessage } from "../_shared/publicError.ts";\n';
  it("the real helper with a literal fallback is safe", () => {
    expect(sites(IMPORT + 'try {} catch (err) { return new Response(JSON.stringify({ error: publicErrorMessage(err, "fixed") })); }')).toBe(false);
  });
  it("is RED on a tainted fallback", () => {
    expect(sites(IMPORT + 'try {} catch (err) { return new Response(JSON.stringify({ error: publicErrorMessage(err, err.message) })); }')).toBe(true);
  });
  it("is RED on a same-named local wrapper (not imported from _shared)", () => {
    expect(sites('const publicErrorMessage = (e: any, f: string) => e.message;\ntry {} catch (err) { return new Response(JSON.stringify({ error: publicErrorMessage(err, "fixed") })); }')).toBe(true);
  });
});
