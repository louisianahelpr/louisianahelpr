/**
 * EVERY NEW JOB REACHES EVERY MEMBER (owner, 2026-10-09: "just send emails when
 * any job is posted no matter what parish"; no digest emails for now).
 *
 * Measured on prod that day: of 9 real members who joined, the instant job
 * alert reached only one, because notify_helpers_on_job_post queued a member
 * only if they lived in the job's parish AND had already applied or worked a
 * job. The newest definition must queue every member, and the sender must not
 * require the recipient's parish. Every other gate (verified, not banned,
 * browse gate, blocks, the Job Matches switch, once per job, hourly cap, early
 * access) is held by parishFanoutIsBounded and jobAnnouncementsApplyBrowseGate.
 * Behaviour: src/test/pglite/jobAlertsReachEveryMember.pglite.mjs (13/13;
 * NEW_MIGRATION=skip -> 3 FAIL on the previous fan-out).
 *
 * @mutate supabase/migrations/20261009171601_job_alerts_reach_every_member.sql |       WHERE p2.user_id IS NOT NULL | WHERE p2.parish = NEW.parish
 * @mutate supabase/migrations/20261009171601_job_alerts_reach_every_member.sql |   IF NEW.status <> 'open' THEN |   IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
 * @mutate supabase/migrations/20261009171601_job_alerts_reach_every_member.sql |   v_title TEXT := 'New job posted'; |   v_title TEXT := 'New job in your parish';
 * @mutate supabase/migrations/20261009171601_job_alerts_reach_every_member.sql |            m->>'title', m->>'message', m->>'link', true) |            m->>'title', m->>'message', m->>'link', false)
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("a new job is announced to every member, any parish", () => {
  it("the trigger's candidates are every member: no parish match, no prior-work test", () => {
    const b = body("notify_helpers_on_job_post");
    expect(b).toMatch(/WITH candidates AS \( SELECT p2\.user_id FROM public\.profiles p2 WHERE p2\.user_id IS NOT NULL AND NOT COALESCE\(p2\.is_seed, false\) \)/);
    expect(b).not.toMatch(/p2\.parish\s*=\s*NEW\.parish/);
    expect(b).not.toMatch(/FROM public\.applications a WHERE a\.helper_id = p2\.user_id/);
    expect(b).not.toMatch(/NEW\.parish IS NULL/);
  });

  it("the location-matched instant path emails too (it claims the same once-per-job slot)", () => {
    const e = body("enqueue_instant_job_match");
    expect(e).toMatch(/INSERT INTO public\.job_match_queue \(user_id, job_id, source, notify_at, title, message, link, send_email\) VALUES \([^;]*?, true\)/);
    expect(e).toContain("send_email = true");
    expect(e).not.toContain("send_email = false");
  });

  it("the sender does not require a parish and says a job was posted", () => {
    const d = body("deliver_parish_match_alert");
    expect(d).not.toMatch(/v_job\.parish IS NULL/);
    expect(d).toContain("v_title TEXT := 'New job posted';");
    expect(d).not.toContain("in your parish");
  });
});
