/**
 * NOTHING DRAWN IN A DIALOG'S TOP BAND MAY PAINT OVER ITS CHROME ICONS.
 *
 * ── THE DEFECT, MEASURED AT 320 ON 2026-09-19 ─────────────────────────────
 * test-results/messages-lane/tiles-neither-320.png: a PLAIN yard-work job —
 * no Recommended, no Urgent, no Boosted — painted its "Yard Work" corner tab
 * across the Share glyph. The tab ran x=20..135 on a 290px sheet whose Share
 * button starts at x=99.5.
 *
 * The reserve was not missing; it was STALE. `DIALOG_TOP_RIGHT_RESERVE` in
 * dialog.tsx (54 / 88 / 128 / 168) is the 32px-icon arithmetic:
 * `right-[56px]` + n*32 + (n-1)*8. On 2026-09-11 every chrome icon went to
 * the full 44px HIG box and the table was never recomputed — under by 12px
 * per icon, 36px at three, which is the overlap that was measured.
 *
 * ── THE CLASS ─────────────────────────────────────────────────────────────
 * A number in file A describing geometry declared in file B, with nothing
 * holding the two together. This guard is the thing that holds them together:
 * it re-derives the lane from the DECLARATIONS — the X's `right-1` and its
 * stated 44x44 box, the slot row's `right-[56px]` and `gap-2`, and the icon
 * button's own non-compact box — and fails when the reserve the sheet uses
 * is short of it. Run against the 32px numbers it is red, which is how it was
 * shown able to fail.
 *
 * It asserts the SECOND half of the fix too. A correct 3-icon lane (204px)
 * leaves 86px on a 320px sheet, and the tab's own chrome is 46px of that — so
 * the longest category labels cannot fit and must be allowed to step aside for
 * their glyph. That threshold is checked against the same derived lane, not
 * against a number somebody remembered.
 *
 * @mutate src/components/dashboard/JobDetailDialog.tsx | export const DIALOG_SLOT_ICON = 44; | export const DIALOG_SLOT_ICON = 32;
 * @mutate src/components/dashboard/JobDetailDialog.tsx | export const DIALOG_SLOT_ROW_RIGHT = 56; | export const DIALOG_SLOT_ROW_RIGHT = 46;
 * @mutate src/components/dashboard/JobDetailDialog.tsx | export const DIALOG_CLOSE_X_BOX = 44; | export const DIALOG_CLOSE_X_BOX = 32;
 * @mutate src/components/dashboard/JobDetailDialog.tsx | export const CROWDED_RAIL_RESERVE_PX = 200; | export const CROWDED_RAIL_RESERVE_PX = 9999;
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  cornerIconLaneReservePx,
  CROWDED_RAIL_RESERVE_PX,
} from "@/components/dashboard/JobDetailDialog";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const DIALOG = read("src/components/ui/dialog.tsx");
const ICON_BUTTON = read("src/components/dashboard/IconActionButton.tsx");
const SHARE_BUTTON = read("src/components/jobs/ShareJobButton.tsx");

/** Tailwind spacing step → px. `right-1` is 4px, `gap-2` is 8px, `h-11` 44px. */
const step = (n: number) => n * 4;

/* ── THE ORACLE: what dialog.tsx and the icon button actually DECLARE ───── */

/** The slot row: `className="absolute right-[56px] top-2 z-10 flex h-11 items-center gap-2"` */
function slotRowGeometry(): { right: number; gap: number } {
  const cls = DIALOG.match(/className="absolute right-\[(\d+)px\] top-2 [^"]*gap-(\d+)"/);
  if (!cls) return { right: 0, gap: 0 };
  return { right: Number(cls[1]), gap: step(Number(cls[2])) };
}

/** The close X: `absolute right-1 …` plus its stated `width: "44px"`. */
function closeButtonGeometry(): { right: number; box: number } {
  const right = DIALOG.match(/className=\{`absolute right-(\d+) z-10/);
  const box = DIALOG.match(/style=\{\{ width: "(\d+)px", height: "\d+px"/);
  return { right: right ? step(Number(right[1])) : 0, box: box ? Number(box[1]) : 0 };
}

/** The chrome icons JobDetailDialog passes: `bare`, never `compact` → `h-11 w-11`. */
function bareIconBox(source: string): number {
  const m = source.match(/compact \? "h-8 w-8" : "h-(\d+) w-\d+"/);
  return m ? step(Number(m[1])) : 0;
}

const SLOT = slotRowGeometry();
const CLOSE = closeButtonGeometry();
const ICON = bareIconBox(ICON_BUTTON);
const SHARE_ICON = bareIconBox(SHARE_BUTTON);

/** The lane the chrome really occupies, measured from the right edge. */
function laneRequiredPx(iconCount: number): number {
  if (iconCount <= 0) return CLOSE.right + CLOSE.box;
  return SLOT.right + iconCount * ICON + (iconCount - 1) * SLOT.gap;
}

/** JobDetailDialog renders 0 (guest) to 3 (share + save + report) icons. */
const ICON_COUNTS = [0, 1, 2, 3];

/** The narrowest sheet in the app, and the dialog's own p-4 gutters. */
const NARROWEST_SHEET = 290;
/** The category tab's fixed chrome: 14px glyph + 6px gap + 14/12px padding. */
const TAB_CHROME = 46;
/** "Yard Work" / "Storm Prep" at ds-13 semibold — the longest labels. */
const LONGEST_LABEL = 70;

describe("the dialog's top-right lane is derived, not remembered", () => {
  it("reads a real geometry out of dialog.tsx and the icon button", () => {
    // Floors. Every assertion below multiplies these; a failed parse would
    // make the lane 0 and every comparison trivially true.
    expect(SLOT.right).toBeGreaterThan(0);
    expect(SLOT.gap).toBeGreaterThan(0);
    expect(CLOSE.right).toBeGreaterThan(0);
    expect(CLOSE.box).toBeGreaterThan(0);
    expect(ICON).toBeGreaterThan(0);
    expect(ICON_COUNTS.length).toBeGreaterThan(3);
    // Share and the other two chrome icons are the same box, or the pitch
    // the lane assumes is fiction.
    expect(SHARE_ICON).toBe(ICON);
  });

  it.each(ICON_COUNTS)(
    "reserves the whole lane at %i chrome icon(s)",
    (count) => {
      const reserved = cornerIconLaneReservePx(count);
      const required = laneRequiredPx(count);
      expect(
        reserved,
        `${count} icon(s): the sheet reserves ${reserved}px but the chrome occupies ` +
          `${required}px — the badge row paints over it by ${required - reserved}px`,
      ).toBeGreaterThanOrEqual(required);
    },
  );

  it("RED on the 32px table that shipped: dialog.tsx's own DIALOG_TOP_RIGHT_RESERVE", () => {
    // The stale numbers, read from the file rather than retyped, run through
    // the same comparison. This documents WHY the sheet stopped using them
    // and proves the assertion above can fail — it is failing here.
    const table = [...DIALOG.matchAll(/^\s*(\d):\s*"pr-\[([\d.]+)rem\]"/gm)].map((m) => ({
      count: Number(m[1]),
      px: Number(m[2]) * 16,
    }));
    expect(table.length).toBeGreaterThan(3);
    const short = table.filter((t) => t.px < laneRequiredPx(t.count));
    expect(
      short.map((t) => `${t.count} icons: ${t.px}px reserved vs ${laneRequiredPx(t.count)}px needed`),
      "if this is empty the table was fixed — point JobDetailDialog back at it",
    ).not.toEqual([]);
  });

  it("the category word steps aside exactly when the lane leaves it no room", () => {
    const maxIcons = ICON_COUNTS[ICON_COUNTS.length - 1];
    const freeAtMax = NARROWEST_SHEET - cornerIconLaneReservePx(maxIcons);
    // The premise: at the busiest corner the longest label genuinely does not
    // fit. Stated as a measurement, not assumed.
    expect(freeAtMax).toBeLessThan(TAB_CHROME + LONGEST_LABEL);
    // So the crowded threshold must catch that case …
    expect(cornerIconLaneReservePx(maxIcons)).toBeGreaterThanOrEqual(CROWDED_RAIL_RESERVE_PX);
    // … and must NOT catch a corner where the word still fits, or a poster
    // looking at their own job loses the category for nothing.
    const quiet = 1;
    expect(NARROWEST_SHEET - cornerIconLaneReservePx(quiet)).toBeGreaterThan(
      TAB_CHROME + LONGEST_LABEL,
    );
    expect(cornerIconLaneReservePx(quiet)).toBeLessThan(CROWDED_RAIL_RESERVE_PX);
  });
});
