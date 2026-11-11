/**
 * F273a (whole-app audit 11-10, W2): the two quote dead-ends ("We can't find this quote request." on the request page,
 * "This request isn't taking quotes anymore" on the send page) explained themselves but offered no way on. Each now
 * carries one main button to the quote home for that side: the poster goes to their jobs (QUOTE_HOMES.myRequests),
 * the quoter browses the jobs taking quotes (QUOTE_HOMES.openRequests).
 *
 * The other half of the finding (the empty "You haven't asked for quotes yet" box above Posted) is by design: that box
 * only draws when a link asked for it (?quotes=1 / QUOTE_HOMES); with nothing to show and no such link, JobListQuotes
 * draws nothing (PosterRequests: `if (!focus) return null;`), which is the finding's own "hide when empty".
 *
 * @mutate src/pages/quotes/QuoteRequestPage.tsx | <Link to={QUOTE_HOMES.myRequests}>Go to your jobs</Link> | <span>Go to your jobs</span>
 * @mutate src/pages/quotes/SendQuotePage.tsx | onClick={() => navigate(QUOTE_HOMES.openRequests)}>\n          Browse jobs | onClick={() => navigate(QUOTE_HOMES.myQuotes)}>\n          Browse jobs
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

/** The JSX of one QuotesNotice, from its opening tag to its close. */
const notice = (src: string, title: string) => {
  const start = src.indexOf(`<QuotesNotice title="${title}"`);
  expect(start, `notice "${title}" exists`).toBeGreaterThan(0);
  const end = src.indexOf("</QuotesNotice>", start);
  return src.slice(start, end);
};

describe("the quote dead-ends each carry one main button (F273a)", () => {
  it("request page: 'We can't find this quote request.' sends the poster to their jobs", () => {
    const block = notice(read("src/pages/quotes/QuoteRequestPage.tsx"), "We can't find this quote request.");
    expect(block).toMatch(/<Button asChild[^>]*>\s*<Link to=\{QUOTE_HOMES\.myRequests\}>Go to your jobs<\/Link>/);
  });

  it("send page: 'This request isn't taking quotes anymore' sends the quoter to browse jobs", () => {
    const block = notice(read("src/pages/quotes/SendQuotePage.tsx"), "This request isn't taking quotes anymore");
    expect(block).toMatch(/<Button[^>]*onClick=\{\(\) => navigate\(QUOTE_HOMES\.openRequests\)\}>\s*Browse jobs/);
  });

  it("the empty requests box is hidden unless a link asked for it (the finding's 'hide when empty')", () => {
    const quotes = read("src/components/quotes/JobListQuotes.tsx");
    const empty = quotes.indexOf("if (q.data.length === 0) {");
    expect(empty).toBeGreaterThan(0);
    expect(quotes.slice(empty, empty + 80)).toContain("if (!focus) return null;");
  });
});
