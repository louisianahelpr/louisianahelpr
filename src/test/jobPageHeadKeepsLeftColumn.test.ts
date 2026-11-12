/**
 * F274a (whole-app audit 11-10, job page at 1440): the head's facts rows ran the full page width, so "When" sat about
 * 1,100px from "Fri, Nov 13 ·". The head (category, price, money sentence, facts) now keeps to the left column's width,
 * computed from the page grid itself: left fr / (left fr + right fr) of the width less the column gap. The price stays
 * in the header row (Q2599, owner 11-02). No centred mx-auto cap (pageColumnNotReCapped).
 *
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | lg:col-span-2 lg:max-w-[calc((100%_-_1.5rem)*7/12)]"> | lg:col-span-2">
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const page = blankComments(readFileSync("src/pages/jobs/jobPage/JobPage.tsx", "utf8"));
const GAP_REM: Record<string, number> = { "4": 1, "5": 1.25, "6": 1.5, "8": 2 };

describe("F274a the job page head keeps to the left column at computer size", () => {
  it("reads the page grid and the head", () => {
    expect(page).toMatch(/data-job-page="" data-layout="v2"/);
    expect(page).toMatch(/data-job-head=""/);
  });

  it("the head's lg cap equals the grid's left column", () => {
    const grid = page.match(/data-job-page="" data-layout="v2" className="([^"]+)"/)?.[1] ?? "";
    const cols = grid.match(/lg:grid-cols-\[minmax\(0,(\d+)fr\)_minmax\(0,(\d+)fr\)\]/);
    const gap = grid.match(/lg:gap-x-(\d+)\b/);
    expect(cols, grid).not.toBeNull();
    expect(gap, grid).not.toBeNull();
    const [l, r] = [Number(cols![1]), Number(cols![2])];
    const want = `lg:max-w-[calc((100%_-_${GAP_REM[gap![1]]}rem)*${l}/${l + r})]`;
    const head = page.match(/data-job-head="" className="([^"]+)"/)?.[1] ?? "";
    expect(head.split(/\s+/)).toContain(want);
    expect(head).not.toMatch(/\bmx-auto\b/);
  });
});
