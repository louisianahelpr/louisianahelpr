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
 * Q1585 (owner decisions, 2026-10-12), behaviour proven in
 * src/test/pglite/jobMatchEmailsFollowups.pglite.mjs (22/22 applied 3x;
 * NEW_MIGRATION=skip -> 10 FAIL on the previous definitions):
 *  (b) no daily-list choice: nothing on the job-match path reads
 *      match_digest_mode, a trigger holds it false, the switch is gone from
 *      the screen (notificationPrefsScreen.test.tsx), and the daily in-app list
 *      never repeats a job a per-job alert covered;
 *  (a) the hourly cap re-queues, never drops (also parishFanoutIsBounded);
 *  (c) the trigger is one set-based INSERT;
 *  (d) job_match email carries a one-click List-Unsubscribe scoped to
 *      email_job_matches (edge behaviour: src/test/edge/jobMatchListUnsubscribe.test.ts).
 *
 * @mutate supabase/migrations/20261012042612_job_match_emails_followups.sql |       WHERE p2.user_id IS NOT NULL | WHERE p2.parish = NEW.parish
 * @mutate supabase/migrations/20261012042612_job_match_emails_followups.sql |       AND COALESCE(np.job_matches, true) IS TRUE\n      -- N-007 | AND COALESCE(np.job_matches, true) IS TRUE AND COALESCE(np.match_digest_mode, false) IS FALSE\n      -- N-007
 * @mutate supabase/migrations/20261012042612_job_match_emails_followups.sql |   NEW.match_digest_mode := false; |   NULL;
 * @mutate supabase/migrations/20261012042612_job_match_emails_followups.sql |          SET retry_after = GREATEST(v_oldest + interval '1 hour', now() + interval '1 minute')\n       WHERE id = r.id; |          SET status = 'dropped', drop_reason = 'hourly job_match cap', settled_at = now()\n       WHERE id = r.id;
 * @mutate supabase/migrations/20261012042612_job_match_emails_followups.sql |           SELECT 1 FROM public.parish_match_alert_queue q\n           WHERE q.user_id = p.user_id AND q.job_id = nj.id | SELECT 1 WHERE false
 * @mutate supabase/functions/send-notification-email/index.ts |         ? await unsubscribeHeaders(profile.email, 'job_matches') |         ? await unsubscribeHeaders(profile.email)
 * @mutate supabase/functions/email-unsubscribe/index.ts |         await setJobMatchEmails(supabase, profile.user_id, action !== 'resubscribe') |         await setCommercialConsent(supabase, profile.user_id, action !== 'resubscribe')
 * @mutate supabase/migrations/20261012042612_job_match_emails_followups.sql |   IF NEW.status <> 'open' THEN |   IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
 * @mutate supabase/migrations/20261012042612_job_match_emails_followups.sql |   v_title TEXT := 'New job posted'; |   v_title TEXT := 'New job in your parish';
 * @mutate supabase/migrations/20261009171601_job_alerts_reach_every_member.sql |            m->>'title', m->>'message', m->>'link', true) |            m->>'title', m->>'message', m->>'link', false)
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const MIG = "supabase/migrations";
const defs = effectiveDefs(MIG);
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

describe("Q1585: every member, every new job, no daily list, nothing dropped", () => {
  const FANOUT = ["notify_helpers_on_job_post", "deliver_parish_match_alert", "deliver_job_match"];

  it("the inventory is real", () => {
    for (const fn of [...FANOUT, "sweep_daily_job_digest", "hold_match_digest_mode_off"]) {
      expect(body(fn).length, fn).toBeGreaterThan(200);
    }
  });

  it("(b) nothing on the job-match path stands a member down for digest mode", () => {
    for (const fn of FANOUT) {
      const b = body(fn);
      expect(b, fn).not.toMatch(/match_digest_mode/);
      expect(b, fn).not.toMatch(/match_digest_queue/);
      expect(b, fn).not.toMatch(/'digested'/);
    }
  });

  it("(b) nothing can turn digest mode back on (an older build still sends it)", () => {
    expect(body("hold_match_digest_mode_off")).toContain("NEW.match_digest_mode := false; RETURN NEW;");
    const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => blankSqlComments(readFileSync(`${MIG}/${f}`, "utf8")).replace(/\s+/g, " "))
      .filter((sql) => /trg_hold_match_digest_mode_off/.test(sql));
    expect(all.length).toBeGreaterThan(0);
    const last = all[all.length - 1];
    // The newest migration naming the trigger leaves it created, after any drop.
    expect(last.lastIndexOf("CREATE TRIGGER trg_hold_match_digest_mode_off BEFORE INSERT OR UPDATE OF match_digest_mode ON public.notification_preferences FOR EACH ROW WHEN (NEW.match_digest_mode IS TRUE) EXECUTE FUNCTION public.hold_match_digest_mode_off();"))
      .toBeGreaterThan(last.lastIndexOf("DROP TRIGGER IF EXISTS trg_hold_match_digest_mode_off"));
  });

  it("(b) the daily in-app list counts only jobs no per-job alert covered", () => {
    const d = body("sweep_daily_job_digest");
    expect(d).toContain("AND NOT EXISTS ( SELECT 1 FROM public.notifications n WHERE n.user_id = p.user_id AND n.job_id = nj.id AND n.type = 'job_match' )");
    expect(d).toContain("AND NOT EXISTS ( SELECT 1 FROM public.parish_match_alert_queue q WHERE q.user_id = p.user_id AND q.job_id = nj.id )");
    expect(d).toContain("AND NOT EXISTS ( SELECT 1 FROM public.job_match_queue l WHERE l.user_id = p.user_id AND l.job_id = nj.id");
  });

  it("(a) over the hourly cap a queued alert waits, it is never dropped", () => {
    const j = body("deliver_job_match");
    expect(j).not.toContain("'hourly job_match cap'");
    expect(j).toContain("IF v_recent >= 10 THEN UPDATE public.job_match_queue SET retry_after = GREATEST(v_oldest + interval '1 hour', now() + interval '1 minute') WHERE id = r.id; RETURN false; END IF;");
    // The parish sender's re-queue is pinned by parishFanoutIsBounded.
    expect(body("deliver_parish_match_alert")).toContain("ON CONFLICT (user_id, job_id) DO UPDATE SET retry_after = EXCLUDED.retry_after; RETURN false;");
  });

  it("(c) the trigger is one set-based INSERT, no per-profile loop", () => {
    const t = body("notify_helpers_on_job_post");
    expect(t).not.toMatch(/\bLOOP\b|helper_record/);
    expect([...t.matchAll(/INSERT INTO public\.parish_match_alert_queue/g)].length).toBe(1);
    expect(t).toContain("ON CONFLICT (user_id, job_id) DO NOTHING;");
  });

  it("(d) job_match mail carries a one-click List-Unsubscribe scoped to the job-match email switch", () => {
    const send = blankComments(readFileSync("supabase/functions/send-notification-email/index.ts", "utf8"));
    expect(send).toMatch(/const isJobMatch = category === 'job_matches'/);
    expect(send).toContain("await unsubscribeHeaders(profile.email, 'job_matches')");
    // Both the queued and the direct-send fallback carry the same headers.
    expect([...send.matchAll(/\.\.\.\(listHeaders \? \{ headers: listHeaders \} : \{\}\)/g)].length).toBe(2);
    const unsub = blankComments(readFileSync("supabase/functions/email-unsubscribe/index.ts", "utf8"));
    // The list is verified as part of the signature, and a job-match link
    // writes only email_job_matches (never the commercial consent flags).
    expect(unsub).toMatch(/verifyUnsubscribeToken\(url\.searchParams\.get\('e'\), url\.searchParams\.get\('sig'\), list\)/);
    expect(unsub).toMatch(/if \(list === 'job_matches'\) \{\s*await setJobMatchEmails\(/);
    expect(unsub).toMatch(/\.upsert\(\{ user_id: userId, email_job_matches: !optOut \}, \{ onConflict: 'user_id' \}\)\s*\.select\('user_id'\)/);
  });
});

