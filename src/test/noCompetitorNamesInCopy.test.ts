/**
 * NO OTHER COMPANIES' NAMES IN PUBLIC COPY (spec v2 §1.7, owner-adopted
 * 2026-10-20; board 183). The landing's section cards said "Instead of
 * Thumbtack, TaskRabbit or a Facebook group" (and OfferUp, Craigslist, Etsy,
 * Zillow, Apartments.com), and the trust row said "with Stripe".
 *
 * CLASS: every tracked non-test source file under src/, comments blanked, may
 * not carry a competitor's name in code (a rendered string), and the landing
 * and marketing components may not name the payments vendor.
 *
 * @mutate src/components/landing/SectionsShowcase.tsx | body: "You pay through Helpr and see the full price before you pay." | body: "You pay through Helpr with Stripe and see the full price before you pay."
 * @mutate src/components/landing/SectionsShowcase.tsx |     why: "Local people apply to your job, and your payment is held until the work is done.", |     why: "Local people apply to your job, unlike Thumbtack.",
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const COMPETITORS = /\b(?:Thumbtack|TaskRabbit|Task Rabbit|OfferUp|Craigslist|Mercari|Zillow|Apartments\.com|Etsy|Nextdoor|Angi|HomeAdvisor)\b/;

describe("public copy names no other company (spec v2 §1.7)", () => {
  it("no competitor name in any rendered source string", () => {
    const files = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|^src\/test\//.test(f));
    expect(files.length).toBeGreaterThan(500);
    const hits = files.filter((f) => COMPETITORS.test(blankComments(fs.readFileSync(path.join(ROOT, f), "utf8"))));
    expect(hits).toEqual([]);
  });

  it("the landing and marketing pages do not name the payments vendor", () => {
    const files = trackedFiles("src").filter((f) => /^src\/components\/(landing|marketing)\/.*\.tsx$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(3);
    const hits = files.filter((f) => /\bStripe\b/.test(blankComments(fs.readFileSync(path.join(ROOT, f), "utf8"))));
    expect(hits).toEqual([]);
  });
});
