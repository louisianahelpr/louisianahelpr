/**
 * THE "RECOMMENDED" TAG NEVER HANGS OFF THE CARD'S EDGE (owner 2026-10-28, the Browse feed card: "... Other
 * [Recommended]" sat awkwardly on the card's top edge, overlapping the border).
 *
 * 2026-10-28 made it a small rounded label on the category line. Design audit A J3 (owner approved 11-08) then made
 * the card wear ONE badge (Boosted > Urgent > Today > Just in > Recommended) as small caps WORDS: no pill, no tab, no
 * edge border, no shadow, no fill. The 10-28 intent stays: nothing about the tag is squared to an edge or bordered.
 *
 * @mutate src/components/dashboard/JobCardBadges.tsx |       className="job-row-badge shrink-0 self-center font-sans | className="job-row-badge shrink-0 self-center rounded-b-lg border-b border-r shadow-sm font-sans
 * @mutate src/components/dashboard/JobCardBadges.tsx |       style={{ color: "hsl(var(--sienna-ink))" }} |       style={{ color: "hsl(var(--sienna-ink))", background: "hsl(var(--burnt-sienna) / 0.12)" }}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { enJobCard } from "@/lib/i18n/enJobCard";

const badges = blankComments(readFileSync(resolve(__dirname, "../components/dashboard/JobCardBadges.tsx"), "utf8"));

describe("the Recommended tag never hangs off the card's edge (owner 2026-10-28; one badge, J3 11-08)", () => {
  const span = badges.match(/<span\s+data-job-badge=\{pick\.key\}[\s\S]*?>/)?.[0] ?? "";
  const cls = (span.match(/className="([^"]+)"/)?.[1] ?? "").split(/\s+/);

  it("the one badge is found, and Recommended is one of its words (else this checks nothing)", () => {
    expect(cls.length).toBeGreaterThan(5);
    expect(badges).toContain('? { key: "recommended", text: t("jobCard.recommended") }');
    expect(enJobCard["jobCard.recommended"]).toBe("Recommended");
    // ONE <span> per card: the file draws no other chip.
    expect(badges.match(/<span\b/g)?.length).toBe(1);
  });

  it("no hanging-tab or pill shape: no rounding, no edge border, no shadow, no fill", () => {
    expect(cls.filter((c) => /^rounded/.test(c) || /^border/.test(c) || /^shadow/.test(c) || /^bg-/.test(c))).toEqual([]);
    expect(span).not.toMatch(/background|borderColor|boxShadow/);
    expect(cls).toEqual(expect.arrayContaining(["uppercase", "font-bold", "text-ds-11"]));
  });
});
