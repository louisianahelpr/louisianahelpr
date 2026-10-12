/**
 * GUARD (Q1401, owner-approved lifecycle contract docs/JOB-LIFECYCLE.md row 1:
 * "listing closes at the start"): every surface that lists an open job, the
 * apply gate and the direct-offer accept judge the listing by ONE instant,
 * public.job_offer_cutoff(date_needed, start_time) (the start in Louisiana, or
 * the end of a date-only job's day), never by the day (CURRENT_DATE).
 *
 * THE BUG (live bodies read 2026-10-12): apply and the direct-offer accept
 * refused only `date_needed < CURRENT_DATE`, three browse RPCs listed by the
 * same day test and open_jobs_browse had no time filter for an open job at
 * all, while a hire is refused within 15 minutes of the start (Q1398). A 9 AM
 * job was listed and applyable at 4 PM. Fixed by
 * 20261012185633_listing_closes_at_start.sql. PGlite proof (6 FAIL on main's
 * bodies, ALL PASS with the migration applied 3x):
 * src/test/pglite/listingClosesAtStart.pglite.mjs.
 *
 * THE CLASS, from the migrations' EFFECTIVE definitions, comments blanked: the
 * discovery surfaces are every function that applies the Early Access perk
 * (calls early_access_cutoff(); that is what makes a function a listing
 * surface), plus direct_accept_block_reason and the open_jobs_browse view.
 * Each one carries the cutoff test and none compares date_needed with
 * CURRENT_DATE. The same predicate run on the migrations BEFORE the fix finds
 * all five functions and the view, so it is shown able to fail on the
 * original bug.
 *
 * @mutate supabase/migrations/20261012185633_listing_closes_at_start.sql |      AND public.job_offer_cutoff(v_job.date_needed, v_job.start_time) <= now() THEN\n    RAISE EXCEPTION 'job_date_has_passed' |      AND v_job.date_needed < CURRENT_DATE THEN\n    RAISE EXCEPTION 'job_date_has_passed'
 * @mutate supabase/migrations/20261012185633_listing_closes_at_start.sql | j.customer_id <> (SELECT auth.uid()))\n      AND (j.date_needed IS NULL OR public.job_offer_cutoff(j.date_needed, j.start_time) > now()) | j.customer_id <> (SELECT auth.uid()))\n      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
 * @mutate supabase/migrations/20261012185633_listing_closes_at_start.sql |     AND (p_job.date_needed IS NULL OR public.job_offer_cutoff(p_job.date_needed, p_job.start_time) > now())\n |
 * @mutate supabase/migrations/20261012185633_listing_closes_at_start.sql |     AND (j.date_needed IS NULL OR public.job_offer_cutoff(j.date_needed, j.start_time) > now())\n    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')\n    AND (\n | AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)\n    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')\n    AND (\n
 * @mutate supabase/migrations/20261012185633_listing_closes_at_start.sql |     AND public.job_offer_cutoff(j.date_needed, j.start_time) > now()\n    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')\n    -- BD-002 |     AND j.date_needed >= CURRENT_DATE\n    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')\n    -- BD-002
 * @mutate supabase/migrations/20261012185633_listing_closes_at_start.sql |  AND (date_needed IS NULL OR (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > now()) AND customer_id |  AND customer_id
 * @mutate src/pages/home/applyErrorCopy.ts |   job_date_has_passed: "This job has already started, so it's closed to new applications.", |   job_date_has_passed: "The date for this job has already passed.",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles, type FnDef } from "./helpers/effectiveFunctionDefs";
import { resolveApplyErrorCopy } from "@/pages/home/applyErrorCopy";

const REPO = join(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const FIX = "20261012185633_listing_closes_at_start.sql";

/** Not a listing: computes when a saved search may alert, from the same perk. */
const NOT_A_SURFACE = new Set(["early_access_cutoff", "early_access_visible_at"]);
const DAY_TEST = /date_needed\s*(?:<|>=|<=|>)\s*CURRENT_DATE/i;
const CUTOFF_TEST = /public\.job_offer_cutoff\(\s*(?:v_job|j)\.date_needed\s*,\s*(?:v_job|j)\.start_time\s*\)\s*(?:<=|>)\s*now\(\)/i;
/** The view cannot call job_offer_cutoff (anon has no EXECUTE), so it inlines the same expression. */
const VIEW_CUTOFF =
  /\(date_needed IS NULL OR \(CASE WHEN start_time IS NULL THEN \(\(date_needed \+ 1\)::timestamp without time zone AT TIME ZONE 'America\/Chicago'\) ELSE \(\(date_needed \+ start_time\) AT TIME ZONE 'America\/Chicago'\) END\) > now\(\)\)/;

const code = (d: FnDef) => blankSqlComments(d.stmt);

function surfaces(defs: Map<string, FnDef>): string[] {
  const listing = [...defs.entries()]
    .filter(([n, d]) => !NOT_A_SURFACE.has(n) && /\bearly_access_cutoff\(\)/.test(code(d)))
    .map(([n]) => n);
  return [...listing, "direct_accept_block_reason"].sort();
}

function violations(defs: Map<string, FnDef>): string[] {
  return surfaces(defs)
    .filter((n) => {
      const c = code(defs.get(n)!);
      return DAY_TEST.test(c) || !CUTOFF_TEST.test(c);
    })
    .sort();
}

function newestView(before?: string): { file: string; sql: string } {
  let out = { file: "", sql: "" };
  for (const f of migrationFiles(MIG)) {
    if (before && f >= before) break;
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    const at = sql.lastIndexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
    if (at >= 0) out = { file: f, sql: sql.slice(at, sql.indexOf(";", sql.indexOf(" FROM jobs", at)) + 1) };
  }
  return out;
}

const now = effectiveDefs(MIG);
const before = effectiveDefs(MIG, { before: FIX });

describe("a listing closes at its start time (Q1401)", () => {
  it("knows every discovery surface (exact, two-way)", () => {
    expect(now.size).toBeGreaterThan(400);
    expect(surfaces(now)).toEqual([
      "direct_accept_block_reason",
      "enforce_application_job_state",
      "get_open_jobs_for_map",
      "get_public_open_jobs",
      "get_ranked_open_jobs",
    ]);
  });

  it("CLASS: every surface judges the listing by job_offer_cutoff, never by CURRENT_DATE", () => {
    expect(violations(now)).toEqual([]);
  });

  it("the predicate finds the original bug: before the fix, every surface judged by the day", () => {
    expect(violations(before)).toEqual(surfaces(before));
    expect(surfaces(before).length).toBe(5);
  });

  it("open_jobs_browse filters an open job by the same instant and stays a definer view", () => {
    const v = newestView();
    expect(v.sql).toMatch(VIEW_CUTOFF);
    expect(v.sql).toMatch(/WITH \(security_invoker = false\)/);
    const old = newestView(FIX);
    expect(old.sql, "the view had a start filter before the fix: re-read the proof").not.toMatch(VIEW_CUTOFF);
  });

  it("announcements (job_announceable_to) never announce a listing whose start passed", () => {
    const a = code(now.get("job_announceable_to")!);
    expect(a).toMatch(/AND \(p_job\.date_needed IS NULL OR public\.job_offer_cutoff\(p_job\.date_needed, p_job\.start_time\) > now\(\)\)/);
    expect(code(before.get("job_announceable_to")!)).not.toMatch(/job_offer_cutoff/);
  });

  it("the refusal keeps its code and says the job has started", () => {
    expect(code(now.get("enforce_application_job_state")!)).toContain("RAISE EXCEPTION 'job_date_has_passed'");
    expect(code(now.get("direct_accept_block_reason")!)).toContain("RETURN 'job_date_has_passed';");
    expect(resolveApplyErrorCopy("job_date_has_passed")).toBe("This job has already started, so it's closed to new applications.");
  });
});
