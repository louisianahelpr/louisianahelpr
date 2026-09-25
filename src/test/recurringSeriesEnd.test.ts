/**
 * A recurring series can be ENDED, and its schedule holds after hire.
 *
 * Measured on prod 2026-09-25 (rolled-back probe as poster-e2e on a hired seed
 * series): poster_cancel_job refuses a completed parent (not_cancellable) while
 * charge-recurring-visits keeps funding it, so nothing could stop the charges
 * after visit one; and the poster's PATCH of recurrence_weeks 4 -> 52 and of
 * date_needed/start_time landed (rows=1), which the cron turns into bookings the
 * Helpr never agreed to.
 *
 * Executable proof: src/test/pglite/recurringSeriesEnd.pglite.mjs (old state
 * RED, migration applied 3x GREEN). This file pins the shape in the NEWEST
 * definition of each object, so a later migration that drops a clause fails.
 *
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql | OR NEW.date_needed IS DISTINCT FROM OLD.date_needed | OR false
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql |   AND (NEW.recurrence_weeks IS DISTINCT FROM OLD.recurrence_weeks | AND (false
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql |   IF NEW.series_ended_on IS DISTINCT FROM OLD.series_ended_on THEN | IF false THEN
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql |   IF v_uid IS DISTINCT FROM v_job.customer_id | IF false
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql |  OR v_uid IS DISTINCT FROM v_job.helper_id) THEN | ) THEN
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql | REVOKE ALL ON FUNCTION public.end_recurring_series(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.end_recurring_series(uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql |   IF v_ended IS NOT NULL AND NEW.date_needed > v_ended THEN | IF false THEN
 * @mutate supabase/migrations/20260925052841_recurring_series_end.sql |    FOR SHARE; |    ;
 * @mutate supabase/functions/charge-recurring-visits/index.ts | .not("customer_id", "is", null) | .not("id", "is", null)
 * @mutate supabase/functions/charge-recurring-visits/index.ts | recurring_helper_id, helper_id, status, series_ended_on", | recurring_helper_id, helper_id, status",
 * @mutate supabase/functions/charge-recurring-visits/index.ts | Can't make it? Cancel this visit from My Jobs. | Can't make it? Release the date from My Jobs.
 * @mutate src/pages/jobs/AppliedJobCard.tsx | <EndSeriesControl jobId={job.id} | <span data-x={job.id}
 * @mutate src/pages/posts/PostedJobCard.tsx | canEnd={!!job.recurring_helper_id && job.status !== "cancelled"} | canEnd={false}
 */
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** The newest CREATE of `public.<name>(`, body included, comments blanked. */
function newestFunction(name: string): { file: string; body: string } {
  const header = `FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(`${dir}/${files[i]}`, "utf8"));
    const at = sql.lastIndexOf(`CREATE OR REPLACE ${header}`);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag in ${files[i]}`);
    const open = sql.indexOf(tag, at);
    const close = sql.indexOf(tag, open + tag.length);
    return { file: files[i], body: sql.slice(at, close + tag.length) };
  }
  return { file: "", body: "" };
}

/** Every statement in the migrations, comments blanked, in order. */
const allSql = files.map((f) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"))).join("\n");

describe("recurring series: end + schedule lock", () => {
  it("inventory: the objects exist in a migration", () => {
    const names = ["enforce_series_columns_client_lock", "enforce_series_visit_within_end", "end_recurring_series", "enforce_helper_jobs_column_whitelist"];
    const found = names.filter((n) => newestFunction(n).body.length > 0);
    expect(found).toEqual(names);
    expect(found.length).toBeGreaterThan(3);
  });

  it("a hired series parent's schedule columns are client-locked", () => {
    const { body } = newestFunction("enforce_series_columns_client_lock");
    expect(body).toMatch(
      /IF OLD\.recurrence_days IS NOT NULL AND OLD\.parent_job_id IS NULL AND OLD\.helper_id IS NOT NULL\s+AND \(NEW\.recurrence_weeks IS DISTINCT FROM OLD\.recurrence_weeks\s+OR NEW\.date_needed IS DISTINCT FROM OLD\.date_needed\s+OR NEW\.start_time IS DISTINCT FROM OLD\.start_time\s+OR NEW\.recurrence_end_date IS DISTINCT FROM OLD\.recurrence_end_date\) THEN\s+RAISE/,
    );
    expect(body).toMatch(/IF NEW\.series_ended_on IS DISTINCT FROM OLD\.series_ended_on THEN\s+RAISE/);
    expect(body).toMatch(/IF NEW\.series_ended_on IS NOT NULL THEN\s+RAISE/);
    // The trigger fires on every one of those columns (the newest CREATE TRIGGER).
    const triggers = [...allSql.matchAll(/CREATE TRIGGER trg_enforce_series_columns_client_lock\s+BEFORE INSERT OR UPDATE OF ([a-z_, ]+) ON public\.jobs/g)];
    const cols = (triggers.pop()?.[1] ?? "").split(",").map((c) => c.trim());
    for (const c of ["parent_job_id", "recurrence_days", "recurrence_weeks", "date_needed", "start_time", "recurrence_end_date", "series_ended_on"]) {
      expect(cols, `trigger column list is missing ${c}`).toContain(c);
    }
  });

  it("end_recurring_series: parties only, sets the flag the whitelist reads, not callable by anon", () => {
    const { body, file } = newestFunction("end_recurring_series");
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(
      /IF v_uid IS DISTINCT FROM v_job\.customer_id\s+AND \(v_uid IS DISTINCT FROM v_job\.recurring_helper_id OR v_uid IS DISTINCT FROM v_job\.helper_id\) THEN\s+RAISE EXCEPTION 'not_authorized'/,
    );
    expect(body).toMatch(/FOR UPDATE;/);
    expect(body).toContain("set_config('app.series_end_rpc', '1', true)");
    const mig = blankSqlComments(readFileSync(`${dir}/${file}`, "utf8"));
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.end_recurring_series(uuid) FROM PUBLIC, anon;");
    const wl = newestFunction("enforce_helper_jobs_column_whitelist").body;
    expect(wl).toMatch(/IF changed_col = 'series_ended_on'\s+AND current_setting\('app\.series_end_rpc', true\) = '1' THEN\s+CONTINUE;/);
  });

  it("no visit is inserted after the end (DB belt, race-safe)", () => {
    const { body } = newestFunction("enforce_series_visit_within_end");
    expect(body).toMatch(/FOR SHARE;/);
    expect(body).toMatch(/IF v_ended IS NOT NULL AND NEW\.date_needed > v_ended THEN\s+RAISE EXCEPTION 'series_ended/);
    expect(allSql).toMatch(/CREATE TRIGGER trg_series_visit_within_end\s+BEFORE INSERT ON public\.jobs/);
  });

  it("the cron scans only series with a poster, and reads series_ended_on", () => {
    const src = blankComments(readFileSync("supabase/functions/charge-recurring-visits/index.ts", "utf8"));
    const scan = src.slice(src.indexOf('scanAll<SeriesRow>("recurring series"'), src.indexOf("const seriesDefect"));
    expect(scan).toContain('.not("customer_id", "is", null)');
    expect(scan).toMatch(/select\(\s*"[^"]*\bseries_ended_on\b[^"]*"/);
  });

  it("the executable PGlite proof exists and runs this migration", () => {
    const probe = readFileSync("src/test/pglite/recurringSeriesEnd.pglite.mjs", "utf8");
    expect(probe).toContain('read("20260925052841_recurring_series_end.sql")');
    expect(probe).toContain("OLD STATE RED");
  });

  it("both parties have the control: the poster's series strip and the standing Helpr's card", () => {
    const posted = blankComments(readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8"));
    expect(posted).toMatch(/<SeriesStrip[\s\S]*?canEnd=\{!!job\.recurring_helper_id && job\.status !== "cancelled"\}/);
    const strip = blankComments(readFileSync("src/pages/posts/SeriesStrip.tsx", "utf8"));
    expect(strip).toMatch(/canEnd && !seriesEndedOn && next && \([\s\S]*?<EndSeriesControl/);
    const applied = blankComments(readFileSync("src/pages/jobs/AppliedJobCard.tsx", "utf8"));
    expect(applied).toMatch(/job\.recurring_helper_id === userId[\s\S]{0,200}<EndSeriesControl jobId=\{job\.id\}/);
    const control = blankComments(readFileSync("src/components/series/EndSeriesControl.tsx", "utf8"));
    expect(control).toContain('supabase.rpc("end_recurring_series", { p_job_id: jobId })');
  });

  it("no notification promises a per-date release while nothing in the app writes recurring_visit_releases", () => {
    const tracked = execFileSync("git", ["ls-files", "src", "supabase/functions"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/") && f !== "src/integrations/supabase/types.ts");
    expect(tracked.length).toBeGreaterThan(100);
    const code = tracked.map((f) => [f, blankComments(readFileSync(f, "utf8"))] as const);
    const writers = code.filter(([, c]) => /from\(\s*["']recurring_visit_releases["']\s*\)\s*\.\s*(insert|upsert)/.test(c));
    const promises = code.filter(([, c]) => /release (the|this) (date|visit)/i.test(c)).map(([f]) => f);
    if (writers.length === 0) expect(promises).toEqual([]);
  });
});
