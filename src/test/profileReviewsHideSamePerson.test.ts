/**
 * Owner 11-05 (L4): a review between two accounts of one person (the same phone, profile_review_same_person) is hidden
 * everywhere a member's reviews are read, never deleted. /u/<handle> (public_profile_by_handle) and the stars + count
 * (get_public_profile_stats) were fixed first; the /user/:id review LIST (get_public_profile_reviews) still showed them.
 * Class: every reader of a member's review list, total or stars carries the same-person rule in its NEWEST definition.
 * Behaviour proof: src/test/pglite/profileReviewListSamePerson.pglite.mjs (3x; --before red on R1, R2, R3).
 *
 * @mutate supabase/migrations/20261105184337_profile_review_list_same_person.sql |       AND NOT public.profile_review_same_person(r.reviewer_id, r.reviewee_id) |       AND true
 */
import { describe, expect, it } from "vitest";
import { newestFunction } from "@/test/helpers/parityReaders";

const READERS = ["get_public_profile_reviews", "get_public_profile_stats", "public_profile_by_handle"] as const;

describe("reviews between one person's own accounts never show (owner 11-05, L4)", () => {
  it("inventory: the three review readers all have a live definition", () => {
    const found = READERS.filter((n) => newestFunction(n).body.length > 0);
    expect(found.length).toBeGreaterThan(2);
  });

  it.each(READERS)("%s's newest definition leaves out same-person reviews", (name) => {
    const def = newestFunction(name);
    expect(def.body, def.file).toMatch(/NOT\s+public\.profile_review_same_person\s*\(/);
  });
});
