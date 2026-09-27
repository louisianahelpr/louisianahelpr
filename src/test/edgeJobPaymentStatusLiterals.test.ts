/**
 * Q727: every jobs.payment_status value an edge function names is one the
 * database admits.
 *
 * auto-resolve-disputes mapped 'partially_refunded' to the poster, but
 * jobs_payment_status_check has never admitted that value (prod
 * pg_get_constraintdef, 2026-09-27: unpaid, escrow, payout_pending, released,
 * refunded, cancelled, abandoned, failed, chargeback, cancelling). A branch on a
 * value no row can hold is dead, and a write of it is refused at runtime.
 *
 * The inventory is read from supabase/functions (non-test .ts), in three shapes
 * that name jobs.payment_status and nothing else:
 *   1. `case "x":` inside `switch (paymentStatus)` / `switch (x.payment_status)`;
 *   2. members of a `*_PAYMENT_STATES = [...]` constant;
 *   3. payment_status literals inside a `.from("jobs")` query chain (.eq / .neq /
 *      .in / .update / .insert), cut at the chain's end (`;`).
 * tips and gift_cards have their own payment_status ('pending', 'paid'), and a
 * Stripe Checkout session has one too; those chains are not `.from("jobs")` and
 * are not counted.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { extractConstraints } from "./helpers/schemaConstraints";

// @mutate supabase/functions/auto-resolve-disputes/index.ts |     case "refunded":\n    case "chargeback": |     case "refunded":\n    case "partially_refunded":\n    case "chargeback":
// @mutate supabase/functions/execute-dispute-split/index.ts | const RESUME_PAYMENT_STATES = ["released", "refunded"] as const; | const RESUME_PAYMENT_STATES = ["released", "refunded", "partially_refunded"] as const;

const FN_DIR = resolve(__dirname, "../../supabase/functions");
const pay = extractConstraints().get("jobs")?.get("jobs_payment_status_check");
const ADMITTED = pay && pay.kind === "enum" ? pay.values : [];

const files = (readdirSync(FN_DIR, { recursive: true }) as string[])
  .filter((f) => f.endsWith(".ts") && !/(^|\/)(tests?|__tests__)\/|[._]test\.ts$/.test(f))
  .map((f) => ({ f, src: blankComments(readFileSync(join(FN_DIR, f), "utf8")) }));

const strs = (s: string) => [...s.matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]);

/** Returns `file: literal` for every jobs.payment_status literal found. */
function inventory(): { hits: string[]; shapes: Record<string, number> } {
  const hits: string[] = [];
  const shapes = { switchCase: 0, stateConst: 0, jobsChain: 0 };
  for (const { f, src } of files) {
    // 1. switch on a payment status.
    for (const m of src.matchAll(/switch\s*\(\s*[\w.]*(?:paymentStatus|payment_status)\s*\)\s*\{/gi)) {
      let depth = 1;
      let i = m.index! + m[0].length;
      const start = i;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      for (const c of src.slice(start, i).matchAll(/case\s+["']([a-z_]+)["']\s*:/g)) {
        hits.push(`${f}: ${c[1]}`);
        shapes.switchCase++;
      }
    }
    // 2. *_PAYMENT_STATES constants.
    for (const m of src.matchAll(/\b[A-Z_]*PAYMENT_STATES\s*=\s*\[([^\]]*)\]/g)) {
      for (const v of strs(m[1])) {
        hits.push(`${f}: ${v}`);
        shapes.stateConst++;
      }
    }
    // 3. payment_status literals in a .from("jobs") chain.
    for (const m of src.matchAll(/\.from\(\s*["']jobs["']\s*\)/g)) {
      const end = src.indexOf(";", m.index!);
      const chain = src.slice(m.index!, end === -1 ? undefined : end);
      for (const p of chain.matchAll(
        /\.(?:eq|neq)\(\s*["']payment_status["']\s*,\s*["']([a-z_]+)["']|\.in\(\s*["']payment_status["']\s*,\s*\[([^\]]*)\]|payment_status\s*:\s*["']([a-z_]+)["']/g,
      )) {
        for (const v of p[1] ? [p[1]] : p[3] ? [p[3]] : strs(p[2] ?? "")) {
          hits.push(`${f}: ${v}`);
          shapes.jobsChain++;
        }
      }
    }
  }
  return { hits, shapes };
}

describe("edge functions name only jobs.payment_status values the database admits (Q727)", () => {
  const { hits, shapes } = inventory();

  it("the inventory is real", () => {
    expect(ADMITTED).toContain("escrow");
    expect(ADMITTED.length).toBeGreaterThan(9);
    expect(files.length).toBeGreaterThan(50);
    // Each shape still finds something, so a regex drift cannot empty the check.
    expect(shapes.switchCase).toBeGreaterThanOrEqual(4);
    expect(shapes.stateConst).toBeGreaterThanOrEqual(5);
    expect(shapes.jobsChain).toBeGreaterThanOrEqual(20);
  });

  it("every literal is in jobs_payment_status_check", () => {
    const bad = hits.filter((h) => !ADMITTED.includes(h.slice(h.lastIndexOf(": ") + 2)));
    expect(bad, "a jobs.payment_status value the CHECK constraint refuses: drop the branch or admit the value").toEqual([]);
  });
});
