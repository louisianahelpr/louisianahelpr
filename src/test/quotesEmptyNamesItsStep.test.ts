/**
 * F140 (owner UI audit 11-09): /quotes' empty state said "On Post a Job, pick Get quotes", but step 1 of Post a job
 * has no Get quotes; the choice is on the Price step (FormStep page 3, PriceModeChoice). The line names that step by
 * the stepper's own word, and the Price page is where the choice is drawn.
 *
 * @mutate src/components/quotes/JobListQuotes.tsx | On Post a Job's Price step, pick Get quotes | On Post a Job, pick Get quotes
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("/quotes' empty state names the step Get quotes is on (F140)", () => {
  it("the line names the Price step by the stepper's word", () => {
    const quotes = read("src/components/quotes/JobListQuotes.tsx");
    const line = quotes.match(/Not sure what a job should cost\?[^<]*/)?.[0] ?? "";
    expect(line.length, "the empty line was found").toBeGreaterThan(40);
    expect(en["postJob.rail.price"]).toBe("Price");
    expect(line).toContain(`${en["postJob.rail.price"]} step, pick Get quotes`);
  });

  it("Get quotes (PriceModeChoice) is drawn on the Price page, not page 1", () => {
    const form = read("src/pages/post-job/FormStep.tsx");
    const page3 = form.indexOf('<div data-form-page="3"');
    const page4 = form.indexOf('<div data-form-page="4"');
    const choice = form.indexOf("<PriceModeChoice");
    expect(page3).toBeGreaterThan(0);
    expect(choice).toBeGreaterThan(page3);
    expect(page4 === -1 || choice < page4).toBe(true);
    expect(form.slice(page3, choice)).toContain('screen="price"');
  });
});
