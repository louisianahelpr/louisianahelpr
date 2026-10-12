/**
 * Q417 (e): a vacated series visit nobody has claimed is cancelled when its day
 * passes and refunded less the card fee; nothing told the poster beforehand.
 * 20261012195747 adds sweep_unfilled_series_visit_reminders(), scheduled daily,
 * which tells the poster once, the day before.
 *
 * Behaviour: src/test/pglite/unfilledSeriesVisitReminder.pglite.mjs (ALL PASS
 * with the migration applied 3x; 4 FAIL on main). This guard pins, from the
 * NEWEST definition, which visits count and the once-only rule, and that a
 * cron runs it.
 *
 * @mutate supabase/migrations/20261012195747_unfilled_series_visit_reminder.sql |        AND c.date_needed = v_tomorrow |        AND c.date_needed >= v_tomorrow
 * @mutate supabase/migrations/20261012195747_unfilled_series_visit_reminder.sql |        AND c.helper_id IS NULL\n |        AND true\n
 * @mutate supabase/migrations/20261012195747_unfilled_series_visit_reminder.sql |        AND NOT EXISTS (SELECT 1 FROM public.notifications n | AND true AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE false AND
 * @mutate supabase/migrations/20261012195747_unfilled_series_visit_reminder.sql |        AND public.job_payment_is_funded(c.payment_status::text)\n |        AND true\n
 * @mutate supabase/migrations/20261012195747_unfilled_series_visit_reminder.sql |                           AND (p.series_ended_on IS NOT NULL OR p.status::text = 'cancelled')) |                           AND false)
 * @mutate supabase/migrations/20261012195747_unfilled_series_visit_reminder.sql |     PERFORM cron.schedule('unfilled-series-visit-reminders', | PERFORM cron.unschedule('unfilled-series-visit-reminders'); PERFORM ('unfilled-series-visit-reminders',
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = join(__dirname, "..", "..", "supabase", "migrations");
const FIX = "20261012195747_unfilled_series_visit_reminder.sql";
const defs = effectiveDefs(MIG);

describe("a poster hears about an unfilled series visit the day before (Q417 e)", () => {
  it("reads the real definitions (floor)", () => {
    expect(defs.size).toBeGreaterThan(400);
  });

  it("only open, unfilled, funded series visits dated tomorrow, each told once", () => {
    const d = defs.get("sweep_unfilled_series_visit_reminders");
    expect(d, "the sweep is gone").toBeDefined();
    const b = blankSqlComments(d!.stmt).replace(/\s+/g, " ");
    expect(b).toContain("v_tomorrow date := (now() AT TIME ZONE 'America/Chicago')::date + 1;");
    for (const piece of [
      "c.parent_job_id IS NOT NULL",
      "c.status::text = 'open'",
      "c.helper_id IS NULL",
      "c.customer_id IS NOT NULL",
      "c.date_needed = v_tomorrow",
      "public.job_payment_is_funded(c.payment_status::text)",
      "AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.job_id = c.id AND n.title = 'A series visit is still unfilled')",
      // An ended or cancelled series takes no offers (offer_series_dates raises series_ended).
      "AND NOT EXISTS (SELECT 1 FROM public.jobs p WHERE p.id = c.parent_job_id AND (p.series_ended_on IS NOT NULL OR p.status::text = 'cancelled'))",
    ]) {
      expect(b, piece).toContain(piece);
    }
  });

  it("a daily cron runs it through cron_record_work, and only service_role can call it", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, FIX), "utf8"));
    expect(sql).toMatch(/PERFORM cron\.schedule\('unfilled-series-visit-reminders', '\d+ \d+ \* \* \*',\s+\$c\$SELECT public\.cron_record_work\('unfilled-series-visit-reminders'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sweep_unfilled_series_visit_reminders\(\) FROM PUBLIC, anon, authenticated;/);
  });
});
