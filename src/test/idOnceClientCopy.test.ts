/**
 * ID once, in the app's words (owner, 2026-10-20: a Helpr's ID is "required
 * but only once they are offered and accept a job").
 *
 *   - The POSTER reads an informational line on an unverified applicant, by
 *     name, never a gendered pronoun and never a refusal (the offer stays open
 *     to anyone; ApplicantsPanel renders applicantIdNote).
 *   - The HELPR who claims series dates while their setup is unfinished is told
 *     the step that finishes the accept (claimSetupStep, from the server's
 *     helper_accept_missing answer, 20261020043346).
 *
 * @mutate src/lib/awardGate.ts |   return `${who} verifies their ID when they accept.`; |   return `${who} can't be hired until they verify their ID.`;
 * @mutate src/lib/seriesDates.ts |   if (r.missing.length === 0) return null; |   if (r.missing.length >= 0) return null;
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx |                                 {applicantIdNote(formatName(app.profiles.full_name, ""))} |                                 {null}
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { applicantIdNote } from "@/lib/awardGate";
import { claimSetupStep } from "@/lib/seriesDates";

// These cases test the ID check while it is ON. The owner switched it off on
// 2026-10-23 (switch `identity_check`); src/test/identityCheckOffEntryPoints.test.ts
// covers the off state.
vi.mock("@/hooks/useIdentityCheckOn", () => ({ useIdentityCheckOn: () => true, useIdentityCheckStatus: () => ({ on: true, settled: true }) }));
beforeEach(() => setIdentityCheckOn(true));
afterEach(() => setIdentityCheckOn(false));

const PRONOUNS = /\b(he|she|him|her|his|hers)\b/i;

describe("poster: an unverified applicant is named, never refused", () => {
  it("says the name and that the ID comes at the accept", () => {
    expect(applicantIdNote("Andre")).toBe("Andre verifies their ID when they accept.");
    expect(applicantIdNote("  ")).toBe("This Helpr verifies their ID when they accept.");
    expect(applicantIdNote(null)).toBe("This Helpr verifies their ID when they accept.");
  });

  it("no gendered pronoun and no refusal wording", () => {
    const line = applicantIdNote("Andre");
    expect(line).not.toMatch(PRONOUNS);
    expect(line).not.toMatch(/can't|cannot|not be hired|hire yet/i);
  });

  it("the applicant card renders it for an applicant whose ID is not verified", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/posts/postedJobs/ApplicantsPanel.tsx"), "utf8"));
    expect(src).toMatch(/app\.profiles && app\.profiles\.is_id_verified !== true && \(/);
    expect(src).toContain("{applicantIdNote(formatName(app.profiles.full_name, \"\"))}");
  });
});

describe("Helpr: a series claim with setup unfinished names the step", () => {
  it("nothing missing: no step", () => {
    expect(claimSetupStep({ missing: [], needsSetup: [] })).toBeNull();
  });
  it("the ID missing: Verify your ID to finish accepting", () => {
    expect(claimSetupStep({ missing: ["stripe_id"], needsSetup: ["2026-11-05"] }))
      .toBe("Verify your ID to finish accepting. A date is booked only once that's done; one that comes up first goes back to the series. You only do it once.");
  });
  it("both missing: both named", () => {
    expect(claimSetupStep({ missing: ["payout_setup", "stripe_id"], needsSetup: [] }))
      .toMatch(/^Verify your ID and set up payouts to finish accepting/);
  });
});
