// @mutate supabase/migrations/20260924101636_jobs_start_time_required.sql |     OR start_time IS NOT NULL\n |     OR true\n
// @mutate supabase/migrations/20260924101636_jobs_start_time_required.sql | OR (is_seed AND recurrence_days IS NULL) | OR is_seed
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * ST-008: a non-flexible job must have a start time, enforced by the server.
 * A NULL start_time on a scheduled job gave four server readers four different
 * start times (midnight, 09:00, 23:59:59, never). Seed fixtures are exempt, but
 * never a recurring parent: charge-recurring-visits charges the card and THEN
 * copies start_time to the visit without is_seed, so the visit insert would fail
 * after the money moved.
 *
 * Behaviour (red before, green 3x) is proven in
 * src/test/pglite/jobsStartTimeRequired.pglite.mjs. This pins the newest
 * definition of the constraint, comments blanked.
 */
const MIG = join(resolve(__dirname, "..", ".."), "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

describe("jobs_start_time_required (ST-008)", () => {
  it("the newest definition requires a start time unless flexible or a non-recurring seed", () => {
    const defs = files
      .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")))
      .filter((s) => /ADD\s+CONSTRAINT\s+jobs_start_time_required/i.test(s));
    expect(defs.length, "no migration defines jobs_start_time_required").toBeGreaterThan(0);
    const check = defs[defs.length - 1].replace(/\s+/g, " ");
    expect(check).toMatch(
      /CHECK \( COALESCE\(is_flexible_schedule, false\) OR start_time IS NOT NULL OR \(is_seed AND recurrence_days IS NULL\) \)/,
    );
  });
});
