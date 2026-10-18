/**
 * FLAT CONTROLS, ONE GREEN (design slice 3, primitives; owner 2026-10-17:
 * Warm Modern, GREEN ONLY, FLAT buttons).
 *
 * Two ways the old look kept painting after slice 1 made `.btn-grad-primary`
 * and <Button> flat:
 *
 *  1. GLOSS ON A FLAT CTA. Selected choice tiles (ReportDialog, Decline
 *     applicant, Gift card amount + design, Pet form, Applied jobs filter),
 *     the feed's active category chip, the Auto-tip tile and the toast's
 *     action button each carried their OWN inset top highlight + drop shadow
 *     (`shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),...]`), so they
 *     still looked glossy on top of the flat fill.
 *  2. MINT FILLS. Dark mode's --bark is #4CC38A, the green for TEXT on the
 *     dark canvas. Anything FILLED with solid --bark (a send button, a
 *     selected calendar day, a toggle, a camera badge) was mint with a dark
 *     label in dark mode while every CTA is #0E7A4A (--brand) with white.
 *     A filled control uses --brand + --brand-foreground in both themes.
 *     Solid --bark is left only on the unlabelled decorations listed below
 *     (status dots, a rating bar, bullets): there it is a green MARK, like
 *     text, and the mint is right.
 *
 * The scan reads every tracked .ts/.tsx under src/ (tests excluded) with
 * comments blanked, so a comment that quotes the old string is not counted.
 */
// @mutate src/components/ReportDialog.tsx | "btn-grad-primary border border-[hsl(var(--brand))]" | "btn-grad-primary border border-[hsl(var(--brand))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
// @mutate src/components/profile/earningsTab/ThresholdBanner.tsx | background: "hsl(var(--brand))", | background: "hsl(var(--bark))",
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const FILES = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"));
const SOURCES = FILES.map((f) => ({ f, src: blankComments(readFileSync(f, "utf8")) }));

/** Unlabelled decorations that keep solid --bark (a mark, not a control). EXACT. */
const BARK_MARKS: Record<string, number> = {
  "src/components/admin/AdminHealth.tsx": 1, // health dot
  "src/pages/posts/postedJobs/ApplicantsPanel.tsx": 1, // "neighbors hired them" dot
  "src/pages/posts/postedJobs/ApplicantStatusBadge.tsx": 1, // status dot
  "src/pages/user/RatingBreakdown.tsx": 1, // rating bar fill
  "src/pages/info/legal/LegalChrome.tsx": 1, // list bullet
  // NOT a mark: the "mine" chat bubble (mint with a dark label in dark mode).
  // Its quote bar, attachments and link colours are all keyed to the bubble's
  // parchment label, so it is recoloured as one change (docs/OPEN.md, design
  // slice 3 remainder), not here. Remove this line when it moves to --brand.
  "src/components/messages/MessageBubble.tsx": 1,
};

const SOLID_BARK_FILL = /bg-\[hsl\(var\(--bark\)\)\]|background(?:Color)?:\s*"hsl\(var\(--bark\)\)"|linear-gradient\(180deg,\s*hsl\(var\(--bark\)\)/g;

describe("flat controls, one green", () => {
  it("scans the whole app", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("no control carries its own gloss highlight (inset top-edge shadow) over the flat fill", () => {
    const hits: string[] = [];
    for (const { f, src } of SOURCES) {
      src.split("\n").forEach((line, i) => {
        if (/inset_0_1px_0_hsl\(var\(--parchment\)/.test(line)) hits.push(`${f}:${i + 1} parchment inset highlight`);
        if (/btn-grad-primary[^"`]*shadow-\[/.test(line)) hits.push(`${f}:${i + 1} btn-grad-primary with its own shadow`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("a FILLED control is --brand, never solid --bark (mint in dark mode); solid --bark only on the listed marks", () => {
    const found: Record<string, number> = {};
    for (const { f, src } of SOURCES) {
      const n = (src.match(SOLID_BARK_FILL) ?? []).length;
      if (n) found[f] = n;
    }
    expect(found).toEqual(BARK_MARKS);
  });
});
