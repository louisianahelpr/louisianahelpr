/**
 * N-007: notify_helpers_on_job_post re-notified the whole parish every time a
 * funded job re-entered 'open', with no per-Helpr cooldown. The newest
 * migration defining it must keep both candidate predicates: once per
 * (job, Helpr), and an hourly per-Helpr cap.
 *
 * Q225 / V-008 (2026-09-26): the fan-out told every tier the job title at the
 * instant of funding (measured on prod: a free account got 'New job in your
 * parish' at 03:44:11, 20 minutes before its feed showed the job). It now only
 * QUEUES into parish_match_alert_queue, due at early_access_visible_at, and
 * deliver_parish_match_alert (called only by the every-minute sweep) is the one
 * send path, re-checking visibility and N-007 at send time. Behaviour:
 * src/test/pglite/parishMatchAlertsWaitForEarlyAccess.pglite.mjs (GREEN 21/21
 * applied 3x; NEW_MIGRATION=skip -> 15 FAIL on the previous fan-out).
 *
 * @mutate supabase/migrations/20260926041132_parish_match_alerts_wait_for_early_access.sql | )  -- N-007 once per job | ) OR true  -- N-007 once per job
 * @mutate supabase/migrations/20260926041132_parish_match_alerts_wait_for_early_access.sql | ) < 10  -- N-007 hourly cap | ) >= 0  -- N-007 hourly cap
 * @mutate supabase/migrations/20260926041132_parish_match_alerts_wait_for_early_access.sql |     INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at) |     PERFORM public.deliver_parish_match_alert(helper_record.helper_id, NEW.id);\n    INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at)
 * @mutate supabase/migrations/20260926041132_parish_match_alerts_wait_for_early_access.sql |   IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN |   IF false THEN
 * @mutate supabase/migrations/20260926041132_parish_match_alerts_wait_for_early_access.sql |      ) >= 10\n  THEN |      ) >= 1000\n  THEN
 * @mutate supabase/migrations/20260926041132_parish_match_alerts_wait_for_early_access.sql |       DELETE FROM public.parish_match_alert_queue WHERE id = r.id;\n      IF public.deliver_parish_match_alert | IF public.deliver_parish_match_alert
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const defining = files.filter((f) => /FUNCTION public\.notify_helpers_on_job_post\(/.test(readFileSync(`${DIR}/${f}`, "utf8")));
const newest = defining.length ? readFileSync(`${DIR}/${defining[defining.length - 1]}`, "utf8") : "";
const defs = effectiveDefs(DIR);
const body = (name: string) => {
  const d = defs.get(name);
  expect(d, `no migration defines public.${name}`).toBeTruthy();
  return blankSqlComments(d!.stmt).replace(/\s+/g, " ");
};

describe("the parish job-match fan-out is bounded (N-007)", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(defining.length).toBeGreaterThan(1);
  });

  it("skips a Helpr already told about this job", () => {
    expect(newest).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM public\.notifications n\s+WHERE n\.user_id = c\.user_id AND n\.job_id = NEW\.id AND n\.type = 'job_match'\s*\) {2}-- N-007 once per job/);
  });

  it("caps job_match notifications per Helpr per hour", () => {
    expect(newest).toMatch(/n\.created_at > now\(\) - interval '1 hour'\s*\) < 10 {2}-- N-007 hourly cap/);
  });
});

describe("the parish fan-out waits for early access (Q225 / V-008)", () => {
  it("the trigger never sends: it only queues, due when the job is in that user's feed", () => {
    const b = body("notify_helpers_on_job_post");
    expect(b).not.toMatch(/INSERT INTO public\.notifications/i);
    expect(b).not.toMatch(/net\.http_post/i);
    expect(b).not.toMatch(/deliver_parish_match_alert/i);
    expect(b).toContain(
      "INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at) VALUES (helper_record.helper_id, NEW.id, public.early_access_visible_at(helper_record.helper_id, NEW.created_at)) ON CONFLICT (user_id, job_id) DO NOTHING;",
    );
  });

  it("deliver refuses a job not yet visible, and re-applies N-007, before any write", () => {
    const b = body("deliver_parish_match_alert");
    const refuse = b.indexOf("IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN RETURN false;");
    expect(refuse).toBeGreaterThan(0);
    const n007 = b.indexOf("n.user_id = p_user_id AND n.job_id = p_job_id AND n.type = 'job_match'");
    expect(n007).toBeGreaterThan(refuse);
    expect(b).toMatch(/n\.created_at > now\(\) - interval '1 hour' \) >= 10 THEN RETURN false;/);
    for (const write of ["INSERT INTO public.notifications", "net.http_post"]) {
      expect(b.indexOf(write), write).toBeGreaterThan(n007);
    }
    expect(b).toContain("SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;");
    expect(b).toContain("INSERT INTO public.notifications (user_id, title, message, type, link, job_id)");
  });

  it("the every-minute sweep sends the parish queue: delete before send, due rows only, never waits", () => {
    const b = body("sweep_saved_search_alert_queue");
    expect(b).toContain(
      "FROM public.parish_match_alert_queue q JOIN public.jobs j ON j.id = q.job_id WHERE public.early_access_visible_at(q.user_id, j.created_at) <= now() ORDER BY q.user_id, q.id LIMIT 1000 FOR UPDATE OF q SKIP LOCKED",
    );
    expect(b).toContain("DELETE FROM public.parish_match_alert_queue WHERE id = r.id; IF public.deliver_parish_match_alert(r.user_id, r.job_id) THEN");
  });

  it("the queue and the send path are server-only", () => {
    const sql = readFileSync(`${DIR}/20260926041132_parish_match_alerts_wait_for_early_access.sql`, "utf8");
    expect(sql).toContain("ALTER TABLE public.parish_match_alert_queue ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.parish_match_alert_queue FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.deliver_parish_match_alert(uuid, uuid) FROM PUBLIC, anon, authenticated;");
  });
});
