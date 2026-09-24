/**
 * Q356 — every "who works this job" column on jobs is a hire, and a client
 * cannot write one.
 *
 * WHAT WAS BROKEN (prod, measured 2026-09-24T04:48Z with
 * scripts/probes/recurring-helper-patch.prod.mjs): Q346 locked jobs.helper_id
 * and offered_to_helper_id, but not recurring_helper_id. A poster PATCHed
 * recurrence_days + recurring_helper_id=<someone who never applied> and the
 * direct-offer target PATCHed recurring_helper_id=self — both 200, 1 row. The
 * daily charge-recurring-visits cron (service role) then books that person onto
 * every visit (helper_id, status accepted, an accepted application) and charges
 * the poster's card for each.
 *
 * THE CLASS: a jobs column naming the person who works the job — every
 * `*helper_id` column in the generated jobs Row, derived from
 * src/integrations/supabase/types.ts, not a hand list — that the client can
 * point at someone. Each must be:
 *   1. refused on UPDATE by the newest enforce_hire_columns_rpc_only when newly
 *      set from a client seat (the raise sits in an `IF NEW.<col> IS NOT NULL`
 *      block), and
 *   2. nulled on a client INSERT by the newest enforce_jobs_insert_column_lock,
 *      except offered_to_helper_id: a direct offer is born at post time, where
 *      the "Customers can create jobs" policy checks blocks.
 * The cron's own check (series skipped unless recurring_helper_id = the hired
 * helper and the pair is not blocked) is src/test/edge/charge-recurring-visits.test.ts.
 * Behavioural proof, red-before / green-after, 3x replay:
 * scripts/probes/recurring-helper-rpc-only.pglite.mjs. Live re-run:
 * scripts/probes/recurring-helper-patch.prod.mjs.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

/** `*helper_id` columns of the jobs Row type. */
function jobsHelperColumns(): string[] {
  const types = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const start = types.search(/\n\s+jobs: \{\n\s+Row: \{/);
  expect(start, "jobs Row not found in types.ts").toBeGreaterThan(-1);
  const rowEnd = types.indexOf("Insert: {", start);
  const row = types.slice(start, rowEnd);
  return [...row.matchAll(/^\s+(\w*helper_id): /gm)].map((m) => m[1]);
}

const norm = (s: string) => blankSqlComments(s).replace(/\s+/g, " ").toLowerCase();

describe("Q356: every jobs *helper_id column is locked against client writes", () => {
  const cols = jobsHelperColumns();
  const defs = effectiveDefs(MIG_DIR);
  const hire = norm(defs.get("enforce_hire_columns_rpc_only")?.stmt ?? "");
  const insertLock = norm(defs.get("enforce_jobs_insert_column_lock")?.stmt ?? "");

  it("the inventory is real", () => {
    expect(cols.length).toBeGreaterThan(2);
    for (const c of ["helper_id", "offered_to_helper_id", "recurring_helper_id"]) expect(cols).toContain(c);
    expect(hire).toContain("hire_requires_rpc");
    expect(insertLock).toContain("new.helper_id := null");
  });

  it("the UPDATE trigger refuses each one newly set from a client", () => {
    const unlocked = cols.filter(
      (c) => !new RegExp(`if new\\.${c} is not null and new\\.${c} is distinct from old\\.${c}\\b[^;]*? then raise exception 'hire_requires_rpc`).test(hire),
    );
    expect(unlocked, "jobs helper columns a client can still point at someone").toEqual([]);
  });

  it("recurring_helper_id is allowed only as the hired helper (the stamp copies NEW.helper_id)", () => {
    expect(hire).toMatch(
      /if new\.recurring_helper_id is not null and new\.recurring_helper_id is distinct from old\.recurring_helper_id and new\.recurring_helper_id is distinct from new\.helper_id then raise exception 'hire_requires_rpc/,
    );
  });

  it("the INSERT lock nulls each one (offered_to_helper_id excepted: the INSERT policy checks it)", () => {
    // The one exception is a real column (asserted in "the inventory is real").
    const clientBranch = insertLock.slice(insertLock.indexOf("return new; end if;"));
    const kept = cols.filter((c) => c !== "offered_to_helper_id" && !clientBranch.includes(`new.${c} := null;`));
    expect(kept, "jobs helper columns a client INSERT can still set").toEqual([]);
  });
});

// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | IF NEW.recurring_helper_id IS NOT NULL | IF false AND NEW.recurring_helper_id IS NOT NULL
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | AND NEW.recurring_helper_id IS DISTINCT FROM NEW.helper_id THEN | THEN
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | NEW.recurring_helper_id      := NULL; | NULL;
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | IF NEW.offered_to_helper_id IS NOT NULL | IF false AND NEW.offered_to_helper_id IS NOT NULL
