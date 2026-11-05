/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the delivery task's "Take the photo at this
 * stop on your route" link (scrolls to the route) is the shared InlineTextButton (src/components/ui/InlineTextButton.tsx:
 * link-standard, its 44px touch overlay, a text-sized box), never a hand-made <button>. It kept its own classes (size,
 * weight, the drawn underline, left-aligned wrap); the hand-made ratchet lost the file's entry in the same commit.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | <InlineTextButton className="text-left text-ds-13 font-semibold underline" data-task-steps-on-route="" | <button type="button" className="text-left text-ds-13 font-semibold underline" data-task-steps-on-route=""
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | <InlineTextButton className="text-left text-ds-13 font-semibold underline" | <InlineTextButton className="text-left text-ds-13 font-semibold"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/declutter/DeclutterDeliveryViews.tsx"), "utf8"));

describe("the delivery task's route link is the shared InlineTextButton (Q2709)", () => {
  it("is an InlineTextButton that keeps its drawn underline, and no hand-made <button> is back", () => {
    const tags = [...src.matchAll(/<InlineTextButton\b[^>]*>[\s\S]*?<\/InlineTextButton>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    const link = tags.find((t) => t.includes("data-task-steps-on-route"));
    expect(link, "the route link is not an InlineTextButton").toBeDefined();
    expect(link!).toMatch(/\bunderline\b/);
    expect(link!).toContain("Take the photo at this stop on your route");
    expect(src).not.toMatch(/<button\b/);
  });
});
