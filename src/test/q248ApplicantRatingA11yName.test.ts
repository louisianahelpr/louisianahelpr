// PROVEN ABLE TO FAIL: rendering the raw signal string (e.g. `{visibleSignals.join(" · ")}`)
// with no aria-hidden star / sr-only "stars" turns this red.
// @mutate src/components/activity/postedJobs/ApplicantsPanel.tsx | {visibleSignals.map((s, i) => (\n                                  <Fragment key={i}>\n                                    {i > 0 && " · "}\n                                    {renderTrustSignal(s)}\n                                  </Fragment>\n                                ))} | {visibleSignals.join(" · ")}

/**
 * Q248(d): the applicant trust-signal row can contain a rating string like
 * "4.9★" (src/lib/applicantScoring.ts:120, `signals.push(`${avgRating}★`)`)
 * rendered in ApplicantsPanel.tsx. A bare "★" glyph in text is read by screen
 * readers as "black star", telling a blind poster nothing. The glyph must be
 * `aria-hidden`, with an accessible "stars" name available via sr-only text.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCORING_FILE = resolve(__dirname, "../lib/applicantScoring.ts");
const PANEL_FILE = resolve(__dirname, "../components/activity/postedJobs/ApplicantsPanel.tsx");

describe("Q248(d): applicant rating star has an accessible name", () => {
  it("applicantScoring.ts still produces the raw '★' rating signal (sanity: this guard is testing the right source)", () => {
    const src = readFileSync(SCORING_FILE, "utf8");
    expect(src).toMatch(/signals\.push\(`\$\{a\.avgRating\.toFixed\(1\)\}★`\)/);
  });

  it("ApplicantsPanel no longer renders the joined signal strings verbatim (which would expose a bare ★ to screen readers)", () => {
    const src = readFileSync(PANEL_FILE, "utf8");
    expect(src).not.toMatch(/\{visibleSignals\.join\(/);
  });

  it("renders the ★ glyph aria-hidden with an sr-only 'stars' accessible name", () => {
    const src = readFileSync(PANEL_FILE, "utf8");
    expect(src).toMatch(/<span aria-hidden="true">★<\/span>/);
    expect(src).toMatch(/<span className="sr-only"> stars<\/span>/);
  });
});
