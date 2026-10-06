/**
 * Q987 (owner, 2026-09-11: "make it one"): ID verification has ONE visible
 * form, the gold "ID verified" pill with a shield (src/components/profile/
 * IdVerifiedPill.tsx). On 2026-10-06 three surfaces still drew their own: the
 * avatar-corner disc and a primary chip on the owner's profile header, and a
 * sage chip on the poster's applicant cards, all labelled "ID verified by Stripe".
 *
 * Inventory: every non-test source file under src/, comments blanked. Any
 * ID-verification wording outside IdVerifiedPill.tsx must be one of the
 * EXEMPT places below (not a badge), and the list is exact both ways.
 *
 * @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx | label: ID_VERIFIED_LABEL, | label: "ID verified by Stripe",
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | {ID_VERIFIED_LABEL} | ID verified by Stripe
 * @mutate src/components/profile/profileLanding/IdentityHeader.tsx | style={ID_VERIFIED_PILL_STYLE} | style={{}}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const WORDING = /["'`>]\s*(?:✓\s*)?(?:ID verified(?: by Stripe)?|ID VERIFIED|Stripe verified|Identity verified)\b/i;

/** Places that state the fact but are not a badge; each says why. */
// @two-way src/test/idVerifiedOneForm.test.ts:EXEMPT is exact: every entry still matches
const EXEMPT: Record<string, string> = {
  "src/components/AwardGateDialog.tsx": "a checklist requirement row in the hire gate (met / not met), not a badge",
  "src/components/admin/adminUserHelpers.tsx": "admin-only console status badges, never shown to members",
  "src/components/admin/userDetail/ActionsTab.tsx": "admin-only action copy, never shown to members",
  "src/lib/workRecordDocument.ts": "the printable work-record PDF's table row, not an on-screen badge",
  "src/pages/profile/WorkRecord.tsx": "the work-record sheet's field label (\"ID verified by Stripe: Verified\"), the on-screen twin of the PDF row, not a badge",
  "src/components/TrustRow.tsx": "DEAD branch, reported 2026-10-06 not removed: its only caller (JobPosterCard.tsx) never passes idVerified; a caller that starts passing it must use the pill instead",
};

const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/\.test\.|\/test\//.test(f));

const hits = files.filter((f) => WORDING.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));

describe("ID verification has one form (Q987)", () => {
  it("scans the whole app", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(hits).toContain("src/components/profile/IdVerifiedPill.tsx");
  });

  it("no surface outside IdVerifiedPill.tsx writes its own ID-verified wording", () => {
    const own = hits.filter((f) => f !== "src/components/profile/IdVerifiedPill.tsx" && !(f in EXEMPT));
    expect(own, "draw it with ID_VERIFIED_LABEL + ID_VERIFIED_PILL_STYLE + IdVerifiedShield from IdVerifiedPill.tsx").toEqual([]);
  });

  it("EXEMPT is exact: every entry still matches", () => {
    expect(Object.keys(EXEMPT).filter((f) => !hits.includes(f))).toEqual([]);
  });

  it("the profile header and the applicant card draw the gold pill", () => {
    const header = blankComments(readFileSync(join(ROOT, "src/components/profile/profileLanding/IdentityHeader.tsx"), "utf8"));
    expect(header).toMatch(/style=\{ID_VERIFIED_PILL_STYLE\}[\s\S]{0,120}<IdVerifiedShield/);
    expect(header).not.toMatch(/aria-label="ID verified/);
    const applicants = blankComments(readFileSync(join(ROOT, "src/pages/posts/postedJobs/ApplicantsPanel.tsx"), "utf8"));
    expect(applicants).toMatch(/style=\{ID_VERIFIED_PILL_STYLE\}[\s\S]{0,120}<IdVerifiedShield[\s\S]{0,80}\{ID_VERIFIED_LABEL\}/);
  });
});
