/**
 * ST-011: the saved-search hourly throttle, and the throttle stamp taken only
 * when a notification is sent. This pins the newest definitions in migrations
 * so a later CREATE OR REPLACE cannot quietly restore an old shape.
 *
 * The match query (and its throttle filter) is the trigger
 * notify_saved_searches_on_new_job; the stamp is taken in
 * deliver_saved_search_alert, the one function that sends a saved-search alert
 * (only from the every-minute saved-search-alert-queue sweep; the trigger
 * queues every match, V-008). Behaviour of the deferred path is proven in
 * PGlite by savedSearchAlertsWaitForEarlyAccess.pglite.mjs.
 *
 * Q1657 (2026-10-15, 20261015065619): the daily match digest is retired (Q1585
 * removed the choice), so the digest exemption from the throttle and the
 * "switched to the digest while waiting" diversion are gone. Neither function
 * may name match_digest again: the queue has no reader left, so a row written
 * there would be a match nobody is ever told about.
 *
 * @mutate supabase/migrations/20261015065619_retire_job_match_digest.sql |         OR s.last_notified_at < now() - interval '1 hour'\n      )\n    GROUP BY |         OR true\n      )\n    GROUP BY
 * @mutate supabase/migrations/20261015065619_retire_job_match_digest.sql |   v_is_urgent := COALESCE(v_job.is_urgent, false);\n\n  -- ST-011: the matched |   v_is_urgent := COALESCE(v_job.is_urgent, false);\n  UPDATE public.saved_searches SET last_notified_at = now() WHERE id = ANY(p_search_ids);\n\n  -- ST-011: the matched
 * @mutate supabase/migrations/20261015065619_retire_job_match_digest.sql |   v_is_urgent := COALESCE(v_job.is_urgent, false);\n\n  -- ST-011: the matched |   v_is_urgent := COALESCE(v_job.is_urgent, false);\n  INSERT INTO public.match_digest_queue (user_id, job_id) VALUES (p_user_id, p_job_id) ON CONFLICT DO NOTHING;\n\n  -- ST-011: the matched
 * @mutate supabase/migrations/20261015065619_retire_job_match_digest.sql |          AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')\n       ORDER BY s.id | ORDER BY s.id
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");

function newestBody(name: string): { file: string; body: string } {
  let hit: { file: string; body: string } | null = null;
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$(\\w*)\\$[\\s\\S]*?\\$\\1\\$;`);
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const m = readFileSync(resolve(DIR, f), "utf8").match(re);
    if (m) hit = { file: f, body: blankSqlComments(m[0]) };
  }
  if (!hit) throw new Error(`no migration defines ${name}`);
  return hit;
}

describe("saved-search throttle (ST-011), with the digest retired (Q1657)", () => {
  const { file, body } = newestBody("notify_saved_searches_on_new_job");
  const deliver = newestBody("deliver_saved_search_alert");

  it("reads real bodies (floor)", () => {
    expect(body.length, file).toBeGreaterThan(1500);
    expect(deliver.body.length, deliver.file).toBeGreaterThan(2000);
  });

  it("the match query applies the hourly throttle to every match, with no digest exemption", () => {
    expect(body, file).toMatch(/s\.last_notified_at IS NULL\s+OR s\.last_notified_at < now\(\) - interval '1 hour'\s*\)\s*GROUP BY/);
    expect(body, file).not.toMatch(/match_digest/);
    expect(body, file).toContain("INSERT INTO public.saved_search_alert_queue");
  });

  it("the trigger never stamps; delivery stamps once, only on the path that notifies", () => {
    expect([...body.matchAll(/UPDATE public\.saved_searches/g)].length, `${file}: the trigger stamps`).toBe(0);
    const d = deliver.body;
    expect(d, `${deliver.file}: a digest diversion is back`).not.toMatch(/match_digest/);
    const stamps = [...d.matchAll(/UPDATE public\.saved_searches/g)].map((m) => m.index!);
    expect(stamps.length, deliver.file).toBe(1);
    const throttleAt = d.search(/s\.last_notified_at < now\(\) - interval '1 hour'/);
    const notifyAt = d.indexOf("INSERT INTO public.notifications");
    expect(throttleAt, `${deliver.file}: no throttle re-check`).toBeGreaterThan(0);
    expect(stamps[0], `${deliver.file}: stamp before the throttle re-check`).toBeGreaterThan(throttleAt);
    expect(stamps[0], `${deliver.file}: stamp after the notification`).toBeLessThan(notifyAt);
  });
});
