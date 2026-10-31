/**
 * AUD31-44 (audit 10-31, Admin > Reports at 375 and 1440): a report's seven actions sat on one non-wrapping,
 * sideways-scrolling row under a fade. At 1440 "Dismiss" was cut under the fade; at 375 only "View Profile" and
 * "Assign to Me" showed and Resolve / Dismiss were off screen. The row now wraps, and the header's date never
 * splits "Oct" / "30" across lines.
 *
 * @mutate src/components/admin/AdminReports.tsx | <div data-report-actions className="flex flex-wrap gap-2 pt-1 [&>button]:shrink-0"> | <div data-report-actions className="flex flex-nowrap gap-2 pt-1 overflow-x-auto [&>button]:shrink-0">
 * @mutate src/components/admin/AdminReports.tsx | {" · "}<span className="whitespace-nowrap">{formatShortDate(report.created_at)}</span> | {" · "}{formatShortDate(report.created_at)}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const reports = () => blankComments(readFileSync("src/components/admin/AdminReports.tsx", "utf8"));

/** The className of the element carrying `marker`, read from the source. */
function classOf(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `${marker} is gone from AdminReports.tsx`).toBeGreaterThan(-1);
  // The class list itself holds a ">" ("[&>button]"), so read the quoted className after the marker.
  return /className="([^"]*)"/.exec(src.slice(at))?.[1] ?? "";
}

describe("AUD31-44: a report's actions are all on screen", () => {
  it("the action row wraps instead of scrolling sideways under a fade", () => {
    const cls = classOf(reports(), "data-report-actions");
    expect(cls.split(/\s+/)).toContain("flex-wrap");
    expect(cls).not.toMatch(/flex-nowrap|overflow-x-(auto|scroll)|mask-image/);
  });

  it("the report's date stays on one line", () => {
    expect(reports()).toMatch(/<span className="whitespace-nowrap">\{formatShortDate\(report\.created_at\)\}<\/span>/);
  });
});
