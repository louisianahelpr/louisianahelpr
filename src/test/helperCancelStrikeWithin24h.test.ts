/**
 * A Helpr who gives up committed work before it starts gets a reliability
 * strike ONLY within 24 hours of the start (owner decisions Q407 (6) for series
 * visits and (11) for one-time jobs, 2026-09-25), and helper_cancel_booking
 * keeps BOTH branches that earlier restatements gave it: the crew branch
 * (20260925140148, Q393) and the series-visit return (20260925160645).
 *
 * Class: every function the migrations leave in the database that calls the
 * strike ladder (apply_job_denial_consequence) is inventoried two-way below.
 * A before-start give-up must gate EVERY ladder call on is_late_cancellation;
 * the other callers are classified with the reason they are not one.
 *
 * Read from the definition the database actually holds (effectiveDefs: the
 * newest CREATE plus any later in-place rewrite), comments blanked.
 * Executable proof: src/test/pglite/recurringSplitDays.pglite.mjs (one-time
 * job 20 days out: no strike; within 24h: a strike) and
 * src/test/pglite/groupRosterDeparture.pglite.mjs --tree /
 * groupCrewNoLead.pglite.mjs --tree (every crew-leave case on the tree's
 * helper_cancel_booking).
 *
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |     -- Owner decision Q407 (11): a strike only within 24 hours of the start.\n    IF public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN |     IF true THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   -- start, for a series visit and a one-time job alike.\n  IF public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN |   IF true THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   IF v_job.is_group_job IS TRUE\n     AND (v_slot_id IS NOT NULL OR v_job.helper_id IS DISTINCT FROM auth.uid()) THEN |   IF false THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |     v_released := public.series_release_dates(v_job.parent_job_id, auth.uid(), ARRAY[v_job.date_needed], 'visit_cancelled', |     v_released := public.series_visit_dates(v_job.parent_job_id, auth.uid(), ARRAY[v_job.date_needed], 'visit_cancelled',
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (name: string) => {
  const def = DEFS.get(name);
  if (!def) throw new Error(`${name}: not defined by any migration`);
  return blankSqlComments(def.stmt);
};

/** Every caller of the strike ladder, and why. Two-way: a new caller must be added here. */
const LADDER_CALLERS: Record<string, "before_start_give_up" | string> = {
  helper_cancel_booking: "before_start_give_up",
  series_give_up_strike: "before_start_give_up",
  helper_abort_job: "abandons a job already in progress (after the start), not a before-start cancel",
  decline_job_offer:
    "declines a hire offer the Helpr never confirmed; not a booking they committed to (owner question in docs/OPEN.md Q415)",
  expire_unanswered_offers: "a hire offer left unanswered past its deadline, not a cancellation",
};

const LATE_GATE = /IF\s+public\.is_late_cancellation\(\s*true\s*,/g;

describe("a before-start give-up strikes only within 24 hours (Q407 6, 11)", () => {
  it("inventories every caller of apply_job_denial_consequence (two-way)", () => {
    const callers = [...DEFS.keys()]
      .filter((n) => n !== "apply_job_denial_consequence")
      .filter((n) => /apply_job_denial_consequence\s*\(/.test(body(n)))
      .sort();
    expect(callers.length).toBeGreaterThanOrEqual(5);
    expect(callers).toEqual(Object.keys(LADDER_CALLERS).sort());
  });

  it("every ladder call in a before-start give-up is gated on is_late_cancellation", () => {
    const giveUps = Object.entries(LADDER_CALLERS).filter(([, why]) => why === "before_start_give_up");
    expect(giveUps.length).toBe(2);
    // helper_cancel_booking: one gated call per branch (crew, single).
    const hcb = body("helper_cancel_booking");
    const calls = (hcb.match(/apply_job_denial_consequence\s*\(/g) ?? []).length;
    const gated = (
      hcb.match(
        /IF\s+public\.is_late_cancellation\(\s*true\s*,\s*EXTRACT\(EPOCH FROM \(v_starts_at - now\(\)\)\) \/ 3600\.0\)\s+THEN\s+v_result\s*:=\s*public\.apply_job_denial_consequence\(/g,
      ) ?? []
    ).length;
    expect(calls).toBe(2);
    expect(gated).toBe(calls);
    // series_give_up_strike: the ladder runs only when a date is late.
    const give = body("series_give_up_strike");
    expect(give.match(LATE_GATE)?.length ?? 0).toBe(0); // it gates by WHERE, not IF
    expect(give).toMatch(/WHERE\s+public\.is_late_cancellation\(\s*true,/);
    expect(give).toMatch(/IF\s+v_late\s+IS\s+NULL\s+THEN\s+RETURN\s+false;/);
  });

  it("helper_cancel_booking keeps the crew branch (20260925140148) and the series return (20260925160645)", () => {
    const hcb = body("helper_cancel_booking");
    expect(hcb).toMatch(/IF\s+v_job\.is_group_job\s+IS\s+TRUE\s+AND\s+\(v_slot_id\s+IS\s+NOT\s+NULL\s+OR\s+v_job\.helper_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)\)\s+THEN/);
    expect(hcb).toMatch(/DELETE FROM public\.group_job_helpers WHERE id = v_slot_id;/);
    expect(hcb).toMatch(/v_released\s*:=\s*public\.series_release_dates\(v_job\.parent_job_id,\s*auth\.uid\(\),\s*ARRAY\[v_job\.date_needed\],\s*'visit_cancelled',/);
  });
});
