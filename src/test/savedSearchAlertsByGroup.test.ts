/**
 * Saved-search alerts match the Browse GROUPS (owner 2026-10-21, coordinator:
 * "make the saved-search alert trigger group-aware, so saving a group search
 * actually alerts. Otherwise that's a silent failure").
 *
 * The filter sheet stores a group id ("home") as the category filter, and a
 * saved search keeps it in saved_searches.category. Both server readers of
 * that column (the new-job alert trigger and the "N new" count) must match it
 * through public.saved_search_category_matches, and the SQL group table must
 * be the TS one (GROUP_OF in src/lib/jobCategoryGroups.ts), both ways, for
 * every enum value. Behaviour, red/green and 3x replay:
 * src/test/pglite/savedSearchAlertsByGroup.pglite.mjs (MUTATE=1 goes red).
 *
 * @mutate supabase/migrations/20261021072206_saved_search_alerts_by_group.sql |     WHEN p_category::text IN ('yard_work') THEN 'yard' |     WHEN p_category::text IN ('yard_work') THEN 'home'
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |       AND public.saved_search_category_matches(s.category, NEW.category) |       AND (s.category IS NULL OR s.category = NEW.category::text)
 * @mutate supabase/migrations/20261031224850_saved_search_price_drop_counts.sql |            AND public.saved_search_category_matches(s.category, j.category) |            AND (s.category IS NULL OR s.category = j.category::text)
 * @mutate supabase/migrations/20261021072206_saved_search_alerts_by_group.sql |       OR p_search_category = public.job_category_group(p_category) |       OR false
 */
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import { jobCategoryGroupOf } from "@/lib/jobCategoryGroups";

/** category -> group, read from the newest job_category_group body's WHEN ... IN (...) THEN '<group>' arms. */
function sqlGroups(): Map<string, string> {
  const body = newestFunction("job_category_group").body;
  const out = new Map<string, string>();
  for (const m of body.matchAll(/WHEN\s+p_category::text\s+IN\s*\(([^)]*)\)\s+THEN\s+'(\w+)'/gi)) {
    for (const c of m[1].matchAll(/'(\w+)'/g)) {
      if (out.has(c[1])) throw new Error(`${c[1]} is in two SQL groups`);
      out.set(c[1], m[2]);
    }
  }
  return out;
}

describe("saved-search alerts match the Browse groups", () => {
  it("the SQL group table is the TS group table, for every job_category value, both ways", () => {
    const sql = sqlGroups();
    const all = Object.keys(JOB_CATEGORY_LABELS) as JobCategory[];
    expect(all.length).toBeGreaterThan(20);
    for (const c of all) expect(sql.get(c), c).toBe(jobCategoryGroupOf(c));
    for (const c of sql.keys()) expect(all as string[], c).toContain(c);
  });

  it("the match rule: no category, the exact category, or the category's group", () => {
    const body = newestFunction("saved_search_category_matches").body.replace(/\s+/g, " ");
    expect(body).toContain("p_search_category IS NULL");
    expect(body).toContain("p_search_category = p_category::text");
    expect(body).toContain("p_search_category = public.job_category_group(p_category)");
  });

  it("both Jobs readers of saved_searches.category go through that rule, never a bare equality", () => {
    for (const [fn, job] of [["notify_saved_searches_on_new_job", "NEW"], ["saved_search_new_counts", "j"]] as const) {
      const body = newestFunction(fn).body;
      expect(body, fn).toContain(`public.saved_search_category_matches(s.category, ${job}.category)`);
      expect(body, fn).not.toMatch(new RegExp(`s\\.category\\s*=\\s*${job}\\.category`));
    }
  });
});
