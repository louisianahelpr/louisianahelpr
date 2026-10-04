/**
 * Q407 (9): a PERMANENT ban ends every recurring series the account posts or
 * works on (future visits cancelled, the other party told); a temporary ban
 * pauses it (charge-recurring-visits skips it while it lasts).
 * Q407 (10): on a SPLIT series a banned HELPR's dates alone go back to the
 * poster to offer again (their booked visits vacated, still funded); the
 * series and the other Helprs' dates stay. Review LOW-3: a visit later today
 * whose start is still ahead is cancelled too. A series the ban cannot handle
 * never undoes the ban (own subtransaction, logged fatal).
 *
 * Executable proof: src/test/pglite/seriesBanEnds.pglite.mjs (real jobs trigger
 * chain, OLD STATE RED, chain 3x). The full refund of those visits is
 * src/test/edge/void-cancelled-payments.seriesRefund.test.ts.
 *
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |     WHEN (NEW.ban_status IN ('banned', 'permanently_banned') |     WHEN (NEW.ban_status IN ('nobody')
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |            ((j.recurring_helper_id = p_user AND j.helper_id = p_user)\n            OR EXISTS |            ((false)\n            OR EXISTS
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |                 AND ((j.recurring_helper_id = p_user AND j.helper_id = p_user)\n                     OR EXISTS |                 AND ((false)\n                     OR EXISTS
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |       ELSIF v_p.customer_id = p_user OR (v_p.live AND v_p.main_helpr) THEN |       ELSIF v_p.customer_id = p_user OR v_p.main_helpr THEN
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |           WHERE (c.parent_job_id = v_p.id OR c.id = v_p.id)\n             AND c.status::text IN ('open', 'accepted') |           WHERE (c.parent_job_id = v_p.id OR c.id = v_p.id)\n             AND c.date_needed > (now() AT TIME ZONE 'America/Chicago')::date\n             AND c.status::text IN ('open', 'accepted')
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |       IF v_p.customer_id IS DISTINCT FROM p_user AND v_p.live AND v_p.series_split_ok THEN |       IF false THEN
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |     EXCEPTION WHEN OTHERS THEN\n      RAISE WARNING | EXCEPTION WHEN division_by_zero THEN\n      RAISE WARNING
 * @mutate supabase/migrations/20261004192041_helper_only_clears_response_deadline.sql |       IF changed_col IN ('series_ban_cancelled_at', | IF changed_col IN ('nothing',
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql |          WHERE u.uid IS NOT NULL AND u.uid <> p_user |          WHERE u.uid IS NOT NULL
 * @mutate supabase/migrations/20260927012808_permanent_ban_ends_recurring_series.sql | REVOKE ALL ON FUNCTION public.end_series_for_banned_account(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.end_series_for_banned_account(uuid) FROM PUBLIC, anon;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

// The migration holding the NEWEST end_series_for_banned_account (its trigger
// and grants live beside it), never a pinned file (guardsReadTheNewestMigration).
const banDef = effectiveDefs(join(process.cwd(), "supabase/migrations")).get("end_series_for_banned_account");
const sql = blankSqlComments(readFileSync(join(process.cwd(), "supabase/migrations", banDef?.file ?? "missing.sql"), "utf8"));

describe("a permanent ban ends the account's recurring series (Q407 9)", () => {
  it("fires on a PERMANENT ban only (a temporary one pauses in the cron)", () => {
    expect(sql).toMatch(/AFTER UPDATE OF ban_status ON public\.profiles\s+FOR EACH ROW\s+WHEN \(NEW\.ban_status IN \('banned', 'permanently_banned'\)\s+AND OLD\.ban_status IS DISTINCT FROM NEW\.ban_status\)/);
    const cron = readFileSync("supabase/functions/charge-recurring-visits/index.ts", "utf8");
    expect(cron).toContain('["banned", "temp_banned", "permanently_banned"]');
  });

  it("covers every series the account posts, is the standing Helpr on, or holds a date on", () => {
    expect(sql).toMatch(/AND \(j\.customer_id = p_user\s+OR \(j\.series_ended_on IS NULL AND j\.status::text <> 'cancelled'\s+AND \(\(j\.recurring_helper_id = p_user AND j\.helper_id = p_user\)\s+OR EXISTS \(SELECT 1 FROM public\.series_visit_holds h/);
    // Money review HIGH-1: any series with a live visit of theirs, ended or not.
    expect(sql).toMatch(/OR EXISTS \(SELECT 1 FROM public\.jobs c\s+WHERE \(c\.parent_job_id = j\.id OR c\.id = j\.id\)\s+AND c\.helper_id = p_user\s+AND c\.status::text IN \('open', 'accepted'\)/);
    expect(sql).toMatch(/\(\(j\.recurring_helper_id = p_user AND j\.helper_id = p_user\)\s+OR EXISTS \(SELECT 1 FROM public\.series_visit_holds h\s+WHERE h\.parent_job_id = j\.id AND h\.helper_id = p_user AND h\.visit_date >= v_today\)\) AS main_helpr/);
    expect(sql).toContain("ELSIF v_p.customer_id = p_user OR (v_p.live AND v_p.main_helpr) THEN");
    expect(sql).toMatch(/UPDATE public\.jobs SET series_ended_on = v_today\s+WHERE id = v_p\.id AND series_ended_on IS NULL/);
  });

  it("cancels every visit whose start is still ahead (today's included, LOW-3), visit one included, with no fee and the server marker", () => {
    expect(sql).toMatch(/WHERE \(c\.parent_job_id = v_p\.id OR c\.id = v_p\.id\)\s+AND c\.status::text IN \('open', 'accepted'\)\s+AND c\.helper_completed_at IS NULL\s+AND \(\(c\.date_needed \+ COALESCE\(c\.start_time, '00:00'::time\)\) AT TIME ZONE 'America\/Chicago'\) > now\(\)/);
    expect(sql).toContain("series_ban_cancelled_at = now(),");
    expect(sql).toContain("cancellation_fee = 0,");
    expect(sql).toContain("late_cancellation = false,");
  });

  it("tells everyone else on the series, never the banned account; clients cannot call it", () => {
    expect(sql).toMatch(/WHERE u\.uid IS NOT NULL AND u\.uid <> p_user\s+AND \(v_newly OR v_cancelled > 0\);/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.end_series_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("Q407 (10): a split series keeps going; only the banned Helpr's dates go back, as the poster's to offer", () => {
    const head = "IF v_p.customer_id IS DISTINCT FROM p_user AND v_p.live AND v_p.series_split_ok THEN";
    expect(sql).toContain(head);
    const split = sql.slice(sql.indexOf(head), sql.indexOf("ELSIF v_p.customer_id = p_user"));
    expect(split.length).toBeGreaterThan(head.length);
    expect(split).not.toMatch(/series_ended_on/);
    expect(split).not.toMatch(/recurring_visit_releases|series_release_dates/);
    expect(split).toMatch(/DELETE FROM public\.series_visit_holds h\s+WHERE h\.parent_job_id = v_p\.id\s+AND h\.helper_id = p_user/);
    expect(split).toMatch(/SET status = 'open',\s+helper_id = NULL,/);
  });

  it("the ban path's writes pass the helper whitelist when the ladder bans inside the Helpr's own request", () => {
    const wl = blankSqlComments(effectiveDefs(join(process.cwd(), "supabase/migrations")).get("enforce_helper_jobs_column_whitelist")?.stmt ?? "");
    expect(wl).toMatch(/IF changed_col IN \('series_ban_cancelled_at',\s+'dayof_confirm_reminder_sent_at', 'dayof_unanswered_poster_alert_sent_at',\s+'start_reminder_sent_at'\)\s+AND current_setting\('app\.series_end_rpc', true\) = '1' THEN\s+CONTINUE;/);
  });

  it("one series it cannot handle never undoes the ban: own subtransaction, logged fatal", () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING[\s\S]{0,600}INSERT INTO public\.error_logs \(severity, message, tags, context\)\s+VALUES \(CASE WHEN COALESCE\(v_p\.is_seed, false\) THEN 'error' ELSE 'fatal' END,/);
  });

  it("the executable PGlite proof exists", () => {
    const probe = readFileSync("src/test/pglite/seriesBanEnds.pglite.mjs", "utf8");
    expect(probe).toContain("20260927012808_permanent_ban_ends_recurring_series.sql");
    expect(probe).toContain("OLD STATE RED");
  });
});
