/**
 * THE "RECOMMENDED" TAG SITS INSIDE THE JOB CARD'S TOP ROW (owner 2026-10-28, the Browse feed card: "... Other
 * [Recommended]" sat awkwardly on the card's top edge, overlapping the border).
 *
 * The category stopped being a corner tab on 2026-10-18 (a plain icon + label, 12px down), but "Recommended" kept the
 * old hanging-tab shape: flush with the card's top edge, squared top, bottom/right border and a shadow, so it read as
 * stuck to the border beside a label that sat inside the card. It is now a small rounded label on the category line.
 * Measured on a local build (WebKit, faked feed; ~/.lh-shots/ui-polish-1028/): see the commit for the numbers.
 *
 * @mutate src/components/dashboard/JobCard.tsx |               className="inline-flex items-center gap-1 shrink-0 self-end ml-1 px-1.5 py-0.5 rounded-full text-ds-10 font-semibold leading-none pointer-events-none" |               className="inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-b-lg border-b border-r text-ds-10 font-semibold leading-none shadow-sm pointer-events-none"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { enJobCard } from "@/lib/i18n/enJobCard";

const card = blankComments(readFileSync(resolve(__dirname, "../components/dashboard/JobCard.tsx"), "utf8"));

describe("the Recommended tag sits inside the card's top row (owner 2026-10-28)", () => {
  const tag = card.match(/<span\s+data-recommended-tag=""\s+className="([^"]+)"/)?.[1] ?? "";
  const cls = tag.split(/\s+/);

  it("the tag is found (else this checks nothing)", () => {
    expect(cls.length).toBeGreaterThan(5);
    // Same words.
    // Same words (A3-3: read through t("jobCard.recommended"), whose English is "Recommended").
    expect(card).toMatch(/data-recommended-tag=""[\s\S]{0,1600}?>\{t\("jobCard\.recommended"\)\}<\/span>/);
    expect(enJobCard["jobCard.recommended"]).toBe("Recommended");
  });

  it("no hanging-tab shape: not squared to the top edge, no edge border, no shadow", () => {
    expect(cls.filter((c) => /^rounded-(b|t|l|r|bl|br|tl|tr)-/.test(c) || /^border(-[blrt])?$/.test(c) || /^shadow/.test(c))).toEqual([]);
    expect(cls).toContain("rounded-full");
  });

  it("it sits on the category line: bottom-aligned in the badge row (the category label sits 12px down)", () => {
    expect(cls).toContain("self-end");
  });
});
