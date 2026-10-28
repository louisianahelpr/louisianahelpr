import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POSTED_GROUP_LABEL, WORKING_GROUP_LABEL } from "@/components/job-card/ActivityBucketGroups";
import { BOX_BUCKETS } from "@/components/job-card/embeddedActivity";
import { JOBS_TABS } from "@/pages/jobs/JobsSection";
import { blankComments } from "./helpers/blankNonCode";

/**
 * THE JOBS SECTION'S PHONE WIDTH BUDGET — every label whole on the screen at
 * 320, 375 and 414.
 *
 * RE-POINTED 2026-10-19 (Q2205). This file used to budget the old My Posts /
 * My Jobs header row (PostsHeader / JobsHeader: a scrolling status-tab strip
 * plus an expanding search). Those screens were retired; the same promise —
 * "a label the member needs is never cut" — now applies to what replaced them:
 *   (1) the STATUS CHIPS under Jobs > Posted / Working (StatusBoxes: since
 *       boards 14/21, 2026-10-20, a sideways-scrolling chip row, "All" first,
 *       the count inside each chip; a chip never shrinks or truncates, so the
 *       budget is now "each chip fits the row on its own");
 *   (2) the section TABS, Browse | Posted | Working (SectionTabs ->
 *       SegmentedControl);
 *   (3) the boxes stay up on an EMPTY list (the old Part 3: a header with its
 *       controls stripped read as a broken screen).
 *
 * WHY NO OVERFLOW GUARD SEES IT: a truncated label overflows nothing — the
 * cell clips it to "Needs y…" and every scrollWidth check passes. Shot at 320
 * on 2026-10-19 (run 2, ~/.lh-shots/dashboards-build/16-jobs-posted-320):
 * "Needs y…" and "Upcomi…". Fixed the same day by tightening the row below
 * 360px (6px gap, 2px box padding, 10px label).
 *
 * jsdom lays nothing out, so widths come from the same stated character model
 * this file always used (calibrated against real Montserrat measurements at
 * 1.13-1.15x, charged at 1.20x so it fails EARLIER than the browser, never
 * later). Classes are PARSED from the components; change them and the budget
 * moves with them.
 *
 * @mutate src/components/sections/StatusBoxes.tsx | shrink-0 whitespace-nowrap | min-w-0 truncate
 * @mutate src/components/sections/StatusBoxes.tsx | flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 | flex min-w-0 flex-1 gap-2 overflow-hidden pb-0.5
 * @mutate src/components/ui/chipClasses.ts | rounded-full px-4 font-sans font-semibold text-ds-13 | rounded-full px-4 font-sans font-semibold text-ds-40
 * @mutate src/lib/activityBuckets.ts |   scheduled: "Upcoming", |   scheduled: "Upcoming jobs that are booked and waiting for their day",
 * @mutate src/components/job-card/JobListPage.tsx | titleCard={isWebDesktop ? undefined : headerEl} | titleCard={isWebDesktop \|\| showEmptyState ? undefined : headerEl}
 */

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));
const BOXES = read("src/components/sections/StatusBoxes.tsx");
const SEGMENTED = read("src/components/ui/SegmentedControl.tsx");
const PAGE = read("src/components/job-card/JobListPage.tsx");
const TAILWIND = read("tailwind.config.ts");

const PHONE_WIDTHS = [320, 375, 414] as const;

/**
 * THE ROW'S WIDTH, AS A FUNCTION OF THE VIEWPORT — measured, then stated.
 * Both rows span the section title card's content box. MEASURED on the 320
 * shot (run 2, 16-jobs-posted-320, device pixel ratio 2): the box row runs
 * x=25..295 (270px = 320 - 50) and the tab track x=30..290 (260px = 320 - 60).
 * If the gutter or the card padding changes these move, and the re-shoot's
 * measure.json is what says so.
 */
const ROW_INSET = 50;
const TABS_INSET = 60;

// ── THE CHARACTER MODEL (unchanged from the header-row budget) ──────────────
const FONT_FUDGE = 1.2;
const NARROW_GLYPHS = "ijltfrI.,'!|:;()[]";
const WIDE_GLYPHS = "mwMW@";
function glyphPx(ch: string): number {
  if (NARROW_GLYPHS.includes(ch)) return 3.2;
  if (WIDE_GLYPHS.includes(ch)) return 8.8;
  if (ch === " ") return 3.0;
  if (ch >= "A" && ch <= "Z") return 7.0;
  return 6.0;
}
const textPx = (s: string, sizePx: number, trackingEm = 0) =>
  [...s].reduce((a, ch) => a + glyphPx(ch), 0) * (sizePx / 11) * FONT_FUDGE + s.length * trackingEm * sizePx;

/** `"ds-11": ["11px", { ..., letterSpacing: "0.02em" }]` in tailwind.config.ts. */
function dsFont(token: string): { px: number; trackingEm: number } {
  const m = TAILWIND.match(new RegExp(`"${token}":\\s*\\["(\\d+)px",\\s*\\{[^}]*letterSpacing:\\s*"(-?[\\d.]+)(?:em)?"`));
  if (!m) throw new Error(`tailwind.config.ts has no font size ${token}`);
  return { px: Number(m[1]), trackingEm: Number(m[2]) };
}
/** Tailwind spacing scale: `gap-1.5` = 6px. */
const spacing = (n: string) => Number(n) * 4;

const CHIPS = read("src/components/ui/chipClasses.ts");

/** The chip's type and side padding, parsed from the shared chip class. */
function chipGeometry() {
  const m = CHIPS.match(/export const CHIP =\s*"[^"]*\bpx-([\d.]+)\b[^"]*\btext-(ds-\d+)\b/);
  if (!m) throw new Error("could not parse the chip padding / size in chipClasses.ts");
  const font = dsFont(m[2]);
  return { pad: spacing(m[1]), fontPx: font.px, trackingEm: font.trackingEm };
}

describe("the Jobs status chips fit a phone", () => {
  it("the inventory is the real chip list, not a copy of it", () => {
    expect(BOX_BUCKETS.length).toBe(5);
    for (const labels of [POSTED_GROUP_LABEL, WORKING_GROUP_LABEL]) {
      for (const k of BOX_BUCKETS) expect(labels[k], `${k} has no label`).toBeTruthy();
    }
  });

  it("the row scrolls sideways and a chip never shrinks or truncates", () => {
    expect(BOXES).toMatch(/flex min-w-0 flex-1 gap-2 overflow-x-auto/);
    expect(BOXES).toMatch(/\$\{CHIP\} shrink-0 whitespace-nowrap/);
    expect(BOXES).not.toMatch(/\btruncate\b[^\n]*data-chip-label|data-chip-label[^\n]*\btruncate\b/);
    expect(CHIPS).not.toMatch(/\btruncate\b/);
  });

  for (const viewport of PHONE_WIDTHS) {
    it(`every chip ("Label · 99") fits the row on its own at ${viewport}`, () => {
      const { pad, fontPx, trackingEm } = chipGeometry();
      const row = viewport - ROW_INSET;
      const cut: string[] = [];
      for (const [tab, labels] of [["Posted", POSTED_GROUP_LABEL], ["Working", WORKING_GROUP_LABEL]] as const) {
        for (const k of ["All", ...BOX_BUCKETS.map((b) => labels[b])]) {
          const w = textPx(`${k} · 99`, fontPx, trackingEm) + pad * 2 + 2;
          if (w > row) cut.push(`${tab} "${k}" needs ${w.toFixed(1)}px, the row gives ${row}px`);
        }
      }
      expect(cut, `@${viewport}: these chips are wider than the screen's row`).toEqual([]);
    });
  }
});

describe("the Jobs section tabs fit a phone", () => {
  it("Browse | Posted | Working fit the row at every phone width", () => {
    const segPad = SEGMENTED.match(/"segmented-option min-w-0 h-11 min-h-11 px-(\d+) rounded-full font-sans text-(ds-\d+) font-semibold"/);
    expect(segPad, "SegmentedControl's segment classes changed shape").not.toBeNull();
    const pad = spacing(segPad![1]);
    const font = dsFont(segPad![2]);
    const labels = ["Browse", ...JOBS_TABS.map((t) => t.label)];
    expect(labels).toEqual(["Browse", "Posted", "Working"]);
    for (const viewport of PHONE_WIDTHS) {
      const need = labels.reduce((a, l) => a + textPx(l, font.px, font.trackingEm) + pad * 2, 0) + 2 * (labels.length - 1) + 4;
      expect(need, `@${viewport}: the tab row needs ${need.toFixed(0)}px`).toBeLessThanOrEqual(viewport - TABS_INSET);
    }
  });
});

describe("an empty Posted / Working list still shows its boxes", () => {
  it("the header (top bar, tabs, status boxes) is drawn whatever the list holds", () => {
    // One unconditional header element, placed by width only — never by emptiness.
    expect(PAGE).toMatch(/const headerEl = \(\s*<EmbeddedActivityHeader /);
    expect(PAGE).toContain("titleCard={isWebDesktop ? undefined : headerEl}");
    expect(PAGE).toMatch(/\{isWebDesktop && \(\s*<div[\s\S]{0,200}\{headerEl\}/);
  });
});
