/**
 * THE JOB SHEET'S PAY SITS RIGHT OF THE TITLE (owner 2026-10-28, job detail sheet: "move the pay to the right of the
 * title like on the right side of the card it looks odd here").
 *
 * The big take-home figure ($56) had its own line under the description. It now sits in the title row, right-aligned
 * and top-aligned with the title's first line, like the feed card's price: a long title wraps beside it and the
 * figure never moves or shrinks. Still the bare take-home (never the job price; its words stay for a screen reader),
 * still only for someone who is not the poster; the poster's own job keeps its price chip in the same slot.
 *
 * @mutate src/components/dashboard/JobDetailDialog.tsx |             <div className="shrink-0 self-start pt-0.5" data-job-sheet-pay=""> |             <div className="shrink-0" data-job-sheet-pay="">
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const sheet = blankComments(readFileSync(resolve(__dirname, "../components/dashboard/JobDetailDialog.tsx"), "utf8"));

describe("the job sheet's pay sits right of the title (owner 2026-10-28)", () => {
  const rowAt = sheet.indexOf('<div className="mt-1 flex items-center gap-3">');
  const heroAt = sheet.indexOf("<DialogHero title={job.title} />", rowAt);
  const payAt = sheet.indexOf('data-job-sheet-pay=""', rowAt);
  const chipAt = sheet.indexOf("<JobPrice\n", rowAt);

  it("the title row, its title and its pay slot are found (else this checks nothing)", () => {
    expect(rowAt).toBeGreaterThan(0);
    expect(heroAt).toBeGreaterThan(rowAt);
    expect(payAt).toBeGreaterThan(heroAt);
    expect(chipAt).toBeGreaterThan(payAt);
  });

  it("the take-home is in the title row, after the title column, top-right, never shrinking", () => {
    const slot = sheet.slice(sheet.lastIndexOf("<div", payAt), sheet.indexOf("</div>", payAt));
    expect(slot).toMatch(/className="shrink-0 self-start[^"]*"/);
    expect(slot).toContain("<JobPriceTakeHome job={job} bare />");
    // Only the take-home, only for someone who is not the poster.
    expect(sheet.slice(rowAt, payAt)).toMatch(/\{viewerUserId && viewerUserId !== job\.customer_id && \(\s*<div className="shrink-0 self-start/);
  });

  it("there is no second take-home line under the row", () => {
    expect(sheet.match(/<JobPriceTakeHome job=\{job\} bare \/>/g) ?? []).toHaveLength(1);
    expect(sheet).not.toMatch(/<p>\s*<JobPriceTakeHome/);
  });
});
