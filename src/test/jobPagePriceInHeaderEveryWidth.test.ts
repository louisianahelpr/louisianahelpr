/**
 * Q2599 (owner decision, 11-02: "the job page price stays in the header row at computer size, with no separate box";
 * mockup 4 is overruled here). Jobs audit 1102b row 13: at 375 the price sat in the header beside the title block, but
 * at 1440 the poster got a separate full-width "Job price" box in the side card and the Helpr a "Your pay" box. Now
 * the price (and its one money sentence) is drawn once, in the header row, at every width.
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             {price}\n          </div>\n          {moneyNotes} |             {null}\n          </div>\n          {null}
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   return <div data-poster-money="" className="shrink-0 text-right">{amount}</div>; |   return <div data-poster-money="" className="flex items-baseline justify-between gap-3"><p className="text-ds-16 font-semibold">Job price</p>{amount}</div>;
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const page = blankComments(readFileSync("src/pages/jobs/jobPage/JobPage.tsx", "utf8"));
const parts = blankComments(readFileSync("src/pages/jobs/jobPage/JobPageParts.tsx", "utf8"));
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("Q2599 the job page price is in the header row at every width", () => {
  it("the header draws the price and its money sentence with no width test", () => {
    const head = between(page, 'data-job-head=""', "</section>");
    expect(head).toMatch(/\n\s+\{price\}\n/);
    expect(head).toMatch(/\n\s+\{moneyNotes\}\n/);
    expect(head).not.toMatch(/wide/);
  });

  it("the side card draws no price and no money sentence, and the page reads no desktop switch for it", () => {
    const card = between(page, 'data-job-card=""', "</section>");
    expect(card).not.toMatch(/\{(?:wide && )?price\}|\{(?:wide && )?moneyNotes\}/);
    expect(page.match(/\{price\}/g)?.length).toBe(1);
    expect(page.match(/\{moneyNotes\}/g)?.length).toBe(1);
    expect(page).not.toMatch(/useIsWebDesktop/);
  });

  it("no 'Job price' / 'Your pay' box label on the page", () => {
    expect(parts).not.toMatch(/>Job price</);
    expect(page).not.toMatch(/>Your pay</);
  });
});
