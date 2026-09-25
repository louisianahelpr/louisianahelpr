/**
 * V-008: a saved-search alert never reaches a user before the job is in that
 * user's feed under early access (owner decision 2026-09-25: "Yes, delay the
 * alerts" — paid tiers sooner, free users after 20 minutes).
 *
 * The bug: notify_saved_searches_on_new_job notified at INSERT for every tier,
 * while every browse surface hides a job until created_at <= early_access_cutoff()
 * for the caller. A free account got the title and budget up to 20 minutes
 * before its feed showed the job.
 *
 * Behaviour is proven in PGlite: src/test/pglite/savedSearchAlertsWaitForEarlyAccess.pglite.mjs
 * (RED on the previous definitions with NEW_MIGRATION=skip: free/basic/pro/plus
 * alerted at INSERT). This file pins the shape of the NEWEST definitions so a
 * later CREATE OR REPLACE cannot bring the early send back:
 *   - the trigger never sends: it runs inside the funding write (stripe-webhook
 *     sets payment_status = 'escrow'), so it only QUEUES, even an already
 *     visible match, and takes no saved_searches lock that could deadlock
 *     with the sweep and cancel the funding transaction;
 *   - deliver_saved_search_alert refuses a job not yet visible to the user,
 *     an ownerless job, and a job above the user's credential tier (the
 *     open_jobs_browse gate);
 *   - the sweep deletes a locked row before sending it (no double send),
 *     takes rows in (user_id, id) order, bounds lock waits, and takes the
 *     job row NOWAIT so it never waits on the funding transaction;
 *   - deliver locks the matched saved_searches rows before reading the hourly
 *     throttle, so two sweeps cannot both send for one search;
 *   - a send that raises is logged and does not roll back the rest of a run;
 *   - the early-access tier ladder has ONE definition, early_access_delay_minutes,
 *     which both the feed cutoff and the alert delay read.
 *
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |       INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids) |       PERFORM public.deliver_saved_search_alert(match_record.user_id, NEW.id, match_record.search_name, match_record.matched_search_ids);\n      INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids)
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |   IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN |   IF false THEN
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |      OR v_job.customer_id IS NULL\n |
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |      OR (COALESCE(v_job.credential_tier, 0) <> 0 | OR (false
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |      DELETE FROM public.saved_search_alert_queue WHERE id = r.id;\n      IF public.deliver |      IF public.deliver
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |        FOR UPDATE OF q SKIP LOCKED |        FOR UPDATE OF q
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |      ORDER BY q.user_id, q.id |      ORDER BY q.id
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql | WHERE id = p_job_id FOR SHARE NOWAIT; | WHERE id = p_job_id FOR SHARE;
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |   SELECT now() - make_interval(mins => public.early_access_delay_minutes((SELECT auth.uid()))); |   SELECT now() - make_interval(mins => 20 - COALESCE((SELECT CASE WHEN p.subscription_tier = 'elite' THEN 20 WHEN p.subscription_tier = 'plus' THEN 15 WHEN p.subscription_tier = 'pro' THEN 10 WHEN p.subscription_tier = 'basic' THEN 5 ELSE 0 END FROM public.profiles p WHERE p.user_id = (SELECT auth.uid())), 0));
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |          FOR UPDATE\n    ) x; |     ) x;
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |       WHEN OTHERS THEN\n        -- One row |       WHEN division_by_zero THEN\n        -- One row
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql | REVOKE ALL ON TABLE public.saved_search_alert_queue FROM PUBLIC, anon, authenticated; | GRANT SELECT ON TABLE public.saved_search_alert_queue TO authenticated;
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, sql: blankSqlComments(readFileSync(resolve(DIR, f), "utf8")) }));

/** name -> newest body over every migration, any dollar-quote tag. A later DROP with no redefinition removes it. */
function newestBodies(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const def = /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\s*\([\s\S]*?\bAS\s+\$([A-Za-z_]*)\$([\s\S]*?)\$\2\$/gi;
  const drop = /DROP FUNCTION (?:IF EXISTS )?public\.([a-z0-9_]+)\s*(?:\(|;|\s)/gi;
  for (const { file, sql } of files) {
    const defined = new Set<string>();
    for (const m of sql.matchAll(def)) {
      out.set(m[1].toLowerCase(), { file, body: m[3] });
      defined.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(drop)) if (!defined.has(m[1].toLowerCase())) out.delete(m[1].toLowerCase());
  }
  return out;
}

const bodies = newestBodies();
const get = (name: string) => {
  const b = bodies.get(name);
  expect(b, `no migration defines public.${name}`).toBeTruthy();
  return b!;
};
const ws = (s: string) => s.replace(/\s+/g, " ");

describe("saved-search alerts wait for early access (V-008)", () => {
  it("reads the whole migration history (the scan itself can fail)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(bodies.size).toBeGreaterThan(300);
  });

  it("the trigger never sends and never locks: every non-digest match is queued (it runs inside the funding write)", () => {
    const { file, body } = get("notify_saved_searches_on_new_job");
    const b = ws(body);
    expect(b, file).not.toMatch(/deliver_saved_search_alert/i);
    expect(b, file).not.toMatch(/INSERT INTO public\.notifications/i);
    expect(b, file).not.toMatch(/net\.http_post/i);
    expect(b, file).not.toMatch(/UPDATE public\.saved_searches/i);
    expect(b, file).not.toMatch(/\bFOR (?:UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i);
    expect(b, file).toContain(
      "v_visible_at := public.early_access_visible_at(match_record.user_id, NEW.created_at); INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids) VALUES (match_record.user_id, NEW.id, v_visible_at, match_record.search_name, match_record.matched_search_ids) ON CONFLICT (user_id, job_id) DO NOTHING;",
    );
  });

  it("deliver_saved_search_alert refuses a job not yet in the user's feed, before any write", () => {
    const { file, body } = get("deliver_saved_search_alert");
    const b = ws(body);
    const refuse = b.indexOf("IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN RETURN false;");
    expect(refuse, `${file}: no visibility refusal`).toBeGreaterThan(0);
    for (const write of ["UPDATE public.saved_searches", "INSERT INTO public.notifications", "net.http_post", "INSERT INTO public.match_digest_queue"]) {
      expect(b.indexOf(write), `${file}: ${write} missing`).toBeGreaterThan(0);
      expect(b.indexOf(write), `${file}: ${write} before the visibility refusal`).toBeGreaterThan(refuse);
    }
    // The job must still be open and funded when a deferred alert goes out.
    expect(b).toMatch(/IF v_job\.status <> 'open' OR COALESCE\(v_job\.payment_status, ''\) <> ALL/);
  });

  it("deliver refuses an ownerless job and a job above the recipient's credential tier (open_jobs_browse's gates)", () => {
    const { file, body } = get("deliver_saved_search_alert");
    const b = ws(body);
    const gate = b.slice(b.indexOf("IF v_job.status <> 'open'"), b.indexOf("THEN RETURN false;", b.indexOf("IF v_job.status <> 'open'")));
    expect(gate.length, file).toBeGreaterThan(100);
    expect(gate, file).toContain("OR v_job.customer_id IS NULL");
    // The view: COALESCE(credential_tier, 0) = 0 OR ... OR COALESCE(my_credential_tier(), 0) >= credential_tier,
    // where my_credential_tier() = COALESCE(get_user_credential_tier(auth.uid()), 0).
    expect(gate, file).toContain(
      "OR (COALESCE(v_job.credential_tier, 0) <> 0 AND COALESCE(public.get_user_credential_tier(p_user_id), 0) < v_job.credential_tier)",
    );
    const view = files.filter((f) => /VIEW public\.open_jobs_browse\b[\s\S]*credential_tier/.test(f.sql)).pop();
    expect(view, "open_jobs_browse no longer gates on credential_tier: re-read this guard").toBeTruthy();
    expect(ws(view!.sql)).toContain("COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier");
    const mine = ws(get("my_credential_tier").body);
    expect(mine).toContain("COALESCE(public.get_user_credential_tier(auth.uid()), 0)");
  });

  it("the sweep deletes a locked row before sending it, sends only visible rows, and never waits on the funding write", () => {
    const { file, body } = get("sweep_saved_search_alert_queue");
    const b = ws(body);
    expect(b, file).toContain("PERFORM set_config('lock_timeout', '5s', true);");
    expect(b, file).toContain(
      "WHERE public.early_access_visible_at(q.user_id, j.created_at) <= now() ORDER BY q.user_id, q.id LIMIT 1000 FOR UPDATE OF q SKIP LOCKED",
    );
    const del = b.indexOf("DELETE FROM public.saved_search_alert_queue WHERE id = r.id; IF public.deliver_saved_search_alert(");
    expect(del, `${file}: row not deleted before the send`).toBeGreaterThan(0);
    // A lock it cannot get keeps the row (the block's DELETE rolls back) for the next run.
    expect(b, file).toMatch(/EXCEPTION WHEN lock_not_available THEN NULL; WHEN OTHERS THEN/);
    const d = ws(get("deliver_saved_search_alert").body);
    expect(d).toContain("SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;");
  });

  it("deliver locks the matched searches before reading the throttle (no concurrent double send)", () => {
    const { file, body } = get("deliver_saved_search_alert");
    const b = ws(body);
    expect(b, file).toMatch(
      /SELECT ARRAY_AGG\(x\.id\) INTO v_ids FROM \( SELECT s\.id FROM public\.saved_searches s WHERE s\.id = ANY\(p_search_ids\)[^;]*s\.last_notified_at < now\(\) - interval '1 hour'\) ORDER BY s\.id FOR UPDATE \) x;/,
    );
    expect(b.indexOf("FOR UPDATE ) x;"), `${file}: stamp before the lock`).toBeLessThan(b.indexOf("UPDATE public.saved_searches SET last_notified_at"));
  });

  it("a send that raises is logged, and the rest of the sweep run still sends", () => {
    const { file, body } = get("sweep_saved_search_alert_queue");
    const b = ws(body);
    expect(b, file).toMatch(
      /WHEN OTHERS THEN DELETE FROM public\.saved_search_alert_queue WHERE id = r\.id; INSERT INTO public\.error_logs \(severity, message, tags\) VALUES \('error', 'saved-search alert not sent: ' \|\| SQLERRM, jsonb_build_object\('source', 'saved-search-alert-queue' \|\| CASE WHEN r\.job_is_seed THEN '-seed' ELSE '' END/,
    );
  });

  it("the early-access tier ladder has one definition, read by both the feed and the alert delay", () => {
    const ladder = /subscription_tier\s*=\s*'([a-z_]+)'\s+THEN\s+(\d+)/gi;
    const EARLY = "basic:5,elite:20,plus:15,pro:10";
    const holders = [...bodies]
      .filter(([, b]) => {
        const arms = [...b.body.matchAll(ladder)].map((m) => `${m[1]}:${m[2]}`).sort().join(",");
        return arms === EARLY;
      })
      .map(([n]) => n);
    expect(holders).toEqual(["early_access_delay_minutes"]);
    const cutoff = ws(get("early_access_cutoff").body);
    expect(cutoff).toContain("make_interval(mins => public.early_access_delay_minutes((SELECT auth.uid())))");
    expect(cutoff).not.toMatch(/subscription_tier/);
    const visibleAt = ws(get("early_access_visible_at").body);
    expect(visibleAt).toContain("p_created_at + make_interval(mins => public.early_access_delay_minutes(p_user_id))");
    expect(visibleAt).not.toMatch(/subscription_tier/);
  });

  it("the queue and the new functions are closed to clients, and the sweep is scheduled and watched", () => {
    const owner = files.find((f) => /CREATE TABLE IF NOT EXISTS public\.saved_search_alert_queue\b/.test(f.sql));
    expect(owner, "no migration creates saved_search_alert_queue").toBeTruthy();
    const all = files.map((f) => f.sql).join("\n");
    const later = files.filter((f) => f.file >= owner!.file).map((f) => f.sql).join("\n");
    expect(later).toContain("ALTER TABLE public.saved_search_alert_queue ENABLE ROW LEVEL SECURITY;");
    expect(later).toContain("REVOKE ALL ON TABLE public.saved_search_alert_queue FROM PUBLIC, anon, authenticated;");
    expect(later).not.toMatch(/GRANT [^;]* ON (?:TABLE )?public\.saved_search_alert_queue TO [^;]*\b(?:anon|authenticated)\b/i);
    expect(later).not.toMatch(/CREATE POLICY [^;]* ON public\.saved_search_alert_queue/i);
    for (const sig of [
      "early_access_delay_minutes(uuid)",
      "early_access_visible_at(uuid, timestamp with time zone)",
      "deliver_saved_search_alert(uuid, uuid, text, uuid[])",
      "sweep_saved_search_alert_queue()",
    ]) {
      expect(later, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(all, sig).not.toMatch(new RegExp(`GRANT [^;]*public\\.${sig.split("(")[0]}\\b[^;]*\\b(?:anon|authenticated)\\b`, "i"));
    }
    expect(later).toMatch(/cron\.schedule\('saved-search-alert-queue', '\* \* \* \* \*',\s*'SELECT public\.sweep_saved_search_alert_queue\(\);'\)/);
    expect(later).toMatch(/VALUES \('saved-search-alert-queue', interval '15 minutes'/);
  });
});
