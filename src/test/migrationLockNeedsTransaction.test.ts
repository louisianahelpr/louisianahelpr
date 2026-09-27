/**
 * CLASS CHECK: no migration takes a top-level LOCK outside a transaction
 * block (2026-09-27).
 *
 * The db-deploy gate (scripts/ci/replay-migrations.sh) replays each file with
 * `psql -f`, which runs every top-level statement in autocommit. There
 * Postgres refuses a bare `LOCK TABLE` ("can only be used in transaction
 * blocks"), and the gate stops the deploy even though `supabase db push`
 * would have accepted the file.
 *
 * FOUND 2026-09-27: 20260927162805 (Q723) took `LOCK TABLE job_match_queue`
 * at top level. db-deploy run 36334242146 failed on line 36, so the whole
 * migration never reached prod. It now takes the lock inside the DO block that
 * does the backfill and ADD CONSTRAINT (Q331's 20260926034714 pattern).
 *
 * THE CHECK: with comments and dollar-quoted bodies blanked, every top-level
 * LOCK statement must follow an explicit BEGIN with no COMMIT/ROLLBACK
 * between. Shown red on the pre-fix Q723 file.
 *
 * @mutate supabase/migrations/20260927162805_q723_job_match_errors_retry_and_settle.sql | DO $$\nBEGIN\n  LOCK TABLE public.job_match_queue IN SHARE ROW EXCLUSIVE MODE; | LOCK TABLE public.job_match_queue IN SHARE ROW EXCLUSIVE MODE;\nDO $$\nBEGIN
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "..", "..", "supabase", "migrations");

/** Blank every $tag$…$tag$ body so only top-level SQL remains. */
function blankDollarBodies(sql: string): string {
  return sql.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Top-level LOCK statements that run outside an explicit transaction. */
export function bareLocks(sql: string): number[] {
  const top = blankDollarBodies(blankSqlComments(sql));
  const out: number[] = [];
  let inTxn = false;
  for (const m of top.matchAll(/\b(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|LOCK)\b/gi)) {
    const before = top.slice(0, m.index);
    // Statement-leading keywords only: the previous non-space char is `;` or file start.
    if (!/(^|;)\s*$/.test(before)) continue;
    const kw = m[1].toUpperCase();
    if (kw === "LOCK") {
      if (!inTxn) out.push(before.split("\n").length);
    } else inTxn = kw === "BEGIN" || kw.startsWith("START");
  }
  return out;
}

describe("migrations never take a LOCK outside a transaction block", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

  it("sees the shapes it claims to (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(bareLocks("ALTER TABLE t ADD c int;\nLOCK TABLE t IN SHARE MODE;")).toEqual([2]);
    expect(bareLocks("LOCK t;")).toEqual([1]);
    expect(bareLocks("BEGIN;\nLOCK TABLE t;\nCOMMIT;")).toEqual([]);
    expect(bareLocks("BEGIN;\nCOMMIT;\nLOCK TABLE t;")).toEqual([3]);
    expect(bareLocks("DO $$\nBEGIN\n  LOCK TABLE t;\nEND $$;")).toEqual([]);
    expect(bareLocks("-- LOCK TABLE t;\nSELECT 1;")).toEqual([]);
  });

  it("every top-level LOCK sits inside BEGIN … COMMIT", () => {
    const bad = files.flatMap((f) => bareLocks(readFileSync(join(DIR, f), "utf8")).map((l) => `${f}:${l}`));
    expect(bad).toEqual([]);
  });
});
