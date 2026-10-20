/**
 * BOARD 179, first slice: the reviews tab is "Reviews about you" (sentence
 * case, and it says whose reviews they are), named once in TAB_TITLES and read
 * by the tab's own header, so the browser tab and the screen title agree.
 *
 * Not yet: the side chips (All · As a Helpr · As a poster · As a seller · As a
 * shop) need each review's side, which useProfileReviews does not select.
 *
 * @mutate src/components/profile/ReviewsTab.tsx |         title={TAB_TITLES.reviews} |         title="My Reviews"
 * @mutate src/pages/profile/types.ts |   reviews: "Reviews about you", |   reviews: "My Reviews",
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { TAB_TITLES } from "@/pages/profile/types";

describe("reviews about you, board 179 (first slice)", () => {
  it("is named Reviews about you, once", () => {
    expect(TAB_TITLES.reviews).toBe("Reviews about you");
    const tab = blankComments(fs.readFileSync(path.resolve(__dirname, "../components/profile/ReviewsTab.tsx"), "utf8"));
    expect(tab).toContain("title={TAB_TITLES.reviews}");
    expect(tab).not.toContain("My Reviews");
  });
});
