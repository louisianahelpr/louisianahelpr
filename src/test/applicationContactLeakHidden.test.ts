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

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PANEL = codeOnly(read("src/components/activity/postedJobs/ApplicantsPanel.tsx"));
const OFFER = codeOnly(read("src/components/activity/appliedJobCard/OfferedActions.tsx"));
const APPLICANTS_QUERY = read("src/pages/activity/activityActions/useApplicantsState.ts");
const ACTIVITY_QUERY = read("src/hooks/useActivityData.ts");

describe("helper's note -> poster (ApplicantsPanel)", () => {
  it("does not render the raw note when it is flagged", () => {
    expect(PANEL).toContain("app.flagged_hidden");
    // The guard must WRAP the quote, not sit somewhere else in the file.
    const block = PANEL.slice(PANEL.indexOf("{app.message &&"), PANEL.indexOf("Row 3"));
    expect(block).toContain("app.flagged_hidden");
    expect(block).toMatch(/hidden/i);
  });
});

describe("poster's offer message -> helper (OfferedActions)", () => {
  it("does not render the raw message when it is flagged", () => {
    const block = OFFER.slice(OFFER.indexOf("{app.offer_message &&"));
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
    const t = read("src/components/activity/activityConstants.ts");
    expect(t).toMatch(/flagged_hidden\?:\s*boolean\s*\|\s*null/);
  });
});
