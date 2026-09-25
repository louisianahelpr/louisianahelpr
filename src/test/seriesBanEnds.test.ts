/**
 * Q407 (9): a PERMANENT ban ends every recurring series the account posts or
 * works on (future visits cancelled and not charged, the other party told); a
 * temporary ban pauses it (charge-recurring-visits skips it while it lasts).
 *
 * Executable proof: src/test/pglite/seriesBanEnds.pglite.mjs (real jobs trigger
 * chain, OLD STATE RED, chain 3x). The full refund of those visits is
 * src/test/edge/void-cancelled-payments.seriesRefund.test.ts.
 *
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql |     WHEN (NEW.ban_status IN ('banned', 'permanently_banned') |     WHEN (NEW.ban_status IN ('nobody')
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql |             OR (j.recurring_helper_id = p_user AND j.helper_id = p_user)\n            OR EXISTS | OR EXISTS
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql |         AND c.date_needed > v_today | AND c.date_needed > v_today + 365
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql |      WHERE u.uid IS NOT NULL AND u.uid <> p_user; |      WHERE u.uid IS NOT NULL;
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql | REVOKE ALL ON FUNCTION public.end_series_for_banned_account(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.end_series_for_banned_account(uuid) FROM PUBLIC, anon;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const sql = blankSqlComments(readFileSync("supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql", "utf8"));

describe("a permanent ban ends the account's recurring series (Q407 9)", () => {
  it("fires on a PERMANENT ban only (a temporary one pauses in the cron)", () => {
    expect(sql).toMatch(/AFTER UPDATE OF ban_status ON public\.profiles\s+FOR EACH ROW\s+WHEN \(NEW\.ban_status IN \('banned', 'permanently_banned'\)\s+AND OLD\.ban_status IS DISTINCT FROM NEW\.ban_status\)/);
    const cron = readFileSync("supabase/functions/charge-recurring-visits/index.ts", "utf8");
    expect(cron).toContain('["banned", "temp_banned", "permanently_banned"]');
  });

  it("covers every series the account posts, is the standing Helpr on, or holds a date on", () => {
    expect(sql).toMatch(/AND \(j\.customer_id = p_user\s+OR \(j\.recurring_helper_id = p_user AND j\.helper_id = p_user\)\s+OR EXISTS \(SELECT 1 FROM public\.series_visit_holds h/);
    expect(sql).toMatch(/UPDATE public\.jobs SET series_ended_on = v_today WHERE id = v_p\.id;/);
  });

  it("cancels every future unstarted visit, visit one included, with no fee and the refund-in-full reason", () => {
    expect(sql).toMatch(/WHERE \(c\.parent_job_id = v_p\.id OR c\.id = v_p\.id\)\s+AND c\.date_needed > v_today\s+AND c\.status::text IN \('open', 'accepted'\)\s+AND c\.helper_completed_at IS NULL/);
    expect(sql).toContain("cancellation_fee = 0,");
    expect(sql).toContain("late_cancellation = false,");
  });

  it("tells everyone else on the series, never the banned account; clients cannot call it", () => {
    expect(sql).toMatch(/WHERE u\.uid IS NOT NULL AND u\.uid <> p_user;/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.end_series_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("the executable PGlite proof exists", () => {
    const probe = readFileSync("src/test/pglite/seriesBanEnds.pglite.mjs", "utf8");
    expect(probe).toContain("20260925170555_permanent_ban_ends_recurring_series.sql");
    expect(probe).toContain("OLD STATE RED");
  });
});
