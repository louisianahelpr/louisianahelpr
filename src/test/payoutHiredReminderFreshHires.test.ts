/**
 * Owner report 2026-10-26: "You're hired. Set up payouts to get paid." went at
 * 20:09Z to a Helpr (7f65ef12) hired on 2026-10-08 for job 9c6ff2de, which was
 * COMPLETED (payout held). claim_payout_setup_reminders counted any job
 * holding money as "a hire", with no hire time and no status. It was the only
 * 'hired' reminder ever sent (payout_setup_reminders held 2 rows), and day1
 * would have followed.
 *
 * 20261027154326: 'hired' is per hire, for a live hire (not completed,
 * cancelled or disputed) made after payout_after_hire went live and in the
 * last 72 h; day1/day3/day7 per hire, from that hire's own 'hired', while it is
 * live; 'money' unchanged and first. Behaviour:
 * src/test/pglite/payoutHiredReminderFreshHires.pglite.mjs (ALL PASS, the
 * migration 3x; 8 FAIL on prod's body, the owner's case among them). This
 * guard pins the rule on the NEWEST definition.
 *
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |        AND h.hired_on > now() - interval '72 hours'\n |        AND true\n
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |        AND h.hired_on >= v_since\n |        AND true\n
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |            (j.status::text NOT IN ('completed', 'cancelled', 'disputed')) AS live | true AS live
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |          WHERE h.live AND h.uid IN (SELECT x.uid FROM helprs x)\n |          WHERE h.uid IN (SELECT x.uid FROM helprs x)\n
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |                         WHERE r.helper_id = h.uid AND r.reminder_stage = 'hired' AND r.job_id = h.jid) |                         WHERE r.helper_id = h.uid AND r.reminder_stage = 'hired')
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |   v_since constant timestamptz := '2026-10-25 23:40:59+00'; |   v_since constant timestamptz := '-infinity';
 */
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";

const fn = newestFunction("claim_payout_setup_reminders");
const body = fn.body.replace(/\s+/g, " ");

describe("the 'hired' payout reminder is only for a fresh, live hire", () => {
  it("reads the newest definition (floor)", () => {
    expect(fn.body.length).toBeGreaterThan(1000);
    // 20261030031059 (Job reminders) restated it with the follow-up switch; the hired rules are unchanged.
    // 20261031220849 (LEAD-B49-REBUILD: Builder 49's 20261030225327) adds the ID ask to the same ladder; hired rules unchanged.
    expect(fn.file).toContain("20261031220849");
  });

  it("a hire carries its time and whether it is live (not completed, cancelled or disputed; a crew seat by joined_at)", () => {
    expect(body).toContain("j.accepted_at AS hired_on, (j.status::text NOT IN ('completed', 'cancelled', 'disputed')) AS live");
    expect(body).toContain("g.joined_at, (j.status::text NOT IN ('completed', 'cancelled', 'disputed'))");
  });

  it("'hired' is per hire: live, after go-live, in the last 72 h, not already sent for that job", () => {
    expect(body).toContain("v_since constant timestamptz := '2026-10-25 23:40:59+00';");
    expect(body).toContain(
      "WHERE h.uid IN (SELECT x.uid FROM helprs x) AND h.live AND h.hired_on >= v_since AND h.hired_on > now() - interval '72 hours' AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r WHERE r.helper_id = h.uid AND r.reminder_stage = 'hired' AND r.job_id = h.jid)",
    );
    expect(body).toContain("WHEN d.hired_jid IS NOT NULL THEN 'hired:' || d.hired_jid::text");
  });

  it("day1/day3/day7 count from that hire's own 'hired', only while it is live; 'money' comes first", () => {
    expect(body).toContain("ON hr.helper_id = h.uid AND hr.reminder_stage = 'hired' AND hr.job_id = h.jid");
    expect(body).toContain("WHERE h.live AND h.uid IN (SELECT x.uid FROM helprs x)");
    const money = body.indexOf("CASE WHEN d.money_key IS NOT NULL THEN d.money_key");
    expect(money).toBeGreaterThan(0);
    expect(money).toBeLessThan(body.indexOf("WHEN d.hired_jid IS NOT NULL THEN 'hired:'"));
  });
});
