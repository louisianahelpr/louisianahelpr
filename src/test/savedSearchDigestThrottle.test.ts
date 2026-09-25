/**
 * ST-011: the saved-search hourly throttle must not bind digest matches, and
 * the throttle stamp is taken only when a notification is sent. Behaviour is
 * proven in PGlite (src/test/pglite/savedSearchDigestThrottle.pglite.mjs and,
 * for the deferred path, savedSearchAlertsWaitForEarlyAccess.pglite.mjs); this
 * pins the newest definitions in migrations so a later CREATE OR REPLACE cannot
 * quietly restore the old shape.
 *
 * The match query (and its throttle filter) is the trigger
 * notify_saved_searches_on_new_job; the stamp is taken in
 * deliver_saved_search_alert, the one function that sends a saved-search alert
 * (only from the every-minute saved-search-alert-queue sweep; the trigger
 * queues every non-digest match, V-008).
 *
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |         OR (COALESCE(np.match_digest_mode, false) AND NOT v_is_urgent) -- ST-011 digest unthrottled |         OR false -- ST-011 digest unthrottled
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |   -- Switched to the daily digest while this alert waited: batch it there. |   UPDATE public.saved_searches SET last_notified_at = now() WHERE id = ANY(p_search_ids);
 * @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql | AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour') | AND true
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");

function newestBody(name: string): { file: string; body: string } {
  let hit: { file: string; body: string } | null = null;
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`);
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const m = readFileSync(resolve(DIR, f), "utf8").match(re);
    if (m) hit = { file: f, body: blankSqlComments(m[0]) };
  }
  if (!hit) throw new Error(`no migration defines ${name}`);
  return hit;
}

describe("saved-search throttle spares the digest (ST-011)", () => {
  const { file, body } = newestBody("notify_saved_searches_on_new_job");
  const deliver = newestBody("deliver_saved_search_alert");

  it("the match query lets a non-urgent digest match past the hourly throttle", () => {
    expect(body, file).toMatch(/OR \(COALESCE\(np\.match_digest_mode, false\) AND NOT v_is_urgent\)/);
  });

  it("the trigger never stamps; delivery stamps once, only on the path that notifies", () => {
    expect([...body.matchAll(/UPDATE public\.saved_searches/g)].length, `${file}: the trigger stamps`).toBe(0);
    const d = deliver.body;
    const stamps = [...d.matchAll(/UPDATE public\.saved_searches/g)].map((m) => m.index!);
    expect(stamps.length, deliver.file).toBe(1);
    // After the digest diversion and the throttle re-check, before the notification.
    const digestAt = d.indexOf("INSERT INTO public.match_digest_queue");
    const throttleAt = d.search(/s\.last_notified_at < now\(\) - interval '1 hour'/);
    const notifyAt = d.indexOf("INSERT INTO public.notifications");
    expect(digestAt, `${deliver.file}: no digest branch`).toBeGreaterThan(0);
    expect(throttleAt, `${deliver.file}: no throttle re-check`).toBeGreaterThan(0);
    expect(stamps[0], `${deliver.file}: stamp before the digest branch`).toBeGreaterThan(digestAt);
    expect(stamps[0], `${deliver.file}: stamp before the throttle re-check`).toBeGreaterThan(throttleAt);
    expect(stamps[0], `${deliver.file}: stamp after the notification`).toBeLessThan(notifyAt);
  });
});
