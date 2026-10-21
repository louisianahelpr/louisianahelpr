/**
 * BOARD 179, first slice: the reviews tab is "Reviews about you" (sentence
 * case, and it says whose reviews they are), named once in TAB_TITLES and read
 * by the tab's own header, so the browser tab and the screen title agree.
 *
 * Second slice (Builder 1i, 2026-10-21): ONE list of job and Declutter
 * reviews, each side named, with a chip per side that has any. Shops reviews
 * are not built (Shops on hold), so there is no shop chip.
 *
 * @mutate src/components/profile/ReviewsTab.tsx |         title={TAB_TITLES.reviews} |         title="My Reviews"
 * @mutate src/pages/profile/types.ts |   reviews: "Reviews about you", |   reviews: "My Reviews",
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx | r.reviewer_side === "buyer" ? "seller" : r.reviewer_side === "seller" ? "buyer" | r.reviewer_side === "buyer" ? "buyer" : r.reviewer_side === "seller" ? "seller"
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx | .filter((c) => c.count > 0), | ,
 * @mutate src/hooks/useProfileTabData.ts | j.customer_id === id ? "poster" as const : "helpr" as const | "helpr" as const
 * @mutate src/components/profile/ReviewsTab.tsx |   const loading = jobsLoading \|\| declutterQuery.isLoading; |   const loading = jobsLoading;
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { TAB_TITLES } from "@/pages/profile/types";
import { aboutYouChips, aboutYouRows, whoLine } from "@/components/profile/reviewsTab/reviewsAboutYou";

describe("reviews about you, board 179 (first slice)", () => {
  it("is named Reviews about you, once", () => {
    expect(TAB_TITLES.reviews).toBe("Reviews about you");
    const tab = blankComments(fs.readFileSync(path.resolve(__dirname, "../components/profile/ReviewsTab.tsx"), "utf8"));
    expect(tab).toContain("title={TAB_TITLES.reviews}");
    expect(tab).not.toContain("My Reviews");
  });
});

const job = (over: Partial<Parameters<typeof aboutYouRows>[0][number]>) => ({
  rating: 5, feedback: "Great", created_at: "2026-10-20T12:00:00Z", reviewerName: "Kyle M.", jobTitle: "Mow the lawn", side: "helpr" as const, ...over,
});
const dec = (over: Partial<Parameters<typeof aboutYouRows>[1][number]>) => ({
  id: "d1", reviewer_side: "buyer", stars: 5, comment: "As described", created_at: "2026-10-21T12:00:00Z", tags: ["easy_pickup", "nope"], ...over,
});

describe("reviews about you, board 179 (second slice: one list, every side)", () => {
  it("merges job and Declutter reviews newest first, each side in words, the Declutter reviewer never named", () => {
    const rows = aboutYouRows(
      [job({}), job({ reviewerName: "Jolie T.", side: "poster", created_at: "2026-10-24T12:00:00Z" })],
      [dec({}), dec({ id: "d2", reviewer_side: "seller", created_at: "2026-10-19T12:00:00Z", tags: null })],
    );
    expect(rows.map(whoLine)).toEqual([
      "Jolie T. · worked for you",
      "A buyer · bought from you",
      "Kyle M. · hired you",
      "A seller · sold to you",
    ]);
    expect(rows.map((r) => r.side)).toEqual(["poster", "seller", "helpr", "buyer"]);
    // Unknown tags are never shown raw.
    expect(rows[1].tags).toEqual(["Easy pickup"]);
  });

  it("offers All plus only the sides that have reviews, with real counts", () => {
    const rows = aboutYouRows([job({}), job({ created_at: "2026-10-01T00:00:00Z" })], [dec({})]);
    expect(aboutYouChips(rows).map((c) => `${c.label} · ${c.count}`)).toEqual(["All · 3", "Jobs you did · 2", "Things you sold · 1"]);
  });

  it("a job whose side could not be read counts in All only, and names no relation", () => {
    const rows = aboutYouRows([job({ side: null })], []);
    expect(whoLine(rows[0])).toBe("Kyle M.");
    expect(aboutYouChips(rows).map((c) => c.value)).toEqual(["all"]);
  });

  it("the tab waits for both reads (one loading gate) and the hook marks the poster side from customer_id", () => {
    const tab = fs.readFileSync(path.resolve(__dirname, "../components/profile/ReviewsTab.tsx"), "utf8");
    expect(tab).toContain("const loading = jobsLoading || declutterQuery.isLoading;");
    const hook = fs.readFileSync(path.resolve(__dirname, "../hooks/useProfileTabData.ts"), "utf8");
    expect(hook).toContain('j.customer_id === id ? "poster" as const : "helpr" as const');
  });
});
