/**
 * Q1156 (owner, 2026-10-03: "Yes: self-heal + page"): open_jobs_browse is put
 * back to a definer view within 5 minutes of a flip, and the flip pages.
 *
 * On 2026-10-02 21:25Z a Supabase dashboard session ran the Security Advisor's
 * one-click fix (`ALTER VIEW public.open_jobs_browse SET (security_invoker =
 * true)`) and guest + signed-in browse failed 42501 for hours (restored by
 * 20261003020841). Why the view must stay definer: openJobsBrowseStaysDefiner.
 *
 * Behaviour is proven in PGlite (src/test/pglite/openJobsBrowseHeals.pglite.mjs,
 * with prod's default EXECUTE grants in the fixture: all PASS with the migration
 * applied 3x, FAIL without it). lh-authz-rls review 2026-10-03: approve with
 * fixes (boolean cast, severity fatal, search_path), applied. This guard pins
 * the pieces that make it work on prod: the heal and the page in the function,
 * client EXECUTE revoked, the 5-minute pg_cron job, and the liveness row that
 * pages when the job itself stops.
 */
// @mutate supabase/migrations/20261003144349_open_jobs_browse_heals_itself.sql |   ALTER VIEW public.open_jobs_browse SET (security_invoker = false);\n  REVOKE | \n  REVOKE
// @mutate supabase/migrations/20261003144349_open_jobs_browse_heals_itself.sql | jsonb_build_object('source', 'open-jobs-browse-healed', 'area', 'security') | jsonb_build_object('area', 'security')
// @mutate supabase/migrations/20261003144349_open_jobs_browse_heals_itself.sql | REVOKE ALL ON FUNCTION public.check_browse_view_definer() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.check_browse_view_definer() FROM PUBLIC;
// @mutate supabase/migrations/20261003144349_open_jobs_browse_heals_itself.sql | PERFORM cron.schedule('open-jobs-browse-heal', '*/5 * * * *', | PERFORM cron.schedule('open-jobs-browse-heal', '0 3 * * *',
// @mutate supabase/migrations/20261003144349_open_jobs_browse_heals_itself.sql |        AND o.option_value::boolean |        AND o.option_value IN ('true', 'on')
// @mutate supabase/migrations/20261003144349_open_jobs_browse_heals_itself.sql | SET search_path = pg_catalog, public, pg_temp | SET search_path = public
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const MIG_DIR = join(ROOT, "supabase", "migrations");
const FILE = "20261003144349_open_jobs_browse_heals_itself.sql";
const sql = blankComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const fnBody = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.check_browse_view_definer()"), sql.indexOf("$fn$;"));

describe("open_jobs_browse heals itself back to a definer view (Q1156)", () => {
  it("the function heals any true spelling of security_invoker and restates SELECT-only grants", () => {
    expect(fnBody).toMatch(/SECURITY DEFINER/);
    // pg_options_to_table + ::boolean: every spelling Postgres accepts (t, ye, tru ... are stored as typed).
    expect(fnBody).toContain("pg_catalog.pg_options_to_table(v_was) AS o(option_name, option_value)");
    expect(fnBody).toContain("o.option_name = 'security_invoker'");
    expect(fnBody).toContain("AND o.option_value::boolean");
    // pg_temp last and the catalog qualified: a caller's temp table cannot stand in for pg_class.
    expect(fnBody).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(fnBody).toContain("FROM pg_catalog.pg_class c");
    expect(fnBody).toContain("ALTER VIEW public.open_jobs_browse SET (security_invoker = false);");
    expect(fnBody).toContain("REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;");
    expect(fnBody).toContain("GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;");
  });

  it("every heal pages through error_logs (Slack + ledger), tagged with its own source", () => {
    expect(fnBody).toMatch(/INSERT INTO public\.error_logs \(severity, message, tags, context\)/);
    expect(fnBody).toContain("jsonb_build_object('source', 'open-jobs-browse-healed', 'area', 'security')");
    // fatal: clients may INSERT error_logs at 'error' and would share (and mute) the Slack throttle; they cannot write 'fatal'.
    expect(fnBody).toMatch(/'fatal',\s*\n\s*format\(/);
  });

  it("clients cannot call it", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.check_browse_view_definer() FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.check_browse_view_definer\(\) TO (anon|authenticated|PUBLIC)/i);
  });

  it("pg_cron runs it every 5 minutes, and a stopped job pages (cron_work_expectations)", () => {
    expect(sql).toContain("PERFORM cron.schedule('open-jobs-browse-heal', '*/5 * * * *',");
    expect(sql).toContain("public.cron_record_work('open-jobs-browse-heal', to_jsonb(public.check_browse_view_definer()))");
    expect(sql).toMatch(/INSERT INTO public\.cron_work_expectations[\s\S]*'open-jobs-browse-heal', interval '30 minutes'/);
  });

  it("no later migration unschedules the heal or makes the view an invoker view", () => {
    const later = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f > FILE);
    // Floor: 3 later migrations on 2026-10-03, and migrations are only ever added.
    expect(later.length).toBeGreaterThan(0);
    for (const f of later) {
      const text = blankComments(readFileSync(join(MIG_DIR, f), "utf8"));
      expect(text, f).not.toMatch(/cron\.unschedule\(\s*'open-jobs-browse-heal'/);
      expect(text, f).not.toMatch(/open_jobs_browse[\s\S]{0,80}security_invoker\s*=\s*(true|on|yes|1)\b/i);
    }
  });
});
