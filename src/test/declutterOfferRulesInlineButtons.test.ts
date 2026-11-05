/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the offer-rules row's two word-sized
 * actions, "Suggest one" (asks for a floor) and "Use $X" (saves the suggested floor), are the shared
 * InlineTextButton (src/components/ui/InlineTextButton.tsx: link-standard, its 44px touch overlay, a text-sized
 * box), never a hand-made <button>. Each kept its own classes (size, weight, accent ink), so at rest it reads the
 * same; the hand-made ratchet lost the file's entry (2 buttons) in the same commit.
 *
 * @mutate src/components/declutter/DeclutterOfferRules.tsx | <InlineTextButton className="shrink-0 text-ds-14 font-semibold | <button type="button" className="shrink-0 text-ds-14 font-semibold
 * @mutate src/components/declutter/DeclutterOfferRules.tsx | <InlineTextButton className="shrink-0 font-semibold text-[hsl(var(--accent-ink))]" onClick={() => saveFloor.mutate(suggestion.floorCents)} disabled={busy}> | <InlineTextButton className="shrink-0 font-semibold text-[hsl(var(--accent-ink))]" onClick={() => saveFloor.mutate(suggestion.floorCents)}>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FILE = "src/components/declutter/DeclutterOfferRules.tsx";
const src = blankComments(readFileSync(resolve(__dirname, "..", "..", FILE), "utf8"));
const tags = [...src.matchAll(/<InlineTextButton\b[^>]*>[\s\S]*?<\/InlineTextButton>/g)].map((m) => m[0]);

describe("the offer-rules row's word actions are the shared InlineTextButton (Q2709)", () => {
  it("'Suggest one' and 'Use $X' are InlineTextButtons that keep their busy guard", () => {
    expect(tags.length).toBeGreaterThan(1);
    const suggestOne = tags.find((t) => t.includes('"Suggest one"'));
    const useIt = tags.find((t) => /Use \{formatPrice\(suggestion\.floorCents\)\}/.test(t));
    expect(suggestOne, "'Suggest one' is not an InlineTextButton").toBeDefined();
    expect(useIt, "'Use $X' is not an InlineTextButton").toBeDefined();
    expect(suggestOne!).toContain("disabled={suggest.isPending || busy}");
    expect(useIt!).toContain("disabled={busy}");
  });
  it("no hand-made <button> is back in the file", () => {
    expect(src).not.toMatch(/<button\b/);
  });
});
