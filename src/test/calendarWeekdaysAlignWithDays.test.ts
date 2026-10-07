/**
 * The calendar's weekday headers sit over their own day columns (found by the
 * Q949 screenshot pass, 2026-10-07).
 *
 * Measured on prod's /post-job date picker at 375: header centres 60, 96, 132,
 * ... 276 (36px apart, `w-9`) over day centres 64, 108, 152, ... 328 (44px
 * apart, `w-11`), so "Sa" sat 52px left of Saturday; same drift at 1440. The
 * header cell must be exactly as wide as the day cell and centre its label.
 * jsdom has no layout, so this reads the two widths from ui/calendar.tsx's own
 * classNames (comments blanked) and requires them equal.
 *
 * @mutate src/components/ui/calendar.tsx | weekday: "rounded-md w-11 text-center | weekday: "rounded-md w-9 text-center
 * @mutate src/components/ui/calendar.tsx | weekday: "rounded-md w-11 text-center font-sans | weekday: "rounded-md w-11 font-sans
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(join(__dirname, "..", "components", "ui", "calendar.tsx"), "utf8"));
const cls = (key: string) => new RegExp(`\\n\\s*${key}:\\s*"([^"]*)"`).exec(SRC)?.[1] ?? "";
const width = (c: string) => /(?:^|\s)w-(\d+|\[[^\]]+\])(?:\s|$)/.exec(c)?.[1] ?? null;

describe("calendar weekday headers line up with their day columns", () => {
  const weekday = cls("weekday");
  const day = cls("day");

  it("reads both cells (inventory floor)", () => {
    expect(weekday.length).toBeGreaterThan(10);
    expect(day.length).toBeGreaterThan(10);
  });

  it("the header cell is exactly the day cell's width", () => {
    expect(width(day), "day cell width").not.toBeNull();
    expect(width(weekday), `weekday "${weekday}" vs day "${day}"`).toBe(width(day));
  });

  it("the header label is centred in its cell", () => {
    expect(weekday).toMatch(/(?:^|\s)text-center(?:\s|$)/);
  });
});
