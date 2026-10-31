/**
 * Free listings: the "still available?" ask (owner's choice, 2026-10-30). The class: a stale free listing sends a
 * neighbor for something already gone, the ask reaches test data, or it ignores a member's notice switch. Read from the
 * NEWEST definitions so a restatement that loses a rule fails here.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterFreeStillAvailable.pglite.mjs
 *
 * @mutate supabase/migrations/20261030232231_declutter_free_still_available.sql |        AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = i.seller_id)\n |
 * @mutate supabase/migrations/20261030232231_declutter_free_still_available.sql |        AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = i.seller_id AND pr.is_seed)\n |
 * @mutate supabase/migrations/20261030232231_declutter_free_still_available.sql |        AND COALESCE((SELECT np.declutter_listings FROM public.notification_preferences np WHERE np.user_id = i.seller_id), true)\n |
 * @mutate supabase/migrations/20261030232231_declutter_free_still_available.sql |        AND i.current_price_cents = 0\n |
 * @mutate supabase/migrations/20261030232231_declutter_free_still_available.sql |   SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE; |   SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { readStillAvailableLink, stillAvailablePath } from "@/lib/declutter/priceNudge";

const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const FILE = "supabase/migrations/20261030232231_declutter_free_still_available.sql";

describe("the free listing still-available ask", () => {
  const sweep = flat(newestFunction("declutter_free_still_available_sweep").body);

  it("who is asked: a live free listing up 14 days, never test data, never against the member's switch", () => {
    for (const part of [
      "WHERE i.status = 'live' AND i.current_price_cents = 0 AND NOT COALESCE(i.is_seed, false)",
      "AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = i.seller_id)",
      "AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = i.seller_id AND pr.is_seed)",
      "AND i.live_at + interval '14 days' <= now()",
      "AND COALESCE((SELECT np.declutter_listings FROM public.notification_preferences np WHERE np.user_id = i.seller_id), true)",
      "AND GREATEST(a.asked_at, a.answered_at) > now() - interval '14 days')",
      "AND NOT public.declutter_member_out(i.seller_id)",
    ]) expect(sweep, part).toContain(part);
  });

  it("claims before telling, and links where the screen reads it", () => {
    expect(sweep).toContain("ON CONFLICT (item_id) DO UPDATE SET asked_at = now()");
    expect(sweep).toContain("'/declutter?tab=selling&still=' || r.id::text");
    const id = "a0000000-0000-4000-8000-000000000001";
    const link = stillAvailablePath(id);
    expect(link).toBe(`/declutter?tab=selling&still=${id}`);
    expect(readStillAvailableLink(new URLSearchParams(link.split("?")[1]))).toBe(id);
    expect(readStillAvailableLink(new URLSearchParams("still=nope"))).toBeNull();
  });

  it("no answer ends nothing: the sweep never writes the listing", () => {
    expect(sweep).not.toMatch(/UPDATE public\.declutter_items/);
  });

  it("only the seller answers, on a live free listing", () => {
    const b = flat(newestFunction("declutter_free_still_available").body);
    expect(b).toContain("WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE");
    expect(b).toContain("IF v_item.status <> 'live' OR v_item.current_price_cents <> 0 THEN");
  });

  it("the sweep is the server's, the marks are nobody's, the cron is daily and watched", () => {
    const sql = flat(readFileSync(FILE, "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_free_still_available_sweep() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.declutter_free_still_asks FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("PERFORM cron.schedule('declutter-free-still-available', '51 15 * * *',");
    expect(sql).toContain("VALUES ('declutter-free-still-available', interval '26 hours',");
  });
});
