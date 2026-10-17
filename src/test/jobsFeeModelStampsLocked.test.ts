import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * THE CLASS: a jobs fee-model stamp a non-server writer can set. Each stamp
 * (`*_fee_flat_cents` on public.jobs) decides who pays the fee on that job:
 * helper_fee_flat_cents (roadmap F3, the Helpr pays 5% + 70c) and
 * poster_fee_flat_cents (owner 2026-10-18, the poster pays 5% + 70c and the
 * Helpr keeps 100%). A poster who could write one could move the fee between
 * the two parties on a funded job.
 *
 * Inventory DERIVED from the migrations: every `ADD COLUMN ... <x>_fee_flat_cents`
 * on public.jobs. For each, the NEWEST enforce_jobs_fee_model_lock must clear it
 * on a non-server INSERT and refuse a non-server change (42501), and it must run
 * from a standing BEFORE INSERT OR UPDATE trigger. The poster stamp also needs
 * the consistency CHECK that keeps a poster-fee job's Helpr stamp at 0/0.
 *
 * Executed proof (red before, 3x replay, server writes land):
 * src/test/pglite/jobsPosterFeeModel.pglite.mjs.
 */

// @mutate supabase/migrations/20261017230824_jobs_poster_fee_model.sql |     NEW.poster_fee_flat_cents := NULL;\n |
// @mutate supabase/migrations/20261017230824_jobs_poster_fee_model.sql |   IF NEW.poster_fee_flat_cents IS DISTINCT FROM OLD.poster_fee_flat_cents THEN | IF false THEN
// @mutate supabase/migrations/20261017230824_jobs_poster_fee_model.sql |       ADD CONSTRAINT jobs_poster_fee_model_consistent | ADD CONSTRAINT jobs_poster_fee_model_consistent_x
// @mutate supabase/migrations/20261017230824_jobs_poster_fee_model.sql |         (poster_fee_flat_cents IS NULL) = (helper_fee_flat_cents IS DISTINCT FROM 0) |         (poster_fee_flat_cents IS NULL) = NOT (COALESCE(helper_fee_flat_cents = 0 AND helper_fee_percent = 0, false))

const ROOT = path.resolve(__dirname, "../..");
const MIG = path.join(ROOT, "supabase/migrations");
const allSql = migrationFiles(MIG).map((f) => blankSqlComments(readFileSync(path.join(MIG, f), "utf8"))).join("\n");

const stampColumns = (): string[] => {
  const cols = new Set<string>();
  const re = /ALTER\s+TABLE\s+(?:public\.)?jobs\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+_fee_flat_cents)\b/gi;
  for (const m of allSql.matchAll(re)) cols.add(m[1]);
  return [...cols].sort();
};

describe("jobs fee-model stamps are server-only", () => {
  const def = effectiveDefs(MIG).get("enforce_jobs_fee_model_lock");
  const lock = blankSqlComments(def?.stmt ?? "");

  it("finds the stamp columns", () => {
    // Exact: helper_fee_flat_cents (F3) and poster_fee_flat_cents (2026-10-18).
    // A third stamp is a deliberate edit here, and the it.each below covers it.
    expect(stampColumns()).toEqual(["helper_fee_flat_cents", "poster_fee_flat_cents"]);
    expect(def, "enforce_jobs_fee_model_lock has a definition").toBeTruthy();
  });

  it.each(stampColumns())("%s is cleared on a non-server INSERT and refused on a non-server change", (col) => {
    const insertBranch = /IF\s+TG_OP\s*=\s*'INSERT'\s+THEN([\s\S]*?)RETURN\s+NEW;/i.exec(lock);
    expect(insertBranch, "the lock has an INSERT branch").toBeTruthy();
    expect(insertBranch![1]).toMatch(new RegExp(`NEW\\.${col}\\s*:=\\s*NULL\\s*;`, "i"));
    expect(lock).toMatch(new RegExp(
      `IF\\s+NEW\\.${col}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${col}\\s+THEN\\s+RAISE\\s+EXCEPTION[^;]*ERRCODE\\s*=\\s*'42501'`, "i"));
  });

  it("the lock runs from a BEFORE INSERT OR UPDATE trigger on jobs, after the server-context exit", () => {
    expect(lock).toMatch(/IF\s+public\.is_server_context\(\)\s+THEN\s+RETURN\s+NEW;/i);
    const triggers = [...allSql.matchAll(/CREATE\s+TRIGGER\s+jobs_fee_model_lock\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.jobs[\s\S]*?EXECUTE\s+FUNCTION\s+public\.enforce_jobs_fee_model_lock\(\)/gi)];
    expect(triggers.length).toBeGreaterThan(0);
  });

  it("a poster-fee job keeps the Helpr stamp at 0/0 (consistency CHECK)", () => {
    const m = /ADD\s+CONSTRAINT\s+jobs_poster_fee_model_consistent\s+CHECK\s*\(([\s\S]*?)\)\s*;/i.exec(allSql);
    expect(m, "jobs_poster_fee_model_consistent exists").toBeTruthy();
    const check = m![1].replace(/\s+/g, " ");
    // A 0c flat stamp exists ONLY with the poster stamp (helprPaysNoFee relies
    // on it), and a poster-fee job's Helpr percent is exactly 0.
    expect(check).toMatch(/\(poster_fee_flat_cents IS NULL\) = \(helper_fee_flat_cents IS DISTINCT FROM 0\)/i);
    expect(check).toMatch(/poster_fee_flat_cents IS NULL OR helper_fee_percent IS NOT DISTINCT FROM 0/i);
  });
});
