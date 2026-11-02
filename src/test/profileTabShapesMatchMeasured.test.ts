/**
 * Q1695: the profile tab placeholders (TAB_SHAPES in
 * src/components/profile/ProfileTabFallback.tsx) agree with the LAST prod
 * measurement of the content that replaces them.
 *
 * The loading-state refresh of 2026-11-02 01:07Z (bot PR #3963,
 * bot/refresh/loading-states 80cc9f9ff8, measured at 375 with both test
 * accounts) is what src/test/loadingStateShape.test.ts refuses: e.g.
 * /profile?tab=settings "row 166px -> 235px" five times per persona. That
 * guard reads a measurement file only the bot can produce (a browser run), so
 * until its next refresh lands this file holds the table to the numbers that
 * run recorded, with the measurer's own definitions
 * (scripts/audit/measure-loading-states.mjs describe()): rows = the body's
 * visible children (the tab header plus one per block), rowH = their median
 * height, and the jump budget is ROW_BUDGET (8px) from
 * scripts/check-loading-state-shape.mjs.
 *
 * MEASURED below = the loaded frame of that run: each group's height is the
 * distance from its <h2> landmark to the next one's minus the 12px section gap
 * (--section-gap at 375); the last group is the remainder of rowRect.h.
 */
// @mutate src/components/profile/ProfileTabFallback.tsx | settings: [{ h: 235 }, { h: 301 }, { h: 166 }, { h: 626 }, { h: 313 }, { h: 58 }], | settings: [{ h: 166 }, { h: 295 }, { h: 101 }, { h: 397 }, { h: 378 }, { h: 58 }],
// @mutate src/components/profile/ProfileTabFallback.tsx | settings: [{ h: 235 }, { h: 301 }, { h: 166 }, { h: 626 }, { h: 313 }, { h: 58 }], | settings: [{ h: 235 }, { h: 301 }, { h: 166 }, { h: 626 }, { h: 313 }],
// @mutate src/components/profile/ProfileTabFallback.tsx | instant_book: [{ h: 122 }, | instant_book: [{ h: 101 },
// @mutate src/components/profile/ProfileTabFallback.tsx | auto_tip: [{ h: 288 }], | auto_tip: [{ h: 527 }],
// @mutate src/components/profile/ProfileTabFallback.tsx | analytics: [{ h: 370 }], | analytics: [{ h: 481 }],
// @mutate src/components/profile/ProfileTabFallback.tsx |     { h: 89, media: 1 },\n    { h: 71, media: 1 },\n    { h: 86, media: 1 }, |     { h: 74, media: 1 },\n    { h: 74, media: 1 },\n    { h: 74, media: 1 },
// @mutate src/components/profile/ProfileTabFallback.tsx |     { h: 261, media: 3 }, |     { h: 196, media: 2 },
// @mutate src/components/profile/ProfileTabFallback.tsx |   home_history: [{ h: 375, media: 1 }], |   home_history: [{ h: 384, media: 1 }],
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
import { TAB_SHAPES } from "@/components/profile/ProfileTabFallback";

const ROW_BUDGET = 8;
const SECTION_GAP = 12;

type Measured = { header: number; rows: number; rowH: number; total: number };
/** Loaded frame, 2026-11-02 01:07Z run, both personas identical for these tabs. */
const MEASURED: Partial<Record<keyof typeof TAB_SHAPES, Measured>> = {
  // h1 header 0-57; h2 landmarks at 69, 315.6, 628.7, 806.3, 1444; rowRect.h 1826.6.
  settings: { header: 57, rows: 7, rowH: 235, total: 1826.6 },
  // h1 header 0-57 (same landmark as Settings); rows 6, rowH 122, rowRect.h 795.1.
  instant_book: { header: 57, rows: 6, rowH: 122, total: 795.1 },
  // One block under the header: rowH is that block; rowRect.h 355.8 and 438.2.
  auto_tip: { header: 57, rows: 2, rowH: 288, total: 355.8 },
  analytics: { header: 57, rows: 2, rowH: 370, total: 438.2 },
  // B164: h1 at y 12, h 49.3 (the title wraps), so the header row is 61; cards' h2 landmarks 88.3, 189.6, 272.1,
  // 370, 610.9; rows 6, rowH 86, rowRect.h 856.9. Sign-in methods is on (SOCIAL_SIGN_IN_ENABLED).
  security: { header: 61, rows: 6, rowH: 86, total: 856.9 },
  // B164: helper-e2e (no record): one block under the header; rows 2, rowH 375, rowRect.h 443.4. poster-e2e's
  // record is a long list that grows below (byDesign, the 09-19 screenful ruling).
  home_history: { header: 57, rows: 2, rowH: 375, total: 443.4 },
};

/** Avatar/icon circles in the loaded frame (the measurer's media count; the header draws none, as the loading
 *  frame's count shows). The check refuses a difference of more than 1. */
const MEDIA: Partial<Record<keyof typeof TAB_SHAPES, number>> = {
  // B164: 6 in the loading frame (74/74/74/224/196 with 1/1/1/1/2) -> 7 loaded.
  security: 7,
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("Q1695: profile tab placeholders match the last prod measurement", () => {
  it("covers at least one tab (never passes on an empty table)", () => {
    expect(Object.keys(MEASURED).length).toBeGreaterThan(0);
  });

  for (const [tab, n] of Object.entries(MEDIA) as [keyof typeof TAB_SHAPES, number][]) {
    it(`${tab}: the same number of avatar/icon circles as the loaded frame (${n})`, () => {
      const drawn = (TAB_SHAPES[tab] ?? []).reduce((a, b) => a + (b.media ?? 0), 0);
      expect(Math.abs(drawn - n)).toBeLessThanOrEqual(1);
      expect(drawn).toBe(n);
    });
  }

  for (const [tab, m] of Object.entries(MEASURED) as [keyof typeof TAB_SHAPES, Measured][]) {
    it(`${tab}: same row count, median row within ${ROW_BUDGET}px, same total height within ${ROW_BUDGET}px`, () => {
      const blocks = TAB_SHAPES[tab];
      expect(blocks, `${tab} has no TAB_SHAPES entry`).toBeTruthy();
      const hs = blocks!.map((b) => (typeof b.h === "number" ? b.h : NaN));
      expect(hs.every(Number.isFinite), `${tab} uses a "fill" block`).toBe(true);
      const rowHs = [m.header, ...hs];
      expect(rowHs.length).toBe(m.rows);
      expect(Math.abs(median(rowHs) - m.rowH)).toBeLessThanOrEqual(ROW_BUDGET);
      const total = m.header + hs.reduce((a, b) => a + b, 0) + SECTION_GAP * hs.length;
      expect(Math.abs(total - m.total)).toBeLessThanOrEqual(ROW_BUDGET);
    });
  }
});
