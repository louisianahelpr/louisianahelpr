/**
 * Q1088: review one-tap tags have their own column (reviews.tags, migration 20261103224601_review_tags_column), and
 * no screen changes: every reader rebuilds the old "prose, Tag, Tag" text with reviewText / public.review_text.
 *
 *   1. The CHECK reviews_tags_known in the newest migration that states it names exactly the tags the form can write
 *      (src/lib/reviewTags.ts ALL_QUICK_TAGS: HELPER, POSTER and RETIRED lists). A tag the form offers that the CHECK
 *      lacks would make that review fail to post.
 *   2. Both writers (ReviewForm, CompletionPrompts) insert through insertReviewWithTags, never `feedback.trim()`.
 *   3. Every app read of `reviews` that selects `feedback` also selects `tags` and shows reviewText(feedback, tags);
 *      its tags-less twin exists only as withReviewTags' deploy-lag fallback (one per tags read, same file).
 *   4. The two SQL readers that hand feedback to a page (get_public_profile_reviews, public_profile_by_handle) return
 *      public.review_text(feedback, tags) in their newest definitions.
 *
 * @mutate src/components/reviewPanel/types.ts | "Fair price", | "Fair price", "Shows up early",
 * @mutate src/components/reviewPanel/ReviewForm.tsx | insertReviewWithTags(feedback, (fields) => | ((fields) =>
 * @mutate src/hooks/useProfileTabData.ts | .select("rating, feedback, tags, created_at, reviewer_id, job_id, jobs!inner(status)") | .select("rating, feedback, created_at, reviewer_id, job_id, jobs!inner(status)")
 * @mutate src/components/reviewPanel/ReviewList.tsx | feedback: reviewText(r.feedback, r.tags), | feedback: r.feedback,
 * @mutate supabase/migrations/20261103224601_review_tags_column.sql | public.review_text(rv.feedback, rv.tags) AS feedback | rv.feedback
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_QUICK_TAGS } from "@/lib/reviewTags";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase/migrations");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Q1088: review tags live in reviews.tags", () => {
  it("the CHECK names exactly the tags the form can write", () => {
    const stating = migrationFiles(MIG).filter((f) => /ADD\s+CONSTRAINT\s+reviews_tags_known/i.test(blankSqlComments(readFileSync(join(MIG, f), "utf8"))));
    expect(stating.length).toBeGreaterThan(0);
    const sql = blankSqlComments(readFileSync(join(MIG, stating.at(-1)!), "utf8"));
    const check = sql.slice(sql.search(/ADD\s+CONSTRAINT\s+reviews_tags_known/i));
    const arr = check.match(/tags\s*<@\s*ARRAY\[([\s\S]*?)\]::text\[\]/i);
    expect(arr, "tags <@ ARRAY[...] in reviews_tags_known").not.toBeNull();
    const inSql = [...arr![1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    expect(ALL_QUICK_TAGS.length).toBeGreaterThan(10);
    expect([...new Set(inSql)].sort()).toEqual([...ALL_QUICK_TAGS].sort());
    const cap = check.match(/cardinality\(tags\)\s*<=\s*(\d+)/i);
    expect(Number(cap?.[1])).toBeGreaterThanOrEqual(ALL_QUICK_TAGS.length);
  });

  it("both writers insert through insertReviewWithTags", () => {
    for (const f of ["src/components/reviewPanel/ReviewForm.tsx", "src/components/CompletionPrompts.tsx"]) {
      const src = blankComments(read(f));
      expect(src, f).toMatch(/insertReviewWithTags\(feedback,\s*\(fields\)\s*=>/);
      expect(src, f).toMatch(/\.from\("reviews"\)\s*\.insert\(\{[^}]*\.\.\.fields/);
      expect(src, f).not.toMatch(/feedback:\s*feedback\.trim\(\)/);
    }
  });

  it("every app read of reviews.feedback also reads tags and shows reviewText", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
    const readers: string[] = [];
    for (const f of files) {
      const src = blankComments(read(f));
      if (!/\.from\("reviews"\)/.test(src)) continue;
      const selects = [...src.matchAll(/\.from\("reviews"\)\s*\.select\(\s*(["`])([^"`]*)\1/g)].map((m) => m[2]);
      const withFeedback = selects.filter((s) => /(^|[\s,])feedback\s*(,|$)/.test(s));
      if (withFeedback.length === 0) continue;
      readers.push(f);
      const tagged = withFeedback.filter((s) => /(^|[\s,])tags\s*(,|$)/.test(s)).length;
      expect(tagged, `${f}: a feedback read without tags`).toBeGreaterThan(0);
      expect(withFeedback.length - tagged, `${f}: each tags-less read is one withReviewTags fallback`).toBe(tagged);
      expect((src.match(/withReviewTags\(/g) ?? []).length, f).toBe(tagged);
      expect(src, f).toMatch(/reviewText\([^)]*\.feedback,\s*\w+\.tags\)/);
    }
    // ReviewList, useOpenProfile, useProfileTabData, useUserProfileData (measured 11-03).
    expect(readers.length).toBeGreaterThan(3);
  });

  it("the SQL readers return public.review_text(feedback, tags)", () => {
    const defs = effectiveDefs(MIG);
    for (const fn of ["get_public_profile_reviews", "public_profile_by_handle"]) {
      const body = blankSqlComments(defs.get(fn)!.stmt);
      expect(body, fn).toMatch(/public\.review_text\(\s*\w+\.feedback,\s*\w+\.tags\s*\)\s+AS\s+feedback/);
    }
  });
});
