/**
 * Q1717 (lh-silent-failure review of Q1582, finding lh-silent-failure@2e6746ea3#2):
 * trg_reports_zz_ledger catches every error, so a real report (a support
 * request included) could exist with no ledger item and nothing noticed.
 * 20261012203308 adds check_user_reports_reach_ledger(), run hourly by cron,
 * which files the real reports from the last day that have no ledger item,
 * no overflow bump the cap explains, and no pending row queued in the last 2
 * hours (narrowed by the lh-silent-failure review of dacc6fccd).
 *
 * Behaviour: src/test/pglite/userReportsReachTheLedgerCheck.pglite.mjs (ALL
 * PASS with the migration applied 3x against prod's own ledger write path;
 * 11 FAIL on main, a planted report with no item goes unnoticed). This guard pins, from the NEWEST definition, what
 * counts as "reached" and that the check runs.
 *
 * @mutate supabase/migrations/20261012203308_user_reports_reach_the_ledger_check.sql |               AND l.last_seen >= r.created_at)\n     -- The flood-cap | AND true)\n     -- The flood-cap
 * @mutate supabase/migrations/20261012203308_user_reports_reach_the_ledger_check.sql |                    AND c.first_seen <= r.created_at)) |                    AND true))
 * @mutate supabase/migrations/20261012203308_user_reports_reach_the_ledger_check.sql |      AND r.reporter_id IS NOT NULL\n |      AND true\n
 * @mutate supabase/migrations/20261012203308_user_reports_reach_the_ledger_check.sql |               AND p.queued_at > now() - interval '2 hours'\n |               AND true\n
 * @mutate supabase/migrations/20261012203308_user_reports_reach_the_ledger_check.sql |      AND public.user_report_is_real(r.reporter_id)\n |      AND false\n
 * @mutate supabase/migrations/20261012203308_user_reports_reach_the_ledger_check.sql |               AND e.context -> 'report_ids' ? r.id::text); |               AND false);
 * @mutate supabase/migrations/20261012203308_user_reports_reach_the_ledger_check.sql |     PERFORM cron.schedule('user-reports-reach-ledger', | PERFORM ('user-reports-reach-ledger',
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = join(__dirname, "..", "..", "supabase", "migrations");
const FIX = "20261012203308_user_reports_reach_the_ledger_check.sql";
const defs = effectiveDefs(MIG);

describe("a real report that never reached the ops ledger is noticed (Q1717)", () => {
  it("reads the real definitions (floor)", () => {
    expect(defs.size).toBeGreaterThan(400);
    // The trigger it backs up still swallows its errors: that is why the check exists.
    expect(blankSqlComments(defs.get("ops_alert_ledger_from_report")?.stmt ?? "")).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it("'reached' means its own item seen after it, an overflow bump the cap explains, or a fresh pending row", () => {
    const b = blankSqlComments(defs.get("check_user_reports_reach_ledger")!.stmt).replace(/\s+/g, " ");
    // A deleted account's report has reporter_id NULL, and user_report_is_real(NULL) is true.
    expect(b).toContain("AND r.reporter_id IS NOT NULL AND public.user_report_is_real(r.reporter_id)");
    expect(b).toContain("AND l.title = public.ops_alert_normalise(public.user_report_title(r.reported_type, r.reason)) AND l.last_seen >= r.created_at)");
    // The overflow bump excuses only a report the cap could have refused (the per-reporter and overall rule of ops_alert_record_user_report).
    expect(b).toContain("AND l.title = v_overflow AND l.last_seen >= r.created_at)");
    expect(b).toContain("count(*) FILTER (WHERE c.sample_ref ->> 'reporter_id' = r.reporter_id::text) >= 5 OR count(*) >= 20");
    expect(b).toContain("AND c.first_seen > r.created_at - interval '1 hour' AND c.first_seen <= r.created_at))");
    // A pending row older than the hourly fold is stuck, not waiting.
    expect(b).toContain("FROM public.ops_alert_pending p");
    expect(b).toContain("AND p.queued_at > now() - interval '2 hours'");
    expect(b).toContain("AND e.context -> 'report_ids' ? r.id::text);");
    expect(b).toMatch(/INSERT INTO public\.error_logs \(severity, message, tags, context\) VALUES \('error',/);
  });

  it("an hourly cron runs it through cron_record_work; only service_role can call it", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, FIX), "utf8"));
    expect(sql).toMatch(/PERFORM cron\.schedule\('user-reports-reach-ledger', '\d+ \* \* \* \*',\s+\$c\$SELECT public\.cron_record_work\('user-reports-reach-ledger'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.check_user_reports_reach_ledger\(\) FROM PUBLIC, anon, authenticated;/);
  });
});
