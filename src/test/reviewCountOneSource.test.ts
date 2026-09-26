// @mutate src/components/admin/useAdminUserSummaries.ts | if (!countsTowardRating(r, now)) continue; | void now;
// @mutate src/lib/reviewStats.ts | r.jobs.status !== "cancelled" | true
// @mutate src/hooks/useProfileTabData.ts | reviewCount: publicRow ? publicRow.review_count ?? 0 : ratings.length, | reviewCount: ratings.length,
// @mutate src/pages/user/ReviewsSection.tsx | count: Math.max(trueReviewCount, reviews.length), stars: 0 | count: reviews.length, stars: 0
// @mutate supabase/functions/helpr-pass-wallet/index.ts | .neq("jobs.status", "cancelled"); | ;
// @mutate supabase/functions/weekly-helper-report/index.ts | .eq("status", "published")\n          .gte("feedback_visible_at", weekAgoISO) | .gte("feedback_visible_at", weekAgoISO)
// @mutate supabase/migrations/20260926034718_helper_tiers_count_public_reviews.sql |       AND j.status <> 'cancelled'\n  ),\n  stats AS ( |   ),\n  stats AS (
/*
 * Q321: a person's review count is ONE number, whoever is looking.
 *
 * The applicant row read Hallie "5.0 (20)" while public.reviews held 26 of her
 * reviews (2026-09-23), and on 2026-09-26 it read 26 while the table held 43.
 * The row was right: it reads get_public_profile_stats, which counts a review
 * only when it is published, past its 14-day anti-retaliation reveal
 * (feedback_visible_at), and on a job that was not cancelled. The WRONG numbers
 * were everywhere else that counted for itself: admin Users (every row,
 * blind-period ones included), admin Helpr Tiers (get_helper_tiers, no
 * predicate at all — tiers were awarded on reviews nobody may see yet), the
 * owner's own profile stats and Work Record (reveal only, no cancelled-job
 * rule), the Wallet pass and the weekly email (service-role reads of
 * everything), and the "All" chip on a profile's review list, which counted
 * the 20 loaded so far.
 *
 * The class: any code that reads REVIEWS RECEIVED (`from("reviews")` filtered
 * on reviewee_id). The inventory is every such file in src/ and
 * supabase/functions/, and each must be classified below (two-way). A file
 * that turns them into a count must take it from the one aggregate
 * (get_public_profile_stats / fetchRatingStats) or apply the one predicate
 * (countsTowardRating, or all three filters on the query itself). SQL side:
 * the effective definitions of both counting RPCs carry all three predicates.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { countsTowardRating } from "@/lib/reviewStats";

const ROOT = join(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

type Kind =
  /** Produces a count/average: must read the aggregate or apply the predicate. */
  | "count"
  /** Renders or slices the rows (no count of its own): must honour the reveal. */
  | "rows"
  /** Everything a member owns, for their own data export: deliberately unfiltered. */
  | "export";

const RECEIVED: Record<string, Kind> = {
  "src/lib/reviewStats.ts": "count",
  "src/pages/user/useUserProfileData.ts": "count",
  "src/hooks/useProfileTabData.ts": "count",
  "src/components/admin/useAdminUserSummaries.ts": "count",
  "src/components/admin/adminusers/useOpenProfile.ts": "count",
  "supabase/functions/helpr-pass-wallet/index.ts": "count",
  "supabase/functions/weekly-helper-report/index.ts": "count",
  "src/pages/profile/HelprWrapped.tsx": "count",
  "src/components/reviewPanel/ReviewList.tsx": "rows",
  "src/components/profile/HelperStreakBadge.tsx": "rows",
  "src/pages/info/legal/DataExportCard.tsx": "export",
};

/** Files that read reviews RECEIVED: a `from("reviews")` chain filtered on reviewee_id. */
function receivedReaders(): string[] {
  const files = walkSource([join(ROOT, "src"), join(ROOT, "supabase", "functions")], [".ts", ".tsx"]).filter(
    (f) => !/\.test\.tsx?$|\/test\//.test(f),
  );
  const out: string[] = [];
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    const chains = src.split('from("reviews")').slice(1).map((c) => c.split(/;|supabase\s*\n?\s*\.from\(/)[0]);
    const receivedHere = chains.some((c) => /reviewee_id\.eq\.|\.(eq|in)\("reviewee_id"/.test(c));
    // DataExportCard reads both sides in one `.or(...)`.
    if (receivedHere || chains.some((c) => /reviewee_id\.eq\./.test(c))) out.push(relative(ROOT, f));
  }
  return out.sort();
}

/** The three predicates, spelled as a PostgREST chain. */
const ALL_THREE_ON_QUERY =
  /\.eq\("status", "published"\)[\s\S]{0,200}?feedback_visible_at[\s\S]{0,200}?\.neq\("jobs\.status", "cancelled"\)|jobs!inner\(status\)[\s\S]{0,300}?\.eq\("status", "published"\)[\s\S]{0,200}?feedback_visible_at[\s\S]{0,200}?\.neq\("jobs\.status", "cancelled"\)/;
const USES_ONE_SOURCE = /get_public_profile_stats|fetchRatingStats\(|countsTowardRating\(/;

describe("Q321: a review count comes from one definition", () => {
  it("every reader of reviews received is classified (two-way)", () => {
    const found = receivedReaders();
    expect(found.length).toBeGreaterThan(8);
    expect(found).toEqual(Object.keys(RECEIVED).sort());
  });

  for (const [file, kind] of Object.entries(RECEIVED)) {
    it(`${file} (${kind})`, () => {
      const src = code(file);
      if (kind === "count") expect(src, file).toMatch(new RegExp(`${USES_ONE_SOURCE.source}|${ALL_THREE_ON_QUERY.source}`));
      if (kind === "rows") expect(src, file).toMatch(/feedback_visible_at/);
    });
  }

  it("the pure predicate is the SQL one", () => {
    const now = Date.parse("2026-09-26T00:00:00Z");
    const base = { status: "published", feedback_visible_at: "2026-09-01T00:00:00Z", jobs: { status: "completed" } };
    expect(countsTowardRating(base, now)).toBe(true);
    expect(countsTowardRating({ ...base, status: "hidden" }, now)).toBe(false);
    expect(countsTowardRating({ ...base, feedback_visible_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(countsTowardRating({ ...base, feedback_visible_at: null }, now)).toBe(false);
    expect(countsTowardRating({ ...base, jobs: { status: "cancelled" } }, now)).toBe(false);
    expect(countsTowardRating({ ...base, jobs: null }, now)).toBe(false);
  });

  it("surfaces that show a count read it from the aggregate", () => {
    expect(code("src/hooks/useProfileTabData.ts")).toContain("reviewCount: publicRow ? publicRow.review_count ?? 0 : ratings.length,");
    expect(code("src/pages/profile/WorkRecord.tsx")).toContain("await fetchRatingStats([userId])");
    expect(code("src/pages/user/ReviewsSection.tsx")).toContain("count: Math.max(trueReviewCount, reviews.length), stars: 0");
    expect(code("src/components/job-card/activityActions/useApplicantsState.ts")).toContain("fetchRatingStats(");
  });

  it("both counting RPCs carry all three predicates in their effective definition", () => {
    const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
    for (const fn of ["get_public_profile_stats", "get_helper_tiers"]) {
      const def = defs.get(fn);
      expect(def, fn).toBeDefined();
      const sql = blankSqlComments(def!.stmt);
      expect(sql, fn).toMatch(/r\.status\s*=\s*'published'/);
      expect(sql, fn).toMatch(/r\.feedback_visible_at\s*<=\s*now\(\)/);
      expect(sql, fn).toMatch(/j\.status\s*<>\s*'cancelled'/);
    }
    // get_helper_tiers aggregates the filtered set, never the raw table.
    const tiers = blankSqlComments(defs.get("get_helper_tiers")!.stmt);
    expect(tiers).toMatch(/LEFT JOIN visible_reviews r ON r\.reviewee_id = p\.user_id/);
    expect(tiers).not.toMatch(/LEFT JOIN public\.reviews/);
  });
});
