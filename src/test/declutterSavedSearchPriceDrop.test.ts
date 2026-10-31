/**
 * BUY-52 (buying audit 10-30 #52): a price drop into a saved search's budget never alerted; the alert ran only when a
 * listing went live. 20261031220326: a live listing whose price goes DOWN goes back on the alert queue (keeping its
 * match rows), and a re-run of deliver_saved_search_item_alerts skips only the searches already told, so the search
 * the drop brought into budget is reached and nobody is told twice.
 *
 * Backend proof: src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs (3x replay; NEW_MIGRATION=skip RED; 3
 * MUTANTs fail). Reads the NEWEST function definitions (effectiveDefs) and the trigger as the migration makes it.
 *
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql |   WHEN (NEW.status = 'live' AND OLD.status = 'live' AND NEW.current_price_cents < OLD.current_price_cents) |   WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live')
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql |   INSERT INTO public.saved_search_item_queue (item_id) VALUES (NEW.id)\n  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, retry_after = NULL, queued_at = now();\n  RETURN NULL;\nEND;\n$fn$;\nREVOKE ALL ON FUNCTION public.saved_search_on_item_price_drop() |   RETURN NULL;\nEND;\n$fn$;\nREVOKE ALL ON FUNCTION public.saved_search_on_item_price_drop()
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql | AND m.search_id = s.id AND NOT m.held)) | AND m.search_id = s.id AND m.held))
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const migration = blankSqlComments(readFileSync(join(MIG, "20261031220326_saved_search_price_drop_alerts.sql"), "utf8")).replace(/\s+/g, " ");

describe("a price drop into a saved search's budget alerts it (BUY-52)", () => {
  it("the inventory read something", () => {
    expect(body("deliver_saved_search_item_alerts").length).toBeGreaterThan(2000);
    expect(body("saved_search_on_item_price_drop").length).toBeGreaterThan(100);
  });

  it("a live listing whose price goes down is queued again, its match rows kept", () => {
    expect(migration).toMatch(/CREATE TRIGGER saved_search_on_item_price_drop AFTER UPDATE OF current_price_cents ON public\.declutter_items FOR EACH ROW WHEN \(NEW\.status = 'live' AND OLD\.status = 'live' AND NEW\.current_price_cents < OLD\.current_price_cents\) EXECUTE FUNCTION public\.saved_search_on_item_price_drop\(\)/);
    const fn = body("saved_search_on_item_price_drop");
    expect(fn).toMatch(/INSERT INTO public\.saved_search_item_queue \(item_id\) VALUES \(NEW\.id\)/);
    expect(fn).not.toMatch(/DELETE FROM public\.saved_search_item_matches/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.saved_search_on_item_price_drop\(\) FROM PUBLIC, anon, authenticated/);
  });

  it("a re-run skips only the searches already told", () => {
    expect(body("deliver_saved_search_item_alerts")).toMatch(/AND \(NOT v_rerun OR NOT EXISTS \(SELECT 1 FROM public\.saved_search_item_matches m WHERE m\.item_id = v_item\.id AND m\.search_id = s\.id AND NOT m\.held\)\)/);
  });
});
