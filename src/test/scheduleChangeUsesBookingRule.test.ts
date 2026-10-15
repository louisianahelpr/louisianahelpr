/**
 * Q1676 — every check of "is this Helpr already booked then?" uses ONE rule.
 *
 * request_job_schedule_change (Q736) and respond_job_schedule_change (Q925)
 * carried an older copy of the double-booking rule than helpr_booking_clashes
 * (20261012171958): they missed a crew seat held while the crew is still
 * filling ('open', no jobs.helper_id) and ignored a crew member's own
 * group_job_helpers.helper_completed_at. The class: each of the three newest
 * definitions counts a crew seat on an 'open' job and drops a finished seat.
 *
 * Behaviour, red then green: src/test/pglite/scheduleChangeUsesBookingRule.pglite.mjs
 * (applied 3x: ALL CHECKS PASSED; NEW_MIGRATION=skip: 4 FAILED).
 *
 * @mutate supabase/migrations/20261015015604_schedule_change_uses_booking_rule.sql |        AND ((o.helper_id = v_job.helper_id\n             AND o.status::text IN ('accepted', 'in_progress')\n             AND o.helper_completed_at IS NULL)\n            OR (o.status::text IN ('open', 'accepted', 'in_progress') |        AND ((o.helper_id = v_job.helper_id\n             AND o.status::text IN ('accepted', 'in_progress')\n             AND o.helper_completed_at IS NULL)\n            OR (o.status::text IN ('accepted', 'in_progress')
 * @mutate supabase/migrations/20261015015604_schedule_change_uses_booking_rule.sql |                                  AND g.status = 'accepted'\n                                 AND g.helper_completed_at IS NULL))) |                                  AND g.status = 'accepted')))
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const FNS = ["helpr_booking_clashes", "request_job_schedule_change", "respond_job_schedule_change"] as const;
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("Q1676: the schedule-change clash checks use the double-booking rule", () => {
  it("the parse sees all three newest definitions", () => {
    expect(defs.size).toBeGreaterThan(200);
    for (const f of FNS) expect(flat(defs.get(f)?.stmt ?? "").length, f).toBeGreaterThan(300);
  });

  for (const f of FNS) {
    it(`${f} counts a crew seat on a job that is still filling ('open')`, () => {
      expect(flat(defs.get(f)?.stmt ?? "")).toMatch(/status::text IN \('open', 'accepted', 'in_progress'\) AND EXISTS \(SELECT 1 FROM public\.group_job_helpers g/i);
    });
    it(`${f} drops a crew seat the Helpr already marked done on their own row`, () => {
      expect(flat(defs.get(f)?.stmt ?? "")).toMatch(/g\.status = 'accepted' AND g\.helper_completed_at IS NULL/i);
    });
  }
});
