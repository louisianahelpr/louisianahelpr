/**
 * "The Helpr didn't come" decided after the Helpr was released (B45, lead decision 10-31; open from Builder 39).
 * helpr_task_reopen puts the task back up for another Helpr with helpr_id NULL, so declutter_admin_decide_problem had
 * no Helpr to fault and refused p_fault 'helpr'. Migration 20261101020052 keeps the released Helpr's id
 * (helpr_tasks.released_helpr_id) wherever a Helpr is released or unassigned, and the 'helpr' fault uses it when
 * helpr_id is NULL. Read from the EFFECTIVE definitions (the ones the database runs).
 *
 * THE CLASS: every function whose effective body sets helpr_id = NULL also sets released_helpr_id = helpr_id in
 * the same SET (found by what it does, so a new releasing function is held to it).
 * Paths are proven in PGlite: src/test/pglite/declutterAdminHelprFault.pglite.mjs (3x; NEW_MIGRATION=skip-released
 * red on the released cases; red on 3 planted defects).
 *
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql |      SET status = 'open', released_helpr_id = helpr_id, helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, releases | SET status = 'open', helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, releases
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql |        SET status = 'open', released_helpr_id = helpr_id, helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, picked_up_at | SET status = 'open', helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, picked_up_at
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql |   v_fault_helpr := COALESCE(v_task.helpr_id, v_task.released_helpr_id); |   v_fault_helpr := v_task.helpr_id;
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql | SET status = 'failed', helpr_id = v_fault_helpr, closed_at | SET status = 'failed', closed_at
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

/** Every UPDATE ... SET clause in a body that sets helpr_id to NULL, with its function. */
function releasingSets(): { fn: string; set: string }[] {
  const out: { fn: string; set: string }[] = [];
  for (const fn of DEFS.keys()) {
    const src = body(fn);
    for (const m of src.matchAll(/UPDATE public\.helpr_tasks\s+SET\s+([\s\S]*?)\bWHERE\b/gi)) {
      if (/\bhelpr_id\s*=\s*NULL\b/i.test(m[1])) out.push({ fn, set: m[1] });
    }
  }
  return out;
}

describe("a released Helpr is kept, so 'the Helpr didn't come' can still be decided against them", () => {
  const sets = releasingSets();
  it("finds the releasing functions (the parser works)", () => {
    expect(sets.length).toBeGreaterThan(1);
    expect(sets.map((s) => s.fn).sort()).toEqual(["declutter_delivery_return_finish", "helpr_task_reopen"]);
  });
  it.each(sets.map((s) => [s.fn, s.set] as const))("%s keeps the released Helpr's id in the same SET", (_fn, set) => {
    expect(set).toMatch(/\breleased_helpr_id\s*=\s*helpr_id\b/);
  });
  it("the 'helpr' fault falls on the task's Helpr, or the released one when there is none", () => {
    const d = body("declutter_admin_decide_problem");
    expect(d.length).toBeGreaterThan(1000);
    expect(d).toMatch(/v_fault_helpr := COALESCE\(v_task\.helpr_id, v_task\.released_helpr_id\);/);
    // Allowed on a task back up for another Helpr (released, not taken again).
    expect(d).toMatch(/OR NOT \(v_task\.status = 'accepted' OR \(v_task\.status = 'open' AND v_task\.helpr_id IS NULL\)\)\) THEN/);
    // The refund's card-fee debt reads the task's Helpr: the task is closed on the faulted Helpr.
    expect(d).toMatch(/SET status = 'failed', helpr_id = v_fault_helpr,/);
    expect(d).toMatch(/helpr_task_give_job_strike\(v_fault_helpr,/);
    expect(d).toMatch(/declutter_notify\(v_fault_helpr, 'warning', 'Delivery decided',/);
    // A released Helpr never decides their own delivery either.
    expect(d).toMatch(/v_uid IS NOT DISTINCT FROM v_task\.released_helpr_id/);
  });
});
