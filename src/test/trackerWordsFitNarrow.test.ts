/**
 * NARROW TRACKERS KEEP EVERY SHORT WORD WHOLE, AND A WHOLE HOLD READS IN WHOLE DOLLARS (audit 2026-10-28 F17).
 *
 * The bug: the 8-step tracker shares its width equally, so a narrow one cut its short words. Measured on a local
 * build with prod data: /payment-success's tracker is 277px at 375 ("Hired" 30 in 29, "Done" 30 in 29) and 222px
 * at 320 (7 of 8 words cut); a Working card's is 250px at 320 ("Off…", "Hir…", "Co…", "W…"). And the held screen
 * said "Your card is on hold for $40.00" for a $40 job every card calls "$40".
 *
 * The fix (index.css, by the tracker's own width): under 300px the words step down to 0.91em with 2px between
 * columns; under 260px the columns are sized by their words and the current step's small hand / hourglass steps
 * aside. The hold copy prints cents only when there are some. Measured after (same build and accounts): no word
 * cut at 320, 375 or 1440 on /payment-success (222 / 277 / 382px) or on any Working card (250 / 305px); "$25".
 * jsdom has no layout, so the widths are read from the rules here; the numbers above are the measurement.
 *
 * @mutate src/index.css | @container (max-width: 259px) {\n  .job-steps-grid { grid-template-columns: repeat(8, minmax(0, auto)) !important; } | @container (max-width: 259px) {\n  .job-steps-grid { }
 * @mutate src/index.css |   .job-step-short { font-size: 0.91em; } |   .job-step-short { }
 * @mutate src/index.css |   .job-step-cur-icon { display: none; } |   .job-step-cur-icon { }
 * @mutate src/components/tracker/JobProgress.tsx | <Hourglass className="job-step-cur-icon h-3 w-3 shrink-0" /> | <Hourglass className="h-3 w-3 shrink-0" />
 * @mutate supabase/functions/_shared/cardHoldCopy.ts | minimumFractionDigits: fraction ? 2 : 0 | minimumFractionDigits: 2
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { CARD_HOLD_COPY, holdDollars } from "../../supabase/functions/_shared/cardHoldCopy";

const ROOT = resolve(__dirname, "../..");
const css = blankCssComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));
const tracker = blankComments(readFileSync(resolve(ROOT, "src/components/tracker/JobProgress.tsx"), "utf8"));

/** The body of `@container (max-width: <px>px) { ... }` (one level of nested rules). */
function containerBody(px: number): string {
  const m = css.match(new RegExp(`@container \\(max-width: ${px}px\\) \\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}`));
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

describe("narrow trackers keep every short word whole (F17)", () => {
  it("the tracker is its own container, so the rules follow ITS width, not the screen's", () => {
    expect(css).toMatch(/\.job-steps \{ container-type: inline-size; \}/);
  });

  it("under 300px: words at 0.91em (relative, so Senior Mode still scales), 2px between columns", () => {
    const body = containerBody(299);
    expect(body).toContain(".job-steps-grid { column-gap: 2px; }");
    expect(body).toContain(".job-step-short { font-size: 0.91em; }");
    expect(body).not.toMatch(/font-size: \d+px/);
  });

  it("under 260px: columns sized by their words, and the current step's small icon steps aside", () => {
    const body = containerBody(259);
    expect(body).toContain(".job-steps-grid { grid-template-columns: repeat(8, minmax(0, auto)) !important; }");
    expect(body).toContain(".job-step-cur-icon { display: none; }");
    // Both current-step icons carry the hook; the step words never do (they must stay).
    const icons = [...tracker.matchAll(/<(Hand|Hourglass) className="([^"]*)"/g)];
    expect(icons.length).toBeGreaterThan(1);
    for (const m of icons) expect(m[2].split(/\s+/), m[1]).toContain("job-step-cur-icon");
    expect(tracker).not.toMatch(/job-step-short[^"]*job-step-cur-icon|job-step-cur-icon[^"]*job-step-short/);
  });
});

describe("a whole hold reads in whole dollars, never rounded (F17)", () => {
  it("$40 is \"$40\"; $136.40 keeps its cents; nothing is rounded", () => {
    expect(holdDollars(4000)).toBe("$40");
    expect(holdDollars(13640)).toBe("$136.40");
    expect(holdDollars(4005)).toBe("$40.05");
    expect(holdDollars(250000)).toBe("$2,500");
    expect(CARD_HOLD_COPY.held(4000)).toBe("Your card is on hold for $40. You're only charged when you hire someone.");
    expect(CARD_HOLD_COPY.held(2550)).toContain("$25.50");
  });
});
