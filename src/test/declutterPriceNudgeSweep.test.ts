/**
 * CMP-5 (lead decision 2026-10-30 05:00Z), the server half: once per listing per 14 days, a priced listing live 14
 * days unsold with price drops off gets "<item> hasn't sold yet. Drop the price?" linking to Selling's Manage with
 * about 15% off filled in. Never a free item, drops on, an is_seed listing, a test account's or a seed profile's
 * listing (owner rule: test stuff never shows).
 *
 * Behaviour: src/test/pglite/declutterPriceNudgeSweep.pglite.mjs (26 PASS applied 3x; NEW_MIGRATION=skip RED; a
 * planted body without the test-account skip 4 FAIL).
 *
 * @mutate supabase/migrations/20261030141656_declutter_price_nudge_sweep.sql |        AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = i.seller_id)\n |
 * @mutate supabase/migrations/20261030141656_declutter_price_nudge_sweep.sql |        AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = i.seller_id AND pr.is_seed)\n |
 * @mutate supabase/migrations/20261030141656_declutter_price_nudge_sweep.sql |        AND NOT COALESCE(i.is_seed, false)\n |
 * @mutate supabase/migrations/20261030141656_declutter_price_nudge_sweep.sql |        AND NOT (i.sale_mode = 'offers' AND i.drop_pct > 0 AND NOT COALESCE(p.drops_stopped, false))\n |
 * @mutate supabase/migrations/20261030141656_declutter_price_nudge_sweep.sql |                         WHERE n.item_id = i.id AND n.notified_at > now() - interval '14 days') |                         WHERE n.item_id = i.id)
 * @mutate supabase/migrations/20261030141656_declutter_price_nudge_sweep.sql | REVOKE ALL ON FUNCTION public.declutter_price_nudge_sweep() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_price_nudge_sweep() FROM PUBLIC;
 * @mutate src/lib/declutter/priceNudge.ts |   return `/declutter?tab=selling&manage=${encodeURIComponent(itemId)}&drop=1`; |   return `/declutter?tab=selling&manage=${encodeURIComponent(itemId)}`;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";
import { priceNudgePath, readPriceNudgeLink, PRICE_NUDGE_DAYS } from "@/lib/declutter/priceNudge";

const FILE = "supabase/migrations/20261030141656_declutter_price_nudge_sweep.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("CMP-5: the price nudge sweep", () => {
  it("reads the newest definitions (this migration)", () => {
    for (const n of ["declutter_price_nudge_sweep", "declutter_price_nudge_cents"]) expect(newestFunction(n).file, n).toContain("20261030141656");
  });

  it("who is told: live 14+ days, priced, drops off, no sale or accepted offer, never test data", () => {
    const b = flat(newestFunction("declutter_price_nudge_sweep").body);
    for (const part of [
      "WHERE i.status = 'live' AND i.current_price_cents > 0 AND NOT COALESCE(i.is_seed, false)",
      "AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = i.seller_id)",
      "AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = i.seller_id AND pr.is_seed)",
      "AND i.live_at + interval '14 days' <= now()",
      "AND NOT (i.sale_mode = 'offers' AND i.drop_pct > 0 AND NOT COALESCE(p.drops_stopped, false))",
      "AND NOT EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'accepted')",
      "WHERE c.item_id = i.id AND c.status IN ('in_cart', 'paid'))",
      "WHERE n.item_id = i.id AND n.notified_at > now() - interval '14 days')",
      "AND NOT public.declutter_member_out(i.seller_id)",
    ]) expect(b, part).toContain(part);
    expect(PRICE_NUDGE_DAYS).toBe(14);
  });

  it("claims before telling (once per 14 days even with two runs), and links where the screen reads it", () => {
    const b = flat(newestFunction("declutter_price_nudge_sweep").body);
    expect(b).toContain("ON CONFLICT (item_id) DO UPDATE SET notified_at = now() WHERE n.notified_at <= now() - interval '14 days' RETURNING n.item_id INTO v_claimed; CONTINUE WHEN v_claimed IS NULL;");
    expect(b).toContain("format('%s hasn''t sold yet. Drop the price?', r.title)");
    expect(b).toContain("'/declutter?tab=selling&manage=' || r.id::text || '&drop=1'");
    const link = priceNudgePath("a0000000-0000-4000-8000-000000000001");
    expect(link).toBe("/declutter?tab=selling&manage=a0000000-0000-4000-8000-000000000001&drop=1");
    expect(readPriceNudgeLink(new URLSearchParams(link.split("?")[1]))).toBe("a0000000-0000-4000-8000-000000000001");
  });

  it("service role only, definer with a pinned search_path, a daily cron registered with the dead-cron monitor", () => {
    const sql = flat(readFileSync(FILE, "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_price_nudge_sweep() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.declutter_price_nudge_sweep() TO service_role;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.declutter_price_nudges FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET lock_timeout TO '1s'");
    expect(sql).toContain("PERFORM cron.schedule('declutter-price-nudge', '43 15 * * *',");
    expect(sql).toContain("VALUES ('declutter-price-nudge', interval '26 hours',");
  });
});
