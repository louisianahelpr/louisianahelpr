/**
 * Owner, 2026-10-08 ("Move the comment up", on an applicant card whose "plz"
 * sat alone under the Hire row with a gap above it): the applicant's message
 * sits up with the applicant's details, ABOVE the Hire / decline row, never in
 * a row of its own below it.
 *
 * Restated 2026-10-29 for the owner's applicant-card pick (option B): the
 * details (trust line, message, ...) now span the card's full width under the
 * name row instead of the narrow column beside the icons. The message is in
 * that full-width details block, which is ordered before the Hire row
 * (order-1 vs order-2 in the same wrapping row), and carries no avatar-width
 * indent of its own.
 *
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | className="font-sans text-ds-13 leading-snug line-clamp-2 mt-1" | className="font-sans text-ds-13 leading-snug line-clamp-2 pl-14"
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | <div className="basis-full min-w-0 order-1" data-applicant-details=""> | <div className="basis-full min-w-0 order-3" data-applicant-details="">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const SRC = blankComments(readFileSync(join(process.cwd(), "src/pages/posts/postedJobs/ApplicantsPanel.tsx"), "utf8"));
const HIRE_ROW = blankComments(readFileSync(join(process.cwd(), "src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx"), "utf8"));
const orderOf = (cls: string) => Number(/(?:^|\s)order-(\d+)(?:\s|$)/.exec(cls)?.[1] ?? 0);

describe("an applicant's message sits with the details, above the Hire row", () => {
  it("is inside the full-width details block, which is ordered before the Hire row", () => {
    const open = /<div className="([^"]*)" data-applicant-details="">/.exec(SRC);
    expect(open, "the details block exists").toBeTruthy();
    const message = SRC.indexOf('"{app.message}"');
    expect(message).toBeGreaterThan(open!.index);
    const detailsCls = open![1];
    expect(detailsCls.split(/\s+/)).toContain("basis-full");
    const hireRowCls = /<div className="([^"]*basis-full[^"]*)">/.exec(HIRE_ROW)?.[1];
    expect(hireRowCls, "the Hire row's root").toBeDefined();
    expect(orderOf(detailsCls), "details come before the Hire row").toBeLessThan(orderOf(hireRowCls!));
    expect(orderOf(detailsCls), "details come after the name row (order 0)").toBeGreaterThan(0);
  });
  it("carries no avatar-width indent of its own", () => {
    const quote = /<p\s+className="([^"]*)"[^>]*>\s*"\{app\.message\}"/.exec(SRC.replace(/style=\{\{[^}]*\}\}/g, ""));
    expect(quote?.[1]).toBeDefined();
    expect(quote![1]).not.toMatch(/\bpl-14\b/);
  });
});
