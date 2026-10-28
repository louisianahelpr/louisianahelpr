/**
 * Q2429 (owner 2026-10-27): watchers are told when an item's price drops or it becomes Free; one
 * notice per drop, rate-limited, never to the seller. Reads the NEWEST definitions (effectiveDefs,
 * any dollar-quote tag) and pins:
 *   - ONE trigger on declutter_items (every path that lowers a price), only for a live item;
 *   - never the seller, never a blocked pair, a seed listing only to seed watchers;
 *   - one per item per watcher every 3 days ("now free" always), at most 5 a day per watcher;
 *   - each watcher's notice in its own sub-block (a price change never fails on a notice);
 *   - the evening sweep no longer sends its own notice (no double alert).
 * Backend proof, seven planted defects each RED: src/test/pglite/declutterPriceDropAlerts.pglite.mjs.
 *
 * @mutate supabase/migrations/20261028162048_declutter_notice_kinds.sql |        AND wl.user_id IS DISTINCT FROM NEW.seller_id\n |        AND true\n
 * @mutate supabase/migrations/20261028162048_declutter_notice_kinds.sql | a.sent_at > now() - interval '3 days')) | a.sent_at > now() - interval '3 seconds'))
 * @mutate supabase/migrations/20261028162048_declutter_notice_kinds.sql |        AND NOT public.are_users_blocked(wl.user_id, NEW.seller_id)\n |        AND true\n
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n").replace(/\s+/g, " ");

describe("price-drop alerts for watchers (Q2429)", () => {
  const fn = body("declutter_price_drop_alert");

  it("the inventory read something", () => {
    expect(fn.length).toBeGreaterThan(800);
    expect(body("declutter_price_drop_sweep").length).toBeGreaterThan(400);
  });

  it("one trigger on every price cut of a live item", () => {
    expect(all).toContain("CREATE TRIGGER trg_declutter_items_price_drop_alert AFTER UPDATE OF current_price_cents ON public.declutter_items FOR EACH ROW WHEN (NEW.current_price_cents < OLD.current_price_cents) EXECUTE FUNCTION public.declutter_price_drop_alert();");
    expect(fn).toContain("IF NEW.status <> 'live' OR NEW.seller_hidden OR NEW.current_price_cents >= OLD.current_price_cents THEN RETURN NEW;");
  });

  it("never the seller, never a blocked pair, a seed listing only to seed watchers", () => {
    expect(fn).toContain("AND wl.user_id IS DISTINCT FROM NEW.seller_id");
    expect(fn).toContain("AND NOT public.are_users_blocked(wl.user_id, NEW.seller_id)");
    expect(fn).toContain("AND (NOT NEW.is_seed OR COALESCE(wp.is_seed, false))");
  });

  it("rate-limited: one per item per watcher every 3 days (Free always), at most 5 a day per watcher", () => {
    expect(fn).toContain("AND (v_free OR NOT EXISTS (SELECT 1 FROM public.declutter_price_alerts a WHERE a.item_id = NEW.id AND a.user_id = wl.user_id AND a.sent_at > now() - interval '3 days'))");
    expect(fn).toContain("WHERE a.user_id = wl.user_id AND a.sent_at > now() - interval '1 day') < 5");
  });

  it("a price change never fails on a notice, and the sweep sends none of its own", () => {
    expect(fn).toMatch(/BEGIN v_notified := NULL; INSERT INTO public\.notifications .* EXCEPTION WHEN OTHERS THEN RAISE WARNING/);
    expect(body("declutter_price_drop_sweep")).not.toMatch(/INSERT INTO public\.notifications/);
    expect(all).toContain("REVOKE ALL ON TABLE public.declutter_price_alerts FROM PUBLIC, anon, authenticated;");
  });
});
