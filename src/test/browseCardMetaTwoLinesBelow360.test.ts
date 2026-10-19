/**
 * Q2222 (dashboards build run 4, ~/.lh-shots/dashboards-build/r4/23-jobs-browse-320-light.png):
 * at 320 a Jobs > Browse card cut its start time to "⏱ 1" / "⏱ 6:". The time is
 * owner-protected (browseCardKeepsPlaceAndTime: never hidden by a width rule),
 * so the answer is layout: below 360px the meta row breaks into two lines on
 * EVERY card (place on line one; date · time on line two), so the time is whole
 * and all cards keep one height. From 360px up the row stays one line.
 * The measured half (real layout at 320 and 375) is
 * e2e/happy-path/browse-feed-completeness.spec.ts ("the start time is whole at 320").
 *
 * @mutate src/components/dashboard/JobCard.tsx | flex-nowrap max-[359px]:flex-wrap overflow-hidden | flex-nowrap overflow-hidden
 * @mutate src/components/dashboard/JobCard.tsx | <span aria-hidden data-meta-break className="hidden max-[359px]:block basis-full h-0.5" /> | <span aria-hidden data-meta-break className="hidden" />
 * @mutate src/components/ui/skeletons/JobCardSkeleton.tsx | <div className="flex items-center gap-x-2 max-[359px]:flex-wrap"> | <div className="flex items-center gap-x-2">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const CARD = code("src/components/dashboard/JobCard.tsx");
const BONE = code("src/components/ui/skeletons/JobCardSkeleton.tsx");

describe("the Browse card meta row takes two lines below 360px (Q2222)", () => {
  it("the row wraps only below 360px", () => {
    expect(CARD).toContain('<div className="job-meta-row flex items-center gap-x-2 flex-nowrap max-[359px]:flex-wrap overflow-hidden">');
  });

  it("an unconditional full-width break sits between the place and the when group, and the dot before the date drops there", () => {
    const brk = CARD.indexOf('<span aria-hidden data-meta-break className="hidden max-[359px]:block basis-full h-0.5" />');
    const place = CARD.indexOf("{cityState}");
    const when = CARD.indexOf("{formatJobDate(job.date_needed)}");
    expect(brk).toBeGreaterThan(place);
    expect(when).toBeGreaterThan(brk);
    expect(CARD.slice(brk, when)).toMatch(/<span className="shrink-0 [^"]*max-\[359px\]:hidden">·<\/span>/);
    // Not behind a condition: every card breaks, so every card is one height.
    expect(CARD.slice(Math.max(0, brk - 120), brk)).not.toMatch(/&&\s*\(?\s*$/);
  });

  it("the loading bone takes the same two lines below 360px", () => {
    expect(BONE).toContain('<div className="flex items-center gap-x-2 max-[359px]:flex-wrap">');
    expect(BONE).toContain('<span aria-hidden className="hidden max-[359px]:block basis-full h-0.5" />');
    expect(BONE.match(/className="invisible w-0[^"]*"/g)?.length ?? 0).toBeGreaterThan(1);
  });
});
