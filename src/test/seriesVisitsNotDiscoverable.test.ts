/**
 * A series VISIT (a child row, parent_job_id set) is never a public listing
 * (authz review HIGH, 2026-09-27; owner decision Q407 (5)). A visit a Helpr
 * gave up goes back to the SERIES: status `open`, no helper, still funded. Every
 * surface that shows or announces open jobs to non-parties read public.jobs
 * with no parent_job_id filter, so that vacated visit leaked into browse, the
 * map, ranked search, saved-search and parish alerts and instant matches.
 *
 * Class, built from the migrations themselves: every function or view whose
 * latest definition applies a public-visibility gate (seed_jobs_hidden_publicly,
 * early_access_cutoff or job_announceable_to) must also exclude visits, either
 * by `parent_job_id IS NULL`, an early return on `parent_job_id IS NOT NULL`,
 * or by going through job_announceable_to (which does). And every edge function
 * that reads open jobs for a non-party announcement filters
 * `.is("parent_job_id", null)`.
 *
 * @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |     AND p_job.parent_job_id IS NULL |     AND true
 * @mutate supabase/migrations/20260927015010_recurring_vacated_visit_private.sql |     OR NEW.parent_job_id IS NOT NULL |     OR false
 * @mutate supabase/functions/instant-job-match/index.ts |       .is("parent_job_id", null) |       .limit(1000)
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { latestDefinitions } from "./helpers/jobsPrivacySource";

const GATES = ["seed_jobs_hidden_publicly", "early_access_cutoff", "job_announceable_to"];
/** The gates themselves and the pure location mask are helpers, not surfaces. */
const HELPERS = new Set(["function:seed_jobs_hidden_publicly", "function:early_access_cutoff", "function:mask_job_location"]);

const excludesVisits = (code: string) =>
  /parent_job_id\s+IS\s+NULL/i.test(code) ||
  /parent_job_id\s+IS\s+NOT\s+NULL/i.test(code) ||
  /job_announceable_to\s*\(/i.test(code);

describe("series visits are never a public listing (SQL surfaces)", () => {
  const surfaces = [...latestDefinitions()].filter(
    ([key, d]) => !HELPERS.has(key) && GATES.some((g) => new RegExp(`${g}\\s*\\(`, "i").test(d.code)),
  );

  it("the inventory finds the known surfaces", () => {
    expect(surfaces.length).toBeGreaterThanOrEqual(5);
    const keys = surfaces.map(([k]) => k);
    for (const k of [
      "view:open_jobs_browse",
      "function:get_ranked_open_jobs",
      "function:get_open_jobs_for_map",
      "function:job_announceable_to",
      "function:deliver_saved_search_alert",
    ]) {
      expect(keys).toContain(k);
    }
  });
  for (const [key, d] of surfaces) {
    it(`${key} (${d.file}) excludes series visits`, () => {
      expect(excludesVisits(d.code), `${key} applies a public-visibility gate but never filters parent_job_id`).toBe(true);
    });
  }
  it("job_announceable_to itself excludes visits directly", () => {
    const d = latestDefinitions().get("function:job_announceable_to")!;
    expect(d.code).toMatch(/parent_job_id\s+IS\s+NULL/i);
  });
});

describe("series visits are never a public listing (edge functions)", () => {
  const dir = "supabase/functions";
  const announcers = readdirSync(dir)
    .filter((f) => !f.startsWith("_") && existsSync(`${dir}/${f}/index.ts`))
    .map((f) => ({ f, src: readFileSync(`${dir}/${f}/index.ts`, "utf8") }))
    .filter(
      ({ src }) =>
        /job_announceable_to|early_access/.test(src) && /\.from\("jobs"\)[\s\S]{0,400}?\.eq\("status", "open"\)/.test(src),
    );

  it("the inventory is not empty (instant-job-match is in it)", () => {
    expect(announcers.length).toBeGreaterThanOrEqual(1);
    expect(announcers.map((a) => a.f)).toContain("instant-job-match");
  });
  for (const { f, src } of announcers) {
    it(`${f} filters parent_job_id on its open-jobs read`, () => {
      expect(src.replace(/\/\/.*$/gm, "")).toMatch(/\.is\("parent_job_id", null\)/);
    });
  }
});
