/**
 * Recurring split days, per-date Helprs, pick-up and leaving a series
 * (docs/OPEN.md Q407 (4), (5), (6) and the pick-up addendum, 2026-09-25).
 *
 * Executable proof: src/test/pglite/recurringSplitDays.pglite.mjs (real jobs
 * trigger chain; OLD STATE RED; chain applied 3x; schedule parity with
 * recurringVisitDates on 400 random schedules; the two-claimers race; the
 * 24-hour strike; a vacated funded visit going back to the series). This file
 * pins the shape of the NEWEST definition of each object, so a later migration
 * that drops a clause fails here.
 *
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |    FROM public.jobs j\n   WHERE j.id = p_job_id\n   FOR UPDATE;\n\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found';\n  END IF;\n  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN\n    RAISE EXCEPTION 'not_a_series';\n  END IF;\n  IF v_job.status::text = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN\n    RAISE EXCEPTION 'series_ended';\n  END IF;\n  IF v_uid = v_job.customer_id THEN |    FROM public.jobs j\n   WHERE j.id = p_job_id;\n\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found';\n  END IF;\n  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN\n    RAISE EXCEPTION 'not_a_series';\n  END IF;\n  IF v_job.status::text = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN\n    RAISE EXCEPTION 'series_ended';\n  END IF;\n  IF v_uid = v_job.customer_id THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |     IF v_releaser = v_uid OR (NOT v_offered AND v_releaser IS NULL) THEN |     IF false THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |     ON CONFLICT (parent_job_id, visit_date) DO NOTHING;\n    IF FOUND THEN | ON CONFLICT (parent_job_id, visit_date) DO UPDATE SET helper_id = EXCLUDED.helper_id;\n    IF FOUND THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   IF v_holder IS NULL OR v_holder IS DISTINCT FROM NEW.helper_id THEN |   IF false THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n\n  -- One claim at a time | IF false THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n\n  -- One claim at a time
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |        AND v_d < v_min_fundable THEN |        AND false THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   -- start, for a series visit and a one-time job alike.\n  IF public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN |   -- start, for a series visit and a one-time job alike.\n  IF true THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   WHERE public.is_late_cancellation(\n           true, |   WHERE (true OR public.is_late_cancellation(\n           true,
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   WHERE status = 'open'::job_status AND parent_job_id IS NULL AND customer_id | WHERE status = 'open'::job_status AND customer_id
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql | REVOKE ALL ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   IF NEW.series_split_ok IS DISTINCT FROM OLD.series_split_ok | IF false
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   WHEN (OLD.recurring_helper_id IS DISTINCT FROM NEW.recurring_helper_id) |   WHEN (false)
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |    AND c.helper_id IS NOT NULL\n   AND c.status::text <> 'cancelled'\n   AND c.date_needed >= | AND false\n   AND c.status::text <> 'cancelled'\n   AND c.date_needed >=
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |      AND j.recurring_helper_id IS DISTINCT FROM j.helper_id\n     AND NOT EXISTS | AND false\n     AND NOT EXISTS
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |     IF COALESCE(cardinality(v_released), 0) = 0 AND v_job.customer_id IS NOT NULL THEN | IF false THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |       IF v_holder = v_uid THEN\n        v_already := v_already || v_d; |       IF false THEN\n        v_already := v_already || v_d;
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   WITH me AS (SELECT (SELECT auth.uid()) AS p_uid) |   WITH me AS (SELECT p_parent AS p_uid)
 * @mutate supabase/migrations/20260925160644_hired_job_schedule_lock.sql |                         AND (SELECT auth.uid()) IN (j.customer_id, j.helper_id)) THEN |                         AND true) THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |         PERFORM set_config('app.series_claim_rpc', '1', true);\n        INSERT INTO public.applications | INSERT INTO public.applications
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |         PERFORM set_config('app.series_claim_rpc', '0', true); | NULL;
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   IF current_setting('app.series_claim_rpc', true) = '1' THEN\n    RETURN NEW;\n  END IF;\n\n  -- C1. | -- C1.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const allSql = files.map((f) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"))).join("\n");

function newestFunction(name: string): { file: string; body: string } {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(`${dir}/${files[i]}`, "utf8"));
    const at = sql.lastIndexOf(header);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag in ${files[i]}`);
    const open = sql.indexOf(tag, at);
    const close = sql.indexOf(tag, open + tag.length);
    return { file: files[i], body: sql.slice(at, close + tag.length) };
  }
  return { file: "", body: "" };
}

const RPCS = ["claim_series_dates", "offer_series_dates", "give_up_series_dates", "end_recurring_series"];
const INTERNAL = ["series_release_dates", "series_give_up_strike"];

describe("recurring split days (Q407 4-6)", () => {
  it("inventory: every object exists in a migration", () => {
    const names = [...RPCS, ...INTERNAL, "series_visit_dates", "is_series_party", "series_holds_on_hire", "enforce_series_visit_within_end", "helper_cancel_booking"];
    const found = names.filter((n) => newestFunction(n).body.length > 0);
    expect(found).toEqual(names);
    expect(found.length).toBeGreaterThan(8);
    expect(allSql).toMatch(/ADD COLUMN IF NOT EXISTS series_split_ok boolean NOT NULL DEFAULT false/);
    expect(allSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.series_visit_holds/);
    expect(allSql).toMatch(/PRIMARY KEY \(parent_job_id, visit_date\)/);
  });

  it("every client RPC is SECURITY DEFINER, revoked from anon; the internals are revoked from authenticated", () => {
    for (const fn of RPCS) {
      const { body } = newestFunction(fn);
      expect(body, fn).toMatch(/SECURITY DEFINER/);
      const sig = new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`);
      expect(allSql, fn).toMatch(sig);
    }
    for (const fn of INTERNAL) {
      expect(allSql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    }
  });

  it("claim: one claim at a time per series, first commit wins, the giver cannot take it back, banned refused, unfundable dates refused", () => {
    const { body } = newestFunction("claim_series_dates");
    expect(body).toMatch(/FROM public\.jobs j\s+WHERE j\.id = p_job_id\s+FOR UPDATE;/);
    expect(body).toMatch(/ON CONFLICT \(parent_job_id, visit_date\) DO NOTHING;\s+IF FOUND THEN/);
    expect(body).toMatch(/IF v_releaser = v_uid OR \(NOT v_offered AND v_releaser IS NULL\) THEN/);
    expect(body).toMatch(/IF public\.is_caller_banned\(\) THEN\s+RAISE EXCEPTION 'account_restricted'/);
    expect(body).toMatch(/AND v_d < v_min_fundable THEN/);
  });

  it("a visit is created only for the Helpr holding its date", () => {
    const { body } = newestFunction("enforce_series_visit_within_end");
    expect(body).toMatch(/IF v_holder IS NULL OR v_holder IS DISTINCT FROM NEW\.helper_id THEN\s+RAISE EXCEPTION 'series_date_unheld/);
    expect(body).toMatch(/IF v_ended IS NOT NULL THEN\s+RAISE EXCEPTION 'series_ended/);
  });

  it("the strike for handing back a date applies only within 24 hours, via the existing ladder", () => {
    const strike = newestFunction("series_give_up_strike").body;
    expect(strike).toMatch(/WHERE public\.is_late_cancellation\(\s+true,/);
    expect(strike).toContain("public.apply_job_denial_consequence(");
    const cancel = newestFunction("helper_cancel_booking").body;
    // Every booking alike since Q407 (11); the class guard is helperCancelStrikeWithin24h.test.ts.
    expect(cancel).toMatch(/\n {2}IF public\.is_late_cancellation\(true, EXTRACT\(EPOCH FROM \(v_starts_at - now\(\)\)\) \/ 3600\.0\) THEN/);
    // A cancelled series visit goes back to the series, not to the public.
    expect(cancel).toMatch(/IF v_job\.parent_job_id IS NOT NULL THEN\s+v_released := public\.series_release_dates\(/);
    // LOW-1: nothing released still reaches the poster.
    expect(cancel).toMatch(/IF COALESCE\(cardinality\(v_released\), 0\) = 0 AND v_job\.customer_id IS NOT NULL THEN\s+INSERT INTO public\.notifications/);
  });

  it("LOW-1 / LOW-8: a series running at deploy keeps its booked visits' dates, and one it cannot seed is logged", () => {
    expect(allSql).toMatch(/SELECT c\.parent_job_id, c\.date_needed, c\.helper_id\s+FROM public\.jobs c\s+JOIN public\.jobs p ON p\.id = c\.parent_job_id\s+WHERE c\.parent_job_id IS NOT NULL\s+AND c\.helper_id IS NOT NULL\s+AND c\.status::text <> 'cancelled'/);
    expect(allSql).toMatch(/AND j\.recurring_helper_id IS NOT NULL\s+AND j\.recurring_helper_id IS DISTINCT FROM j\.helper_id\s+AND NOT EXISTS \(SELECT 1 FROM public\.error_logs e/);
  });

  it("LOW-6: a claim of the caller's own date is already_yours, never taken", () => {
    const claim = newestFunction("claim_series_dates").body;
    expect(claim).toMatch(/IF v_holder = v_uid THEN\s+v_already := v_already \|\| v_d;\s+ELSE\s+v_taken := v_taken \|\| v_d;/);
    expect(claim).toMatch(/IF v_child_helper = v_uid THEN\s+v_already := v_already \|\| v_d;/);
    expect(claim).toMatch(/'already_yours', to_jsonb\(v_already\)/);
  });

  it("LOW-2: is_series_party and job_has_crew answer only about the caller", () => {
    const party = newestFunction("is_series_party").body;
    expect(party).toMatch(/CREATE OR REPLACE FUNCTION public\.is_series_party\(p_parent uuid\)/);
    expect(party).toMatch(/WITH me AS \(SELECT \(SELECT auth\.uid\(\)\) AS p_uid\)/);
    expect(allSql).not.toMatch(/is_series_party\(\s*[\w.]+\s*,/);
    const crew = newestFunction("job_has_crew").body;
    expect(crew).toMatch(/IF NOT public\.is_server_context\(\)\s+AND NOT EXISTS \(SELECT 1 FROM public\.jobs j\s+WHERE j\.id = p_job\s+AND \(SELECT auth\.uid\(\)\) IN \(j\.customer_id, j\.helper_id\)\) THEN\s+RETURN false;/);
  });

  it("MEDIUM-1: the takeover's application passes enforce_application_job_state by a flag only the claim sets, around that one INSERT", () => {
    const claim = newestFunction("claim_series_dates").body;
    expect(claim).toMatch(
      /PERFORM set_config\('app\.series_claim_rpc', '1', true\);\s+INSERT INTO public\.applications \(job_id, helper_id, status, message\)\s+VALUES \(v_child_id, v_uid, 'accepted', NULL\)\s+ON CONFLICT \(job_id, helper_id\) DO UPDATE SET status = 'accepted';\s+PERFORM set_config\('app\.series_claim_rpc', '0', true\);/,
    );
    const gate = newestFunction("enforce_application_job_state");
    expect(gate.file).toBe("20260925160645_recurring_split_days.sql");
    const flag = gate.body.indexOf("current_setting('app.series_claim_rpc', true) = '1'");
    expect(flag).toBeGreaterThan(-1);
    // Honoured only AFTER the self-application (C3) and block (C10) refusals.
    expect(gate.body.indexOf("cannot_apply_to_own_job")).toBeLessThan(flag);
    expect(gate.body.indexOf("applicant_blocked")).toBeLessThan(flag);
    expect(gate.body.indexOf("job_not_open")).toBeGreaterThan(flag);
    // Exactly one writer of the flag in the whole tree.
    const setters = files.filter((f) => /set_config\('app\.series_claim_rpc',\s*'1'/.test(blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"))));
    expect(setters).toEqual(["20260925160645_recurring_split_days.sql"]);
    expect((allSql.match(/set_config\('app\.series_claim_rpc',\s*'1'/g) ?? []).length).toBe(1);
  });

  it("the split choice is locked after hire, and hire seeds the holds", () => {
    const lock = newestFunction("enforce_series_columns_client_lock").body;
    expect(lock).toMatch(/IF NEW\.series_split_ok IS DISTINCT FROM OLD\.series_split_ok\s+AND \(OLD\.helper_id IS NOT NULL OR OLD\.recurring_helper_id IS NOT NULL\) THEN\s+RAISE/);
    const triggers = [...allSql.matchAll(/CREATE TRIGGER trg_enforce_series_columns_client_lock\s+BEFORE INSERT OR UPDATE OF ([a-z_, ]+) ON public\.jobs/g)];
    expect((triggers.pop()?.[1] ?? "").split(",").map((c) => c.trim())).toContain("series_split_ok");
    expect(allSql).toMatch(/CREATE TRIGGER trg_series_holds_on_hire\s+AFTER UPDATE ON public\.jobs\s+FOR EACH ROW\s+WHEN \(OLD\.recurring_helper_id IS DISTINCT FROM NEW\.recurring_helper_id\)/);
  });

  it("Helprs see the terms before applying, and a series visit is never listed publicly", () => {
    const views = [...allSql.matchAll(/CREATE OR REPLACE VIEW public\.open_jobs_browse[\s\S]*?\$v(?:iew)?\$/g)];
    const newest = views.pop()?.[0] ?? "";
    for (const c of ["recurrence_days", "recurrence_weeks", "series_split_ok"]) expect(newest).toContain(c);
    expect(newest).toMatch(/WHERE status = 'open'::job_status AND parent_job_id IS NULL/);
  });

  it("the executable PGlite proof exists and runs this chain", () => {
    const probe = readFileSync("src/test/pglite/recurringSplitDays.pglite.mjs", "utf8");
    expect(probe).toContain('readMigration("20260925160645_recurring_split_days.sql")');
    expect(probe).toContain("OLD STATE RED");
    expect(probe).toContain("THE TWO-CLAIMERS RACE");
  });
});
