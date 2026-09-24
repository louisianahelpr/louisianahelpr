// The contact-leak flag must be HONOURED, not just set.
//
// Migration 20260907005738 flags an application whose note or offer message
// carries a phone number, email, off-platform payment service, or an intent
// phrase like "text me". Setting that flag and then rendering the text anyway
// would leave the leak on screen and only LOOK fixed — and the review of
// 2026-09-06 demonstrated exactly this text reaching these exact components
// verbatim, in both directions.
//
// Source-level on purpose, and the reason is specific: the failure is "the
// component renders the raw string regardless of the flag". A render test with
// a flagged fixture would catch it, but only for the one component it mounts;
// what actually matters is that BOTH directions of the leak are guarded, and
// that the query still asks for the column. Those are three separate files.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const codeOnly = (s: string) =>
  blankComments(s);

const PANEL = codeOnly(read("src/pages/posts/postedJobs/ApplicantsPanel.tsx"));
const OFFER = codeOnly(read("src/pages/jobs/appliedJobCard/OfferedActions.tsx"));
const APPLICANTS_QUERY = read("src/components/job-card/activityActions/useApplicantsState.ts");
const ACTIVITY_QUERY = read("src/hooks/useActivityData.ts");

/**
 * The range between the conditional that gates the value and the place the RAW
 * value is rendered — and nothing else.
 *
 * Both of these used to run to the end of the file. The offer-message one
 * sliced from `{app.offer_message &&` with no end at all; the note one named
 * `"Row 3"` as its end marker, which lives inside a JSX block comment that
 * this file's own `codeOnly()` deletes, so `indexOf` returned -1 and
 * `slice(i, -1)` was the rest of the file too. Measured 2026-09-20: replacing
 * the OfferedActions guard with `{false ? (` — the poster's flagged message
 * back on screen verbatim — kept the suite GREEN at 5/5, because one unrelated
 * later mention of `app.flagged_hidden` satisfied the assertion.
 *
 * Bounding it at the raw render is what makes the assertion mean "the flag is
 * tested BEFORE this string reaches the screen", which is the actual invariant.
 */
function guardedRange(src: string, opener: string, rawRender: string, where: string) {
  const start = src.indexOf(opener);
  expect(start, `${where}: ${opener} is gone — re-point this guard, do not delete it`).toBeGreaterThanOrEqual(0);
  const raw = src.indexOf(rawRender, start);
  expect(raw, `${where}: ${rawRender} is no longer rendered after ${opener}`).toBeGreaterThan(start);
  return src.slice(start, raw);
}

// @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | app.flagged_hidden ? ( | false ? (
describe("helper's note -> poster (ApplicantsPanel)", () => {
  it("does not render the raw note when it is flagged", () => {
    expect(PANEL).toContain("app.flagged_hidden");
    // The guard must WRAP the quote, not sit somewhere else in the file.
    const block = guardedRange(PANEL, "{app.message &&", "{app.message}", "ApplicantsPanel");
    expect(block).toContain("app.flagged_hidden");
    expect(block).toMatch(/hidden/i);
  });
});

describe("poster's offer message -> helper (OfferedActions)", () => {
  it("does not render the raw message when it is flagged", () => {
    const block = guardedRange(OFFER, "{app.offer_message &&", "{app.offer_message}", "OfferedActions");
    expect(block).toContain("app.flagged_hidden");
    expect(block).toMatch(/hidden/i);
  });
});

describe("the column actually reaches the client", () => {
  // A guard on a field the query never selected is undefined-always, i.e. no
  // guard at all — and it would look completely correct in review.
  it("the applicants query selects every column", () => {
    expect(APPLICANTS_QUERY).toMatch(/from\("applications"\)\s*\.select\("\*"\)/);
  });

  it("the applied-jobs query selects every column", () => {
    expect(ACTIVITY_QUERY).toMatch(/from\("applications"\)\.select\("\*"\)/);
  });

  it("the Application type carries the flag", () => {
    const t = read("src/components/job-card/activityConstants.ts");
    expect(t).toMatch(/flagged_hidden\?:\s*boolean\s*\|\s*null/);
  });
});
