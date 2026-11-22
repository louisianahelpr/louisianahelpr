/**
 * F274a (whole-app audit 11-10, job page at 1440): the head's facts rows ran the full page width, so "When" sat about
 * 1,100px from "Fri, Nov 13 ·". The head (category, price, money sentence, facts) keeps to the left column. The price
 * stays in the header row (Q2599, owner 11-02). No centred mx-auto cap (pageColumnNotReCapped).
 *
 * Jobs audit 11-21 (G14): F274a capped the head to the left column's width while Details and the tracker still ran
 * across both columns, so at 1440 and 1920 the right half beside the head stood empty, and the side card sat alone
 * under the tracker with an empty left half. Now the page is two real columns from 1024 up: the head, Details, the
 * steps and the main parts are column 1; the side card is column 2 from the first row (sticky), spanning those rows.
 *
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | data-job-head="" className="space-y-2 lg:col-start-1"> | data-job-head="" className="space-y-2 lg:col-span-2">
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | lg:col-start-2 lg:row-start-1 lg:row-span-4 lg:self-start | lg:col-start-2 lg:self-start
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | data-job-steps="" className={`${CARD} space-y-4 p-4 empty:hidden lg:col-start-1 lg:p-5`}> | data-job-steps="" className={`${CARD} space-y-4 p-4 empty:hidden lg:col-span-2 lg:p-5`}>
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const page = blankComments(readFileSync("src/pages/jobs/jobPage/JobPage.tsx", "utf8"));
const classOf = (marker: string) => page.match(new RegExp(`${marker}="" className=\\{?[\`"]([^\`"]+)[\`"]`))?.[1] ?? "";

describe("the job page is two real columns at computer size (F274a, Jobs audit 11-21 G14)", () => {
  it("reads the page grid and its parts", () => {
    expect(page).toMatch(/data-job-page="" data-layout="v2"/);
    const grid = page.match(/data-job-page="" data-layout="v2" className="([^"]+)"/)?.[1] ?? "";
    expect(grid).toMatch(/lg:grid-cols-\[minmax\(0,\d+fr\)_minmax\(0,\d+fr\)\]/);
    for (const m of ["data-job-head", "data-job-details", "data-job-steps", "data-job-main", "data-job-side"]) expect(classOf(m), m).not.toBe("");
  });

  it("the head, Details, the steps and the main parts are column 1; none spans both columns", () => {
    const left = ["data-job-head", "data-job-details", "data-job-steps", "data-job-main"];
    for (const m of left) {
      expect(classOf(m).split(/\s+/), m).toContain("lg:col-start-1");
      expect(classOf(m), m).not.toMatch(/col-span-2/);
      expect(classOf(m), m).not.toMatch(/\bmx-auto\b/);
    }
    expect(page).not.toMatch(/lg:max-w-\[calc\(/);
  });

  it("the side card is column 2 from the first row, spanning every left row, sticky", () => {
    const side = classOf("data-job-side").split(/\s+/);
    expect(side).toEqual(expect.arrayContaining(["lg:col-start-2", "lg:row-start-1", "lg:sticky", "lg:self-start"]));
    const span = Number(side.find((c) => /^lg:row-span-\d+$/.test(c))?.split("-").pop());
    expect(span).toBeGreaterThanOrEqual(4); // head, Details, steps, main
    // B107's fallback (the card moving into an empty left column) is gone: the left column always holds the head.
    expect(side.join(" ")).not.toMatch(/data-job-main\]:empty/);
  });
});
