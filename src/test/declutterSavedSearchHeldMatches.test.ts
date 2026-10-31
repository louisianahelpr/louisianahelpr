/**
 * BUY-50 (buying audit 10-30 #50): a Declutter listing matching a saved search inside the search's hour was dropped
 * (the queue row was deleted and the hourly throttle filtered the member out), so a second match never alerted.
 * deliver_saved_search_item_alerts now holds it (saved_search_item_matches, held), puts the listing back on the queue
 * for the end of the hour, reaches only the searches still owed it on that re-run, and says the others held for the
 * member ("…, and 2 more"); a relist starts fresh (saved_search_on_item_live clears its rows).
 *
 * Reads the NEWEST definitions (effectiveDefs replays every migration, any dollar-quote tag).
 * Backend proof: src/test/pglite/declutterSavedSearchHeldMatches.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql |   IF v_retry IS NOT NULL THEN |   IF false THEN
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql | AND (NOT v_rerun OR NOT EXISTS | AND (true OR NOT EXISTS
 * @mutate supabase/migrations/20261031091529_declutter_saved_search_held_matches.sql |   DELETE FROM public.saved_search_item_matches WHERE item_id = NEW.id;\n |
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql | miles_between(COALESCE(s.origin_lat, p.latitude), COALESCE(s.origin_lng, p.longitude), | miles_between(p.latitude, p.longitude,
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql | CASE WHEN v_more > 0 THEN ', and ' \|\| v_more \|\| ' more' ELSE '' END | ''
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("A saved-search match inside the hour is held, not dropped (BUY-50)", () => {
  it("the inventory read something: both functions exist", () => {
    expect(body("deliver_saved_search_item_alerts").length).toBeGreaterThan(2000);
    expect(body("saved_search_on_item_live").length).toBeGreaterThan(100);
  });

  it("inside the hour the match is held and the listing goes back on the queue for the hour's end", () => {
    const fn = body("deliver_saved_search_item_alerts");
    expect(fn).toMatch(/IF v_ids IS NULL THEN INSERT INTO public\.saved_search_item_matches \(item_id, search_id, held, at\) SELECT v_item\.id, x, true, now\(\)/);
    expect(fn).toMatch(/IF v_retry IS NOT NULL THEN INSERT INTO public\.saved_search_item_queue \(item_id, retry_after\) VALUES \(v_item\.id, v_retry\)/);
    // The hourly throttle no longer filters members out of the match: it only splits told-now from held.
    const where = fn.slice(fn.indexOf("FROM public.saved_searches s JOIN public.profiles p"), fn.indexOf("GROUP BY s.user_id"));
    expect(where.length).toBeGreaterThan(500);
    expect(where).not.toMatch(/last_notified_at/);
  });

  it("a re-run reaches only the searches still owed the listing; told rows are marked; the others held are said", () => {
    const fn = body("deliver_saved_search_item_alerts");
    // BUY-52 (20261031220326): a re-run skips only the searches already told; one with no row is reached when it now
    // matches (a price drop into its budget). The held ones are still reached, as BUY-50 made them.
    expect(fn).toMatch(/AND \(NOT v_rerun OR NOT EXISTS \(SELECT 1 FROM public\.saved_search_item_matches m WHERE m\.item_id = v_item\.id AND m\.search_id = s\.id AND NOT m\.held\)\)/);
    expect(fn).toMatch(/SELECT v_item\.id, x, false, now\(\) FROM unnest\(r\.all_ids\) x ON CONFLICT \(item_id, search_id\) DO UPDATE SET held = false/);
    expect(fn).toMatch(/CASE WHEN v_more > 0 THEN ', and ' \|\| v_more \|\| ' more' ELSE '' END/);
    // The same words go to the bell and the email.
    expect(fn.indexOf("'message', v_message")).toBeGreaterThan(fn.indexOf("declutter_notify(r.user_id, 'job_match', v_title, v_message"));
  });

  // Restated from 20261031023451 (BUY-49): the distance still measures from where the search was saved.
  it("keeps BUY-49's origin: distance from where the search was saved, else the profile", () => {
    expect(body("deliver_saved_search_item_alerts")).toMatch(
      /public\.miles_between\(COALESCE\(s\.origin_lat, p\.latitude\), COALESCE\(s\.origin_lng, p\.longitude\), v_item\.area_lat::numeric, v_item\.area_lng::numeric\) <= s\.radius_miles/,
    );
  });

  it("a listing that goes live again starts fresh", () => {
    expect(body("saved_search_on_item_live")).toMatch(/DELETE FROM public\.saved_search_item_matches WHERE item_id = NEW\.id; INSERT INTO public\.saved_search_item_queue/);
  });
});
