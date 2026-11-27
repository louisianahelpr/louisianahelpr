/**
 * Q2222 (dashboards build run 4, ~/.lh-shots/dashboards-build/r4/23-jobs-browse-320-light.png):
 * at 320 a Jobs > Browse card cut its start time to "⏱ 1" / "⏱ 6:". The time is
 * owner-protected (browseCardKeepsPlaceAndTime: never hidden by a width rule),
 * so the answer is layout: below 360px the meta row breaks into two lines on
 * EVERY card (place on line one; date · time on line two), so the time is whole
 * and all cards keep one height. From 360px up the row stays one line.
 * The measured half (real layout at 320 and 375) was the mocked
 * e2e/happy-path/browse-feed-completeness.spec.ts, retired 2026-11-05 (Q1035):
 * prod's open feed holds no cards to measure, so the phone media-column rule
 * (src/index.css, Q2043) is pinned here at source level instead, with the
 * spec's @mutate.
 *
 * @mutate src/components/dashboard/JobCard.tsx | flex-nowrap max-[359px]:flex-wrap overflow-hidden | flex-nowrap overflow-hidden
 * @mutate src/components/dashboard/JobCard.tsx | <span aria-hidden data-meta-break className="hidden max-[359px]:block basis-full h-0.5" /> | <span aria-hidden data-meta-break className="hidden" />
 * @mutate src/components/ui/skeletons/JobCardSkeleton.tsx | <div className="job-meta-row flex items-center gap-x-2 flex-nowrap max-[359px]:flex-wrap overflow-hidden"> | <div className="flex items-center gap-x-2">
 * @mutate src/index.css |   .job-card-media-col .job-meta-row { flex-wrap: wrap; } |   .job-card-media-col .job-meta-row { flex-wrap: nowrap; }
 * @mutate src/index.css | .job-card-media-col { container-type: inline-size; }\n@container (max-width: 459px) { | @media (max-width: 767px) {
 * @mutate src/index.css |   .job-card-media-col .job-meta-row > [data-meta-break] { display: block; } |   .job-card-media-col .job-meta-row > [data-meta-break] { display: none; }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const CARD = code("src/components/dashboard/JobCard.tsx");
const BONE = code("src/components/ui/skeletons/JobCardSkeleton.tsx");
const CSS = blankComments(readFileSync(join(process.cwd(), "src/index.css"), "utf8"));

describe("the Browse card meta row takes two lines below 360px (Q2222)", () => {
  it("the row wraps only below 360px", () => {
    // Owner 2026-11-27: a feed ROW spaces its icon groups 10px apart (gap-x-2.5); the photo hero keeps gap-x-2.
    expect(CARD).toContain('<div className={`job-meta-row flex items-center ${row ? "gap-x-2.5" : "gap-x-2"} flex-nowrap max-[359px]:flex-wrap overflow-hidden`}>');
  });

  it("an unconditional full-width break sits between the place and the when group, and the dot before the date drops there", () => {
    const brk = CARD.indexOf('<span aria-hidden data-meta-break className="hidden max-[359px]:block basis-full h-0.5" />');
    const place = CARD.indexOf("{cityState}");
    const when = CARD.indexOf("{jobDayLabel(job)}"); // Q2408: the day reads through the window formatter
    expect(brk).toBeGreaterThan(place);
    expect(when).toBeGreaterThan(brk);
    // The photo hero's dot (a feed ROW has none since owner 2026-11-27: its icons separate the groups).
    expect(CARD.slice(brk, when)).toMatch(/<span data-meta-dot className="shrink-0 [^"]*max-\[359px\]:hidden">·<\/span>/);
    // Not behind a condition: every card breaks, so every card is one height.
    expect(CARD.slice(Math.max(0, brk - 120), brk)).not.toMatch(/&&\s*\(?\s*$/);
  });

  it("the loading bone takes the same two lines below 360px", () => {
    // Jobs audit 11-21 (P10): the bone's meta row IS the card's (same classes, same break), so the same CSS gives it
    // the same lines: below 360px (Q2222) and in a narrow media column (P9's container query).
    expect(BONE).toContain('<div className="job-meta-row flex items-center gap-x-2 flex-nowrap max-[359px]:flex-wrap overflow-hidden">');
    expect(BONE).toContain('<span aria-hidden data-meta-break className="hidden max-[359px]:block basis-full h-0.5" />');
    expect(BONE.match(/className="invisible w-0[^"]*"/g)?.length ?? 0).toBeGreaterThan(1);
  });
});

describe("a narrow text column takes the two-line meta row, at any screen width (Q2043, Jobs audit 11-21 P9)", () => {
  it("below 460px of column the meta row wraps, its break shows and the dot after it drops", () => {
    // P9: a viewport rule (max-width: 767px) missed the 768 two-column grid, whose ~284px column clipped the time.
    expect(CSS).toContain(".job-card-media-col { container-type: inline-size; }");
    expect(CSS).not.toContain("@media (max-width: 767px) {\n  .job-card-media-col");
    const at = CSS.indexOf("@container (max-width: 459px) {\n  .job-card-media-col .job-meta-row");
    expect(at, "the media-column container block is in src/index.css").toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf("}\n}", at) + 3);
    expect(block).toContain(".job-card-media-col .job-meta-row { flex-wrap: wrap; }");
    expect(block).toContain(".job-card-media-col .job-meta-row > [data-meta-break] { display: block; }");
    expect(block).toContain(".job-card-media-col .job-meta-row > [data-meta-dot] { display: none; }");
    // Owner 2026-11-27: never "the span after the break" (on a ROW that is the day and time, not a dot).
    expect(CSS).not.toContain("[data-meta-break] + span");
  });
});
