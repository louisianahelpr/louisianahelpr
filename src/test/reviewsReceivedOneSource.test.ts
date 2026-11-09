/**
 * Owner UI audit 2026-11-09, F093 (HIGH, data): Wrapped said "5.0 average rating · 1 review received" while the
 * Reviews tab and the Work record said "No reviews yet". Measured on prod (read-only SQL): the one review
 * (12bef9e6, Admin -> Lexi, job 28f8cff5) is between two accounts of one person, which
 * profile_review_same_person() flags and get_public_profile_reviews / get_public_profile_stats hide (Q2759).
 * Wrapped read `reviews` directly and counted it.
 *
 * CLASS: a client read of reviews ABOUT someone (`from("reviews")` + `.eq("reviewee_id", …)`) keeps only the ids
 * the public-reviews RPC shows (publicReviewIds) or reads the stats RPC, unless it is listed below with a reason.
 * The list is EXACT both ways.
 *
 * Inventory: every tracked .ts/.tsx under src/ (tests excluded), comments blanked.
 *
 * @mutate src/components/profile/HelperStreakBadge.tsx |         publicReviewIds(helperId), |         Promise.resolve(new Set<string>()),
 * @mutate src/pages/profile/HelprWrapped.tsx | const shownIdsPromise = publicReviewIds(userId).then( | const shownIdsPromise = Promise.resolve(new Set<string>()).then(
 */
import { describe, expect, it } from "vitest";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const files = walkSource([resolve(ROOT, "src")]).filter(
  (f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f) && !/\/src\/test\//.test(f),
);

/** Files that read reviews by reviewee without the shared filter, and why. */
const ALLOWED: Record<string, string> = {
  "src/components/CompletionPrompts.tsx": "checks whether I already reviewed this person on this job (reviewer_id = me)",
  "src/components/admin/adminusers/useOpenProfile.ts": "admin user detail: staff see every review",
  "src/components/reviewPanel/ReviewList.tsx": "not mounted anywhere (its own comment says route through the RPC before mounting)",
};

function offenders(): string[] {
  const out: string[] = [];
  for (const f of files) {
    const raw = readSource(f);
    if (raw == null) continue;
    const code = blankComments(raw);
    if (!/from\("reviews"\)/.test(code) || !/\.eq\("reviewee_id"/.test(code)) continue;
    if (/\bpublicReviewIds\(/.test(code) || /get_public_profile_reviews/.test(code)) continue;
    out.push(relative(ROOT, f));
  }
  return out.sort();
}

describe("reviews about a member come from one source (F093)", () => {
  it("reads a real inventory", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("every direct reviewee read is filtered by the public-reviews RPC or listed with a reason (exact)", () => {
    expect(offenders()).toEqual(Object.keys(ALLOWED).sort());
  });
});
