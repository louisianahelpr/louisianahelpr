/**
 * Q2247 (owner 2026-10-21): a Helpr whose setup is unfinished holds only the
 * next 1 series date. claim_series_dates is the one member RPC that claims a
 * series hold (the inventory below, read from the NEWEST definition of every
 * function; the other writer is the hire trigger); its newest body counts the caller's future holds on the series
 * and, while helper_accept_block_reason names anything, answers every date
 * past the first needs_setup BEFORE the hold INSERT.
 *
 * Behaviour proof (PGlite, the real function): src/test/pglite/seriesClaimUnreadyHoldsOne.pglite.mjs
 * (ALL PASS; NEW_MIGRATION=skip: 6 FAILED; PLANT=nocap: 6 FAILED; PLANT=nocount: 4 FAILED).
 *
 * @mutate supabase/migrations/20261103032330_series_claim_takes_helpr_schedule_lock.sql |     IF v_block IS NOT NULL AND v_held_future + cardinality(v_claimed) >= 1 THEN | IF false THEN
 * @mutate supabase/migrations/20261103032330_series_claim_takes_helpr_schedule_lock.sql |    WHERE h.parent_job_id = v_job.id AND h.helper_id = v_uid AND h.visit_date >= v_today; |    WHERE false;
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const HOLD_INSERT = /INSERT\s+INTO\s+public\.series_visit_holds\b/i;

describe("Q2247: an unready claimer holds one series date", () => {
  it("the writers of a series hold are exactly the claim RPC and the hire trigger", () => {
    expect(defs.size).toBeGreaterThan(500);
    const writers = [...defs.keys()].filter((n) => HOLD_INSERT.test(body(n)));
    expect(writers).toContain("claim_series_dates");
    // Exact, both ways: a new writer of a hold is judged against Q2247 and added
    // here. series_holds_on_hire seeds the hired Helpr's dates when the series
    // itself is hired (recurring_helper_id set); that is the hire, not a claim,
    // and Q2247's rule is about claims (not changed by this item).
    expect(writers.sort()).toEqual(["claim_series_dates", "series_holds_on_hire"]);
  });

  it("counts the caller's future holds on the series", () => {
    expect(body("claim_series_dates")).toMatch(
      /SELECT\s+count\(\*\)\s+INTO\s+v_held_future\s+FROM\s+public\.series_visit_holds\s+h\s+WHERE\s+h\.parent_job_id\s*=\s*v_job\.id\s+AND\s+h\.helper_id\s*=\s*v_uid\s+AND\s+h\.visit_date\s*>=\s*v_today\s*;/i,
    );
  });

  it("answers every date past the first needs_setup before the hold INSERT", () => {
    const src = body("claim_series_dates");
    const at = src.search(HOLD_INSERT);
    expect(at).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, at - 300), at);
    expect(before).toMatch(
      /IF\s+v_block\s+IS\s+NOT\s+NULL\s+AND\s+v_held_future\s*\+\s*cardinality\(v_claimed\)\s*>=\s*1\s+THEN\s+v_needs_setup\s*:=\s*v_needs_setup\s*\|\|\s*v_d\s*;\s*CONTINUE\s*;\s*END\s+IF\s*;\s*$/i,
    );
  });
});
