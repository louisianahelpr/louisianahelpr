/**
 * THE AUTO-START NOTICE NEVER CLAIMS THE HELPR ARRIVED (audit 2026-10-29 A2-B12, server half).
 *
 * The bug, on prod (AA9 chunk 1a): auto_start_due_jobs sets in_progress at the start time whether or not the Helpr
 * came, and notify_poster_on_status_change told the poster "Work has started — Eli H. has started working".
 * The fix (20261029160717): with no arrival recorded (helper_arrived_at, poster_confirmed_arrival_at) the notice is
 * "Start time passed — Eli H. hasn't checked in ...". PGlite (applied 3x; before: "Work has started"; after: the new
 * words, the old ones only with an arrival, on-the-way unchanged): ~/.lh-shots/b20-b12/b20-b12n-proof.mjs.
 *
 * The body is read as the migrations leave it (effectiveDefs: the newest CREATE, any dollar-quote tag).
 *
 * @mutate supabase/migrations/20261029160717_autostart_notice_never_claims_arrival.sql |     IF NEW.helper_arrived_at IS NULL AND NEW.poster_confirmed_arrival_at IS NULL THEN |     IF false THEN
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const sql = blankSqlComments(defs.get("notify_poster_on_status_change")?.stmt ?? "");

describe("the auto-start notice never claims the Helpr arrived (A2-B12)", () => {
  it("the parser found the trigger body", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(sql).toContain("NEW.helper_on_the_way_at");
  });

  it("the in_progress branch says work started only after an arrival someone recorded", () => {
    const at = sql.indexOf("ELSIF NEW.status = 'in_progress'::job_status");
    expect(at).toBeGreaterThan(0);
    const branch = sql.slice(at, sql.indexOf("ELSIF", at + 10));
    const guard = branch.indexOf("IF NEW.helper_arrived_at IS NULL AND NEW.poster_confirmed_arrival_at IS NULL THEN");
    expect(guard).toBeGreaterThan(0);
    const noArrival = branch.slice(guard, branch.indexOf("ELSE", guard));
    expect(noArrival).toContain("v_title := 'Start time passed';");
    expect(noArrival).toContain("hasn''t checked in");
    expect(noArrival).not.toMatch(/started working|Work has started/);
    // "Work has started" appears only after the guard's ELSE.
    expect(branch.indexOf("'Work has started'")).toBeGreaterThan(branch.indexOf("ELSE", guard));
  });
});
