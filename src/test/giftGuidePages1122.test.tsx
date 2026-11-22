/**
 * The owner's live gift guides edits of 2026-11-22 for the guides' sub-pages.
 *
 * #17 ("remove"): the Gift planner's grey "Tip: tap Bought when you get a gift, and we'll add up what you've spent."
 *     box with its × is gone, with its copy (the planner's lead already says what Bought does).
 *
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |       <p className="gg-fun-lead">{W.plannerLead}</p>\n |       <p className="gg-fun-lead">{W.plannerLead}</p>\n      <p data-gift-hint="fun-planner">Tip: tap Bought when you get a gift.</p>\n
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { FUN_WORDS } from "@/content/giftGuideFun1120";

afterEach(cleanup);

describe("#17 the Gift planner has no tip box (owner 11-22: 'remove')", () => {
  it("draws no hint and no 'tap Bought' tip; the copy is gone", () => {
    const { container } = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    expect(container.querySelector("[data-gift-fun]")).not.toBeNull();
    expect(container.querySelector("[data-gift-hint]")).toBeNull();
    expect(container.textContent).not.toMatch(/tap Bought/i);
    expect(Object.keys(FUN_WORDS)).not.toContain("hintPlanner");
    expect(blankComments(readFileSync("src/pages/info/giftGuides/fun/GiftPlanner.tsx", "utf8"))).not.toMatch(/<Hint\b/);
  });
});
