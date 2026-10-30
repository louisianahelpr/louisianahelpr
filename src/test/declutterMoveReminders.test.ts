/**
 * Moving-sale reminders (owner 2026-10-30, via the lead: reminders only, nothing closes). One notice the day before the
 * move-out date and one the day after if listings are still live, linking to Selling. Never test data; a seller who
 * switched Listings notices off gets none.
 *
 * Behaviour: src/test/pglite/declutterMoveReminders.pglite.mjs (NEW_MIGRATION=skip is red).
 *
 * @mutate supabase/migrations/20261030221156_declutter_move_reminders.sql |        AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = s.seller_id)\n |
 * @mutate supabase/migrations/20261030221156_declutter_move_reminders.sql |        AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = s.seller_id AND pr.is_seed)\n |
 * @mutate supabase/migrations/20261030221156_declutter_move_reminders.sql |            AND NOT COALESCE(i.is_seed, false)\n |
 * @mutate supabase/migrations/20261030221156_declutter_move_reminders.sql |        AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = s.seller_id AND np.declutter_listings IS FALSE)\n |
 * @mutate supabase/migrations/20261030221156_declutter_move_reminders.sql | r.live > 0 THEN 'day_after' | r.up > 0 THEN 'day_after'
 * @mutate supabase/migrations/20261030221156_declutter_move_reminders.sql | REVOKE ALL ON FUNCTION public.declutter_move_reminder_sweep() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_move_reminder_sweep() FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const FILE = "supabase/migrations/20261030221156_declutter_move_reminders.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("moving-sale reminders", () => {
  it("reads the newest definition (this migration)", () => {
    expect(newestFunction("declutter_move_reminder_sweep").file).toContain("20261030221156");
  });

  it("who is told: never test data, never a seller who switched Listings off", () => {
    const b = flat(newestFunction("declutter_move_reminder_sweep").body);
    for (const part of [
      "AND NOT COALESCE(i.is_seed, false)",
      "AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = s.seller_id)",
      "AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = s.seller_id AND pr.is_seed)",
      "AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = s.seller_id AND np.declutter_listings IS FALSE)",
      "AND public.feature_enabled_for_user('declutter_moving_out', s.seller_id)",
      "AND NOT public.declutter_member_out(s.seller_id)",
    ]) expect(b, part).toContain(part);
  });

  it("when: the day before with anything up, up to 3 days after with something live, once each, closing nothing", () => {
    const b = flat(newestFunction("declutter_move_reminder_sweep").body);
    expect(b).toContain("WHEN r.move_out_on = v_today + 1 AND r.up > 0 THEN 'day_before'");
    expect(b).toContain("WHEN r.move_out_on BETWEEN v_today - 3 AND v_today - 1 AND r.live > 0 THEN 'day_after'");
    expect(b).toContain("ON CONFLICT (seller_id, move_out_on, kind) DO NOTHING RETURNING seller_id INTO v_claimed; CONTINUE WHEN v_claimed IS NULL;");
    expect(b).toContain("'Your move is tomorrow'");
    expect(b).toContain("'/declutter?tab=selling'");
    expect(b).not.toMatch(/UPDATE public\.declutter_items|DELETE FROM/);
  });

  it("service role only, definer with a pinned search_path, a daily cron registered with the dead-cron monitor", () => {
    const sql = flat(readFileSync(FILE, "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_move_reminder_sweep() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.declutter_move_reminder_sweep() TO service_role;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.declutter_move_reminders FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET lock_timeout TO '1s'");
    expect(sql).toContain("PERFORM cron.schedule('declutter-move-reminders', '33 15 * * *',");
    expect(sql).toContain("VALUES ('declutter-move-reminders', interval '26 hours',");
  });
});
