/**
 * BUY-41 (buying audit 10-30 #41): a delivery a Helpr backed out of or missed stayed in their "Deliveries near you",
 * then taking it said "Another Helpr took this delivery, or it closed." helpr_task_accept refuses a Helpr's own
 * released / helpr_no_show task (task_taken) and a task whose sale is held by an open problem (problem_open); the list
 * (helpr_tasks_open_near) now leaves out exactly those.
 *
 * Reads the NEWEST definition of both functions (effectiveDefs replays every migration, any dollar-quote tag) and pins
 * that every exclusion the accept makes on those two counts, the list makes too.
 * Backend proof: src/test/pglite/helprOpenDeliveriesHideBackedOut.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261031075157_helpr_open_deliveries_hide_backed_out.sql |      AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)\n |      AND true\n
 * @mutate supabase/migrations/20261031075157_helpr_open_deliveries_hide_backed_out.sql | e.task_event IN ('released', 'helpr_no_show')) | e.task_event IN ('released'))
 * @mutate supabase/migrations/20261031075157_helpr_open_deliveries_hide_backed_out.sql |      AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e | AND EXISTS (SELECT 1 FROM public.helpr_task_events e
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("Deliveries near you never lists one the Helpr can't take (BUY-41)", () => {
  it("the inventory read something: both functions exist", () => {
    expect(body("helpr_tasks_open_near").length).toBeGreaterThan(400);
    expect(body("helpr_task_accept").length).toBeGreaterThan(400);
  });

  it("the accept still refuses a Helpr's own back-out or miss, and a held sale (what the list mirrors)", () => {
    const accept = body("helpr_task_accept");
    expect(accept).toMatch(/e\.actor_id = v_uid AND e\.task_event IN \('released', 'helpr_no_show'\)/);
    expect(accept).toMatch(/helpr_task_source_held\(t\.source_kind, t\.source_id\)/);
  });

  it("the list leaves out a task this Helpr released or missed, and one whose sale is held", () => {
    const list = body("helpr_tasks_open_near");
    expect(list).toMatch(/AND NOT EXISTS \(SELECT 1 FROM public\.helpr_task_events e WHERE e\.task_id = t\.id AND e\.actor_id = v_uid AND e\.task_event IN \('released', 'helpr_no_show'\)\)/);
    expect(list).toMatch(/AND NOT public\.helpr_task_source_held\(t\.source_kind, t\.source_id\)/);
  });
});
