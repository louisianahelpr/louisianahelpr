/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the seller delivery settings' day-off chip
 * "Remove" is the shared InlineTextButton (src/components/ui/InlineTextButton.tsx: link-standard, its 44px touch
 * overlay, a text-sized box), never a hand-made <button>. It keeps its padding, the drawn underline and the spoken
 * name "Remove <date>" (which starts with the visible word, so axe's label-content-name-mismatch holds). The file's
 * other hand-made control (the settings card's open/close header) is still counted: the ratchet fell 2 -> 1.
 *
 * @mutate src/components/declutter/SellerDeliverySettings.tsx | <InlineTextButton className="px-1 underline" aria-label={`Remove ${d}`} | <button type="button" className="px-1 underline" aria-label={`Remove ${d}`}
 * @mutate src/components/declutter/SellerDeliverySettings.tsx | <InlineTextButton className="px-1 underline" aria-label={`Remove ${d}`} | <InlineTextButton className="px-1 underline" aria-label={`Delete ${d}`}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/declutter/SellerDeliverySettings.tsx"), "utf8"));

describe("the day-off chip's Remove is the shared InlineTextButton (Q2709)", () => {
  it("is an InlineTextButton named 'Remove <date>' with its underline", () => {
    const tags = [...src.matchAll(/<InlineTextButton\b[^>]*>[\s\S]*?<\/InlineTextButton>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    const remove = tags.find((t) => />\s*Remove\s*</.test(t));
    expect(remove, "the day-off Remove is not an InlineTextButton").toBeDefined();
    expect(remove!).toContain("aria-label={`Remove ${d}`}");
    expect(remove!).toMatch(/\bunderline\b/);
    const handMade = [...src.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(handMade.filter((b) => />\s*Remove\s*</.test(b)), "a hand-made Remove is back").toEqual([]);
  });
});
