// Area 11 H2 (11-18): on the poster's Cancelled / No-show / Late cancel stages at phone width the job page drew an
// empty white card: the one button lives in the portaled phone bar, and the card kept only hidden step controls.
// The card now hides when it has no visible direct child (blankCard.ts).
//
// @mutate src/pages/jobs/jobPage/JobPage.tsx | space-y-4 p-4 ${HIDE_WHEN_BLANK} lg:p-5 | space-y-4 p-4 empty:hidden lg:p-5
// @mutate src/pages/jobs/jobPage/blankCard.ts | export const BLANK_CARD_SELECTOR = ":not(:has(>:not([hidden]):not(:empty)))"; | export const BLANK_CARD_SELECTOR = ":empty";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { BLANK_CARD_SELECTOR, HIDE_WHEN_BLANK } from "@/pages/jobs/jobPage/blankCard";

const card = (inner: string) => {
  const el = document.createElement("section");
  el.innerHTML = inner;
  return el;
};

describe("the job page's side card hides when nothing in it shows (area 11 H2)", () => {
  it("a card holding only hidden controls and empty hosts is blank; one with a visible child is not", () => {
    // The No-show stage on a phone (2026-11-18): the hidden PostedJobActions host, the empty card-ask host, the empty refund host.
    expect(card('<div data-card-ask=""></div><div data-poster-more="" hidden><button>Approve</button></div><div data-job-refund=""></div>').matches(BLANK_CARD_SELECTOR)).toBe(true);
    // Desktop width (2026-11-18): the button row is inline, so the card shows.
    expect(card('<div data-poster-more="" hidden></div><div data-sticky-action-bar="inline"><button>Post this job again</button></div>').matches(BLANK_CARD_SELECTOR)).toBe(false);
    expect(card('<p data-viewer-status="">You cancelled</p>').matches(BLANK_CARD_SELECTOR)).toBe(false);
  });
  it("the class is the selector, and the page's side card wears it", () => {
    expect(HIDE_WHEN_BLANK).toBe(`[&${BLANK_CARD_SELECTOR}]:hidden`);
    const src = blankComments(fs.readFileSync(path.resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    const tag = src.match(/<section data-job-card=""[^>]*>/g) ?? [];
    expect(tag.length).toBeGreaterThan(0);
    for (const t of tag) expect(t).toContain("${HIDE_WHEN_BLANK}");
  });
});
