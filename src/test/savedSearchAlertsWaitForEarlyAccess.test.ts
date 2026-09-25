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
 *   - the trigger sends only through deliver_saved_search_alert, and only when
 *     early_access_visible_at() <= now(); otherwise it queues;
 *   - deliver_saved_search_alert refuses a job not yet visible to the user;
 *   - the sweep deletes a locked row before sending it (no double send);
 *   - deliver locks the matched saved_searches rows before reading the hourly
 *     throttle, so the trigger and the sweep cannot both send for one search;
 *   - a send that raises is logged and does not roll back the rest of a run;
 *   - the early-access tier ladder has ONE definition, early_access_delay_minutes,
 *     which both the feed cutoff and the alert delay read.
 *
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |       IF v_visible_at <= now() THEN |       IF true THEN
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |   IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN |   IF false THEN
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |     DELETE FROM public.saved_search_alert_queue WHERE id = r.id; |     NULL;
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |        FOR UPDATE OF q SKIP LOCKED |        FOR UPDATE OF q
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |   SELECT now() - make_interval(mins => public.early_access_delay_minutes((SELECT auth.uid()))); |   SELECT now() - make_interval(mins => 20 - COALESCE((SELECT CASE WHEN p.subscription_tier = 'elite' THEN 20 WHEN p.subscription_tier = 'plus' THEN 15 WHEN p.subscription_tier = 'pro' THEN 10 WHEN p.subscription_tier = 'basic' THEN 5 ELSE 0 END FROM public.profiles p WHERE p.user_id = (SELECT auth.uid())), 0));
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |          FOR UPDATE\n    ) x; |     ) x;
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |     EXCEPTION WHEN OTHERS THEN\n      -- One row | --     EXCEPTION WHEN OTHERS THEN\n      -- One row
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

  it("the trigger sends only through deliver_saved_search_alert, and only once the job is visible", () => {
    const { file, body } = get("notify_saved_searches_on_new_job");
    const b = ws(body);
    // No direct send left in the trigger.
    expect(b, file).not.toMatch(/INSERT INTO public\.notifications/i);
    expect(b, file).not.toMatch(/net\.http_post/i);
    expect(b, file).toContain("v_visible_at := public.early_access_visible_at(match_record.user_id, NEW.created_at);");
    const gate = b.indexOf("IF v_visible_at <= now() THEN");
    const send = b.indexOf("PERFORM public.deliver_saved_search_alert(");
    const queue = b.indexOf("INSERT INTO public.saved_search_alert_queue");
    const orElse = b.indexOf("ELSE", send);
    expect(gate, `${file}: no visible_at gate`).toBeGreaterThan(0);
    expect(send, `${file}: the send is not under the gate`).toBeGreaterThan(gate);
    expect(orElse, `${file}: no ELSE after the send`).toBeGreaterThan(send);
    expect(queue, `${file}: a not-yet-visible match is not queued`).toBeGreaterThan(orElse);
    expect([...b.matchAll(/deliver_saved_search_alert\(/g)].length, file).toBe(1);
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

  it("the sweep deletes a locked row before sending it, and sends only visible rows", () => {
    const { file, body } = get("sweep_saved_search_alert_queue");
    const b = ws(body);
    expect(b, file).toContain("FOR UPDATE OF q SKIP LOCKED");
    const visible = b.indexOf("IF v_visible_at > now() THEN");
    const del = b.indexOf("DELETE FROM public.saved_search_alert_queue WHERE id = r.id;");
    const send = b.indexOf("public.deliver_saved_search_alert(");
    expect(b).toContain("v_visible_at := public.early_access_visible_at(r.user_id, r.job_created_at);");
    expect(visible, file).toBeGreaterThan(0);
    expect(del, `${file}: row not deleted`).toBeGreaterThan(visible);
    expect(send, `${file}: sent before the row is deleted`).toBeGreaterThan(del);
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
      /DELETE FROM public\.saved_search_alert_queue WHERE id = r\.id; BEGIN IF public\.deliver_saved_search_alert\([^;]*; END IF; EXCEPTION WHEN OTHERS THEN INSERT INTO public\.error_logs \(severity, message, tags\) VALUES \('error', 'saved-search alert not sent: ' \|\| SQLERRM, jsonb_build_object\('source', 'saved-search-alert-queue' \|\| CASE WHEN r\.job_is_seed THEN '-seed' ELSE '' END/,
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
