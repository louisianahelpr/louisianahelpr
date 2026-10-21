/**
 * Q2265: the quick tags the review sheet offers are EXACTLY the server's list (declutter_review_tags_for, read
 * from the newest effective migration definition), per side, and the seller card's "what buyers said" counts
 * each review once per tag, most-given first.
 *
 * @mutate src/lib/declutter/reviewTags.ts |     ["fair_price", "Fair price"], |     ["fair_price", "Fair price"],\n    ["great_deal", "Great deal"],
 * @mutate src/lib/declutter/reviewTags.ts |     ["paid_fast", "Paid fast"], |     ["paid_quick", "Paid fast"],
 * @mutate src/lib/declutter/reviewTags.ts | for (const t of new Set(tags ?? [])) | for (const t of tags ?? [])
 * @mutate src/lib/declutter/reviewTags.ts |     .slice(0, max) |     .slice(0, max + 1)
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { REVIEW_TAGS, reviewTagLabel, topReviewTags } from "./reviewTags";

const DIR = path.resolve(__dirname, "../../../supabase/migrations");

function serverTags(side: "buyer" | "seller"): string[] {
  const def = effectiveDefs(DIR).get("declutter_review_tags_for");
  expect(def, "declutter_review_tags_for is defined by a migration").toBeTruthy();
  const body = blankSqlComments(def!.stmt);
  const m = body.match(new RegExp(`WHEN\\s+'${side}'\\s+THEN\\s+ARRAY\\[([^\\]]*)\\]`, "i"));
  expect(m, `the ${side} list is in the function`).toBeTruthy();
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe("Q2265 review quick tags", () => {
  it("the sheet's lists equal the server's, per side, in order", () => {
    for (const side of ["buyer", "seller"] as const) {
      const server = serverTags(side);
      expect(server.length).toBeGreaterThan(2);
      expect(REVIEW_TAGS[side].map(([t]) => t)).toEqual(server);
    }
  });

  it("labels every tag; an unknown tag has none", () => {
    expect(reviewTagLabel("as_described")).toBe("As described");
    expect(reviewTagLabel("paid_fast")).toBe("Paid fast");
    expect(reviewTagLabel("great")).toBeNull();
  });

  it("top tags: once per review, most-given first, ties in list order, unknown ignored, at most two", () => {
    const top = topReviewTags([["easy_pickup", "easy_pickup"], ["as_described", "easy_pickup"], ["as_described"], ["friendly", "great"]]);
    expect(top).toEqual([
      { tag: "as_described", label: "As described", count: 2 },
      { tag: "easy_pickup", label: "Easy pickup", count: 2 },
    ]);
    expect(topReviewTags([])).toEqual([]);
  });
});
