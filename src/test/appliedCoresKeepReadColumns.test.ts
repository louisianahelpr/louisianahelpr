/**
 * Q2742 part 2 (HIGH, Builder 3 11-05): the cores keep only the job columns the client asks for on application_jobs
 * and direct_offers, and the client asks for every column a reader of those rows names.
 *
 * Those rows come whole from SECURITY DEFINER functions (get_jobs_for_my_applications, get_my_pending_direct_offers);
 * get_my_activity_cores (20261105104129) keeps only the keys in p_application_job_columns. Fail-closed, both sides:
 *   - every jobs column (types.ts Row) is classified exactly once: APPLICATION_JOB_COLUMNS (kept) or
 *     APPLICATION_CORES_UNREAD_COLUMNS (dropped; postedCoresSkipUnreadColumns proves no reader of the activity rows,
 *     posted or applied, names one). A types.ts regen that adds a column turns this red until it is classified.
 *   - the latest definition (comments blanked) filters BOTH keys by p_application_job_columns, and fetchActivityCores
 *     and the entry prefetch send it.
 *
 * @mutate src/lib/activityCores.ts | ...POSTED_JOB_COLUMNS, ...JOB_PRIVATE_COLUMNS, ...JOB_SERIES_STATE_COLUMNS, "tax_kind", "date_window_end", | ...POSTED_JOB_COLUMNS, ...JOB_SERIES_STATE_COLUMNS, "tax_kind", "date_window_end",
 * @mutate src/lib/activityCores.ts |         p_application_job_columns: [...APPLICATION_JOB_COLUMNS], |         p_application_job_columns: undefined,
 * @mutate supabase/migrations/20261105111750_activity_cores_parts.sql | jsonb_agg(CASE WHEN p_application_job_columns IS NULL THEN to_jsonb(d) ELSE ( | jsonb_agg(CASE WHEN true THEN to_jsonb(d) ELSE (
 * @mutate supabase/migrations/20261105111750_activity_cores_parts.sql | jsonb_agg(CASE WHEN p_application_job_columns IS NULL THEN to_jsonb(j) ELSE ( | jsonb_agg(CASE WHEN true THEN to_jsonb(j) ELSE (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { jobsColumnsFromTypes, latestDefinitions } from "./helpers/jobsPrivacySource";
import { APPLICATION_CORES_UNREAD_COLUMNS, APPLICATION_JOB_COLUMNS } from "@/lib/activityCores";
import { blankComments } from "./helpers/blankNonCode";

describe("the cores keep every applied-job column a reader names, and only those (Q2742 part 2)", () => {
  it("classifies every jobs column exactly once", () => {
    const all = jobsColumnsFromTypes();
    expect(all.length).toBeGreaterThan(120);
    const kept = new Set(APPLICATION_JOB_COLUMNS);
    const dropped = new Set(APPLICATION_CORES_UNREAD_COLUMNS);
    expect(kept.size).toBe(APPLICATION_JOB_COLUMNS.length);
    expect(dropped.size).toBe(APPLICATION_CORES_UNREAD_COLUMNS.length);
    expect([...kept].filter((c) => dropped.has(c))).toEqual([]);
    expect(all.filter((c) => !kept.has(c) && !dropped.has(c))).toEqual([]);
    expect([...kept, ...dropped].filter((c) => !all.includes(c))).toEqual([]);
    for (const c of ["id", "status", "title", "customer_id", "helper_id", "offered_to_helper_id", "direct_offer_status", "series_split_ok", "date_window_end"]) {
      expect(kept.has(c), c).toBe(true);
    }
  });

  it("the latest get_my_activity_cores filters application_jobs and direct_offers by the list", () => {
    const def = latestDefinitions().get("function:get_my_activity_cores");
    // Q2706 (20261105111750) restated it with p_parts; the filter is unchanged.
    expect(def?.file).toBe("20261105111750_activity_cores_parts.sql");
    const code = def!.code;
    for (const [key, src, v] of [["application_jobs", "get_jobs_for_my_applications", "j"], ["direct_offers", "get_my_pending_direct_offers", "d"]]) {
      const at = code.indexOf(`'${key}'`);
      const part = code.slice(at, code.indexOf(`public.${src}()`, at) + src.length + 12);
      expect(part, key).toMatch(new RegExp(`CASE WHEN p_application_job_columns IS NULL THEN to_jsonb\\(${v}\\) ELSE \\(\\s*SELECT coalesce\\(jsonb_object_agg\\(e\\.key, e\\.value\\), '\\{\\}'::jsonb\\) FROM jsonb_each\\(to_jsonb\\(${v}\\)\\) e\\s*WHERE e\\.key = ANY \\(p_application_job_columns\\)\\) END`));
    }
    expect(code).toMatch(/p_application_job_columns text\[\] DEFAULT NULL/);
  });

  it("the client sends the list on both doors", () => {
    expect(blankComments(readFileSync("src/lib/activityCores.ts", "utf8"))).toMatch(/p_application_job_columns: \[\.\.\.APPLICATION_JOB_COLUMNS\]/);
    expect(blankComments(readFileSync("src/boot/activityCoresPrefetch.ts", "utf8"))).toMatch(/p_application_job_columns: CORES_APPLICATION_JOB_COLUMNS/);
  });
});
