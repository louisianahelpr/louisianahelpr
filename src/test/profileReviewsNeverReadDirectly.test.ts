/**
 * Lead 11-05 (owner L4, profile_review_same_person): a member's profile shows reviews ONLY from the server readers,
 * which leave out a review between one person's own accounts. The /user page used to fall back to a direct `reviews`
 * select (list, count and stars) whenever get_public_profile_reviews or get_public_profile_stats failed, and that
 * select cannot apply the rule (it needs phones; server-only). Class: no profile reader on the client selects from the
 * reviews table; a failed server read shows the shared error state ("Couldn't load reviews", Try again), never a list.
 *
 * @mutate src/pages/user/useUserProfileData.ts | Promise.resolve({ data: null, error: null, count: null as number \| null }),\n        Promise.resolve({ data: [] as Array<{ rating: number; job_id: string \| null }>, error: null }), | supabase.from("reviews").select("rating, job_id", { count: "exact" }).eq("reviewee_id", userId!),\n        Promise.resolve({ data: [] as Array<{ rating: number; job_id: string \| null }>, error: null }),
 * @mutate src/pages/user/useUserProfileData.ts | reviewsLoadFailed: !hasPublicReviewRpc && reviewsRpcRes.error?.code !== "42501", | reviewsLoadFailed: false,
 * @mutate src/pages/user/ReviewsSection.tsx | {reviewsLoadFailed ? ( | {false ? (
 * @mutate src/pages/user/UserProfile.tsx | reviewsLoadFailed={reviewsLoadFailed} | reviewsLoadFailed={false}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

// The /user profile's data hook and the two files that draw its reviews.
const PROFILE_READERS = ["src/pages/user/useUserProfileData.ts", "src/pages/user/ReviewsSection.tsx", "src/pages/user/UserProfile.tsx"];
const code = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("a profile's reviews come only from the server readers (lead 11-05)", () => {
  it("inventory: the profile readers exist", () => {
    expect(PROFILE_READERS.filter((f) => code(f).length > 0).length).toBeGreaterThan(2);
  });

  it.each(PROFILE_READERS)("%s never selects from the reviews table", (f) => {
    expect(code(f)).not.toMatch(/\.from\(\s*["']reviews["']\s*\)/);
  });

  it("a failed server list is the error state with Try again, wired end to end", () => {
    expect(code("src/pages/user/useUserProfileData.ts")).toMatch(/reviewsLoadFailed: !hasPublicReviewRpc && reviewsRpcRes\.error\?\.code !== "42501"/);
    const section = code("src/pages/user/ReviewsSection.tsx");
    expect(section).toMatch(/\{reviewsLoadFailed \? \(\s*<ErrorState variant="inline" title="Couldn't load reviews" onRetry=\{onRetryReviews\} \/>/);
    const page = code("src/pages/user/UserProfile.tsx");
    expect(page).toMatch(/reviewsLoadFailed=\{reviewsLoadFailed\}/);
    expect(page).toMatch(/onRetryReviews=\{\(\) => void refetch\(\)\}/);
  });

  it("with no stats row the count is nothing (0, which no display site draws), never an unfiltered number", () => {
    expect(code("src/pages/user/useUserProfileData.ts")).toMatch(/reviewCount: int\(publicStats\?\.review_count\) \?\? 0,/);
  });
});
