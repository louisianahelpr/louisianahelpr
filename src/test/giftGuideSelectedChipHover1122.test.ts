/**
 * A selected gift guides chip keeps its selected look on hover (audit 1122: "a selected .gg-chip goes pale on hover").
 * The selected chips wore `btn-grad-primary` on top of <Button variant="outline">, whose `.ctl-tint` hover wash replaced
 * the olive fill, so the chosen chip went pale under the pointer. A chosen chip is now the primary variant (solid olive,
 * the primary's own small brightness hover) and an unchosen one the outline, chosen in JS (CLAUDE.md: never a class over
 * btn-grad-primary). This reads every <Button> in the gift guides pages: none may carry btn-grad-primary in its
 * className while its variant is "outline".
 *
 * @mutate src/pages/info/giftGuides/GiftGuidePeopleChips.tsx | variant={c.on ? "default" : "outline"} size="sm" className="gg-chip" | variant="outline" size="sm" className={c.on ? "gg-chip btn-grad-primary" : "gg-chip"}
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx | variant={who === o.id ? "default" : "outline"} size="sm" className="gg-chip" | variant="outline" size="sm" className={who === o.id ? "gg-chip btn-grad-primary" : "gg-chip"}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const files = readdirSync("src/pages/info/giftGuides", { recursive: true })
  .map((f) => `src/pages/info/giftGuides/${f}`)
  .filter((f) => f.endsWith(".tsx"));

describe("a chosen gift guides chip stays olive on hover", () => {
  it("no outline <Button> wears btn-grad-primary (the outline's hover wash turned it pale)", () => {
    expect(files.length).toBeGreaterThan(20); // inventory floor: ~40 .tsx files under the guides on 2026-11-22
    let buttons = 0;
    const bad: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/<Button\b[^>]*>/g)) {
        buttons += 1;
        if (/variant="outline"/.test(m[0]) && /btn-grad-primary/.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 120)}`);
      }
    }
    expect(buttons).toBeGreaterThan(20); // inventory floor
    expect(bad).toEqual([]);
  });
});
