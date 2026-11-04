/**
 * Q1889: on a job whose start had come, an unanswered offer told the poster "It's open to everyone again,
 * so you can pick somebody else" in the same second auto-expire-jobs said "Job auto-cancelled". The
 * promise was false: accept_application refuses once job_offer_cutoff(date, start) <= now() + 15 minutes.
 *
 * CLASS: the poster's single-offer expiry notice may promise a re-pick only while a re-pick is possible,
 * judged by THE SAME rule accept_application refuses on. In the NEWEST definitions: (1) the sweep computes
 * v_too_late from job_offer_cutoff(date_needed, start_time) <= now() + an interval, and that interval is
 * the one accept_application uses; (2) in the poster's title and message, the v_too_late branch comes
 * before the ELSE that says "pick somebody else" / "job reopened"; (3) the crew pass does the same with
 * v_crew_too_late, ahead of "hire someone from your applicants" and "pick somebody else". Backend proof:
 * src/test/pglite/expiredOfferTooLateToRehire.pglite.mjs (3x; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261104050109_notices_name_the_person.sql |              WHEN v_too_late\n             THEN 'Your Helpr didn''t answer | WHEN false\n             THEN 'Your Helpr didn''t answer
 * @mutate supabase/migrations/20261104050109_notices_name_the_person.sql | v_locked.start_time) <= now() + interval '15 minutes'; | v_locked.start_time) <= now() - interval '15 minutes';
 * @mutate supabase/migrations/20261104050109_notices_name_the_person.sql |                WHEN v_crew_too_late\n               THEN '". It''s now too late | WHEN false\n               THEN '". It''s now too late
 */
import { describe, expect, it } from "vitest";
import { resolve, join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = join(resolve(__dirname, "..", ".."), "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");

describe("an expired offer promises a re-pick only while one is possible (Q1889)", () => {
  it("reads a real inventory", () => {
    expect(DEFS.size).toBeGreaterThan(500);
  });

  it("the sweep's too-late rule is accept_application's own cutoff rule", () => {
    const accept = body("accept_application");
    const acceptInterval = accept.match(/v_cutoff <= now\(\) \+ interval '([^']+)'/)?.[1];
    expect(acceptInterval, "accept_application no longer refuses on the offer cutoff").toBeTruthy();
    const sweep = body("expire_unanswered_offers");
    const sweepInterval = sweep.match(/v_too_late := public\.job_offer_cutoff\(v_locked\.date_needed, v_locked\.start_time\) <= now\(\) \+ interval '([^']+)'/)?.[1];
    expect(sweepInterval).toBe(acceptInterval);
  });

  it("the too-late words come before the re-pick promise in the poster's notice", () => {
    const sweep = body("expire_unanswered_offers");
    const single = sweep.slice(0, sweep.indexOf("THE CREW PASS") > 0 ? sweep.indexOf("THE CREW PASS") : sweep.indexOf("FOR v_slot IN"));
    const title = single.match(/WHEN v_too_late\s+THEN 'Offer expired'\s+ELSE 'Offer expired — job reopened' END/);
    expect(title, "the title still says job reopened when it is too late").toBeTruthy();
    const tooLate = single.search(/WHEN v_too_late\s+THEN 'Your Helpr didn''t answer in time[^;]*too late to hire someone else/);
    const promise = single.indexOf("so you can pick somebody else");
    expect(tooLate).toBeGreaterThan(0);
    expect(promise).toBeGreaterThan(tooLate);
  });

  it("the crew pass uses the same rule, ahead of every re-pick promise", () => {
    const sweep = body("expire_unanswered_offers");
    const crew = sweep.slice(sweep.indexOf("FOR v_slot IN"));
    const interval = body("accept_application").match(/v_cutoff <= now\(\) \+ interval '([^']+)'/)?.[1];
    expect(crew).toContain(`v_crew_too_late := public.job_offer_cutoff(v_slot.date_needed, v_slot.start_time) <= now() + interval '${interval}';`);
    expect(crew).toMatch(/WHEN v_crew_too_late\s+THEN 'Offer expired'\s+ELSE 'Offer expired — spot reopened' END/);
    const tooLate = crew.search(/WHEN v_crew_too_late\s+THEN '"\. It''s now too late to fill that spot/);
    expect(tooLate).toBeGreaterThan(0);
    expect(crew.indexOf("hire someone from your applicants")).toBeGreaterThan(tooLate);
    expect(crew.indexOf("so you can pick somebody else")).toBeGreaterThan(tooLate);
  });
});
