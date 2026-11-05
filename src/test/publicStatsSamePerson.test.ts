// @mutate supabase/migrations/20261105171508_public_profile_stats_same_person.sql |       AND NOT public.profile_review_same_person(r.reviewer_id, r.reviewee_id) |       AND true
// @mutate supabase/migrations/20261105171508_public_profile_stats_same_person.sql |       AND NOT public.profile_review_same_person(dr.reviewer_id, dr.reviewee_id) |       AND true
/*
 * Owner 11-05 (L4, pop-up after the share-profile audit): HIDE reviews between a person's own accounts. /u/<handle>
 * (public_profile_by_handle, 20261105165059) left them out of its list, total and stars, but get_public_profile_stats
 * (/user/:id, applicant rows, Hire, every other caller) still counted them, so one person showed two star averages.
 *
 * The class: every review half that get_public_profile_stats counts (job reviews and Declutter reviews) applies the
 * same-person rule in its EFFECTIVE (newest) definition. Behaviour proof: src/test/pglite/publicStatsSamePerson.pglite.mjs
 * (3x; --before red: 5 reviews / 3.40 instead of 3 / 4.67).
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";

const ROOT = join(__dirname, "..", "..");

describe("get_public_profile_stats leaves out reviews between one person's own accounts", () => {
  it("each counted review half carries profile_review_same_person", () => {
    const def = effectiveDefs(join(ROOT, "supabase", "migrations")).get("get_public_profile_stats");
    expect(def).toBeDefined();
    const sql = blankSqlComments(def!.stmt);
    const cte = sql.slice(sql.indexOf("visible_reviews AS ("), sql.indexOf("review_agg AS ("));
    // Inventory: the review halves the stats count (one FROM/JOIN of each review table inside visible_reviews).
    const halves = cte.split(/\bUNION ALL\b/);
    expect(halves.length).toBeGreaterThan(1);
    const want: Record<string, RegExp> = {
      "public.reviews r": /AND NOT public\.profile_review_same_person\(r\.reviewer_id, r\.reviewee_id\)/,
      "public.declutter_reviews dr": /AND NOT public\.profile_review_same_person\(dr\.reviewer_id, dr\.reviewee_id\)/,
    };
    for (const half of halves) {
      const table = Object.keys(want).find((t) => half.includes(t));
      expect(table, `a review half reads an unclassified table:\n${half.slice(0, 200)}`).toBeDefined();
      expect(half, table).toMatch(want[table!]);
    }
  });
});
