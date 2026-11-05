/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): two standalone Declutter text actions are
 * the shared InlineTextButton (src/components/ui/InlineTextButton: text-sized box, the link-standard 44px touch
 * overlay, the shared hover underline and focus outline), never a hand-made <button>:
 *  - the porch-day card's "Pick another day (once)" (DeclutterPorchDay), keeping its underline;
 *  - the pickup-times editor's "+ Add another time on {day}" (DeclutterPickupTimes), keeping its sage ink and icon row.
 * The hand-made ratchet lost both files' entries in the same commit.
 *
 * @mutate src/components/declutter/DeclutterPorchDay.tsx | <InlineTextButton className="text-sm font-semibold underline underline-offset-2" | <button type="button" className="min-h-11 text-sm font-semibold underline underline-offset-2"
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | <InlineTextButton className="inline-flex items-center gap-1 text-ds-13 | <button type="button" className="inline-flex items-center gap-1 text-ds-13
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | gap-1 text-ds-13 font-semibold text-[hsl(var(--sage-ink))]" data-add-time-on | gap-1 text-ds-13 font-semibold" data-add-time-on
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", p), "utf8"));
const tags = (src: string) => [...src.matchAll(/<InlineTextButton\b[^>]*>/g)].map((m) => m[0]);

describe("Declutter's porch-day and pickup-times text actions are InlineTextButton (Q2709)", () => {
  it("'Pick another day (once)' is an underlined InlineTextButton", () => {
    const src = read("src/components/declutter/DeclutterPorchDay.tsx");
    const t = tags(src).find((x) => x.includes("data-porch-day-move"));
    expect(t, "Pick another day is not an InlineTextButton").toBeDefined();
    expect(t!).toContain("underline");
    expect(src).not.toMatch(/<button\b/);
  });

  it("'Add another time on {day}' is an InlineTextButton in the sage ink with its icon row", () => {
    const src = read("src/components/declutter/DeclutterPickupTimes.tsx");
    const t = tags(src).find((x) => x.includes("data-add-time-on"));
    expect(t, "Add another time is not an InlineTextButton").toBeDefined();
    for (const c of ["inline-flex", "items-center", "text-[hsl(var(--sage-ink))]"]) expect(t!, c).toContain(c);
    expect(src).not.toMatch(/<button\b/);
  });
});
