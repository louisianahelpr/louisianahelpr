/**
 * BUY-52 (buying audit 10-30 #52): a price drop into a saved search's budget never alerted; the alert ran only when a
 * listing went live. 20261031220326: a live listing whose price goes DOWN goes back on the alert queue (keeping its
 * match rows), and a re-run of deliver_saved_search_item_alerts skips only the searches already told, so the search
 * the drop brought into budget is reached and nobody is told twice. The count half: each drop is written down
 * (declutter_item_price_drops), saved_search_new_counts counts a listing that dropped from over the search's top price
 * since the last look, and Browse opened from the search marks the same ids New (declutter_dropped_into_budget).
 *
 * Backend proof: src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs (3x replay; NEW_MIGRATION=skip RED; 6
 * MUTANTs fail, among them five nightly drops telling a search more than once). Reads the NEWEST function definitions (effectiveDefs) and the trigger as the migration makes it.
 *
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql |   WHEN (NEW.status = 'live' AND OLD.status = 'live' AND NEW.current_price_cents < OLD.current_price_cents) |   WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live')
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql |   INSERT INTO public.saved_search_item_queue (item_id) VALUES (NEW.id)\n  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, retry_after = NULL, queued_at = now();\n  RETURN NULL;\nEND;\n$fn$;\nREVOKE ALL ON FUNCTION public.saved_search_on_item_price_drop() |   RETURN NULL;\nEND;\n$fn$;\nREVOKE ALL ON FUNCTION public.saved_search_on_item_price_drop()
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql | AND m.search_id = s.id AND NOT m.held)) | AND m.search_id = s.id AND m.held))
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql |                 OR i.id IN (SELECT public.declutter_dropped_into_budget(COALESCE(s.last_seen_at, s.created_at), s.max_budget))) |                 OR false)
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql |      AND d.from_cents > p_max_budget * 100 |      AND d.from_cents > 0
 * @mutate supabase/migrations/20261031220326_saved_search_price_drop_alerts.sql |   INSERT INTO public.declutter_item_price_drops (item_id, from_cents, to_cents)\n  VALUES (NEW.id, OLD.current_price_cents, NEW.current_price_cents);\n | 
 * @mutate src/lib/declutter/browseFilters.ts |   if (item.id !== undefined && dropped?.has(item.id)) return true; |   if (item.id !== undefined && dropped?.has(item.id)) return false;
 * @mutate src/lib/declutter/browseFilters.ts |   return Number.isFinite(Date.parse(since)) && maxDollars !== null ? { since, maxDollars } : null; |   return null;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | isNewSince(item, newSince, droppedIn.data) | isNewSince(item, newSince, undefined)
 * @mutate src/lib/declutter/api.ts |     if (error.code === "PGRST202" \|\| error.code === "42883") return new Set(); |     if (error.code === "42883") return new Set();
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const rpc = vi.hoisted(() => ({ answer: { data: null as unknown, error: null as null | { code: string; message: string } }, calls: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => { rpc.calls.push([name, args]); return Promise.resolve(rpc.answer); } },
}));

import { droppedQueryFromParams, isNewSince } from "@/lib/declutter/browseFilters";
import { fetchDroppedIntoBudget } from "@/lib/declutter/api";

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

  it("the count also takes a listing that dropped into the search's top price since the last look", () => {
    expect(body("saved_search_new_counts").length).toBeGreaterThan(1500);
    expect(body("saved_search_new_counts")).toMatch(/AND \(i\.live_at > COALESCE\(s\.last_seen_at, s\.created_at\) OR i\.id IN \(SELECT public\.declutter_dropped_into_budget\(COALESCE\(s\.last_seen_at, s\.created_at\), s\.max_budget\)\)\)/);
    const helper = body("declutter_dropped_into_budget");
    expect(helper).toMatch(/AND d\.from_cents > p_max_budget \* 100/);
    expect(helper).toMatch(/AND i\.current_price_cents <= p_max_budget \* 100/);
    expect(helper).toMatch(/WHERE p_max_budget IS NOT NULL/);
    expect(body("saved_search_on_item_price_drop")).toMatch(/INSERT INTO public\.declutter_item_price_drops \(item_id, from_cents, to_cents\) VALUES \(NEW\.id, OLD\.current_price_cents, NEW\.current_price_cents\)/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.declutter_item_price_drops FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.declutter_dropped_into_budget\(timestamptz, numeric\) FROM PUBLIC, anon/);
  });

  it("Browse marks the same listings New", async () => {
    const p = new URLSearchParams("q=table&max=50&new=2026-10-30T12:00:00.000Z");
    expect(droppedQueryFromParams(p)).toEqual({ since: "2026-10-30T12:00:00.000Z", maxDollars: 50 });
    expect(droppedQueryFromParams(new URLSearchParams("new=2026-10-30T12:00:00.000Z"))).toBeNull();
    expect(droppedQueryFromParams(new URLSearchParams("max=50"))).toBeNull();
    const since = Date.parse("2026-10-30T12:00:00.000Z");
    const old = { id: "t1", live_at: "2026-10-01T00:00:00.000Z" };
    expect(isNewSince(old, since)).toBe(false);
    expect(isNewSince(old, since, new Set(["t1"]))).toBe(true);
    expect(isNewSince(old, null, new Set(["t1"]))).toBe(false);

    rpc.answer = { data: ["t1"], error: null };
    expect([...(await fetchDroppedIntoBudget("2026-10-30T12:00:00.000Z", 50))]).toEqual(["t1"]);
    expect(rpc.calls[rpc.calls.length - 1]).toEqual(["declutter_dropped_into_budget", { p_since: "2026-10-30T12:00:00.000Z", p_max_budget: 50 }]);
    // Before the function is on the server: no marks, never an error.
    rpc.answer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect((await fetchDroppedIntoBudget("2026-10-30T12:00:00.000Z", 50)).size).toBe(0);
    rpc.answer = { data: null, error: { code: "57014", message: "timeout" } };
    await expect(fetchDroppedIntoBudget("2026-10-30T12:00:00.000Z", 50)).rejects.toBeTruthy();

    const view = blankComments(readFileSync(join(REPO, "src/components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(view).toContain("useState(() => droppedQueryFromParams(params))");
    expect(view).toMatch(/enabled: member && droppedAsk !== null/);
    expect((view.match(/isNewSince\(item, newSince, droppedIn\.data\)/g) ?? []).length).toBeGreaterThan(0);
  });
});
