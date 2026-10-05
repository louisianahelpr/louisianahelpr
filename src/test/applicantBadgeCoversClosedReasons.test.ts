/**
 * Q1259 — the poster's applicant badge names every way an application closes.
 *
 * THE DEFECT. ApplicantsPanel badged every rejected application "Declined"
 * unless closed_reason was 'job_cancelled'. Since 20261004184021 the hourly
 * sweep stamps 'offer_expired' on an offer the Helpr let lapse, so the poster
 * was told they had declined a Helpr who simply never answered.
 *
 * THE CLASS. A closed_reason value the badge has no entry for falls into
 * whatever the default says. Inventory: the values the NEWEST
 * applications_closed_reason_check admits (read from the migrations, comments
 * blanked). CLOSED_REASON_BADGE must hold exactly those keys, both ways.
 */
// @mutate src/pages/posts/postedJobs/applicantBadge.ts |   offer_expired: "Offer expired", |   offer_expired: "Declined",
// @mutate src/pages/posts/postedJobs/ApplicantStatusBadge.tsx |   const badge = posterApplicantBadge(app); |   const badge = app.status === "rejected" ? { label: "Declined", kind: "closed" as const } : posterApplicantBadge(app);
// @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | <ApplicantStatusBadge app={app} /> | {null}
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { CLOSED_REASON_BADGE, posterApplicantBadge } from "@/pages/posts/postedJobs/applicantBadge";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");

/** The value list of the newest ADD CONSTRAINT applications_closed_reason_check. */
function newestClosedReasons(): { file: string; values: string[] } {
  let found = { file: "", values: [] as string[] };
  for (const f of migrationFiles(MIG)) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+applications_closed_reason_check\s+CHECK\s*\(([\s\S]*?)\)\s*\)\s*;/gi)) {
      const inList = /closed_reason\s+IN\s*\(([^)]*)/i.exec(m[1]);
      if (inList) found = { file: f, values: [...inList[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) };
    }
  }
  return found;
}

describe("the applicant badge has an entry for every closed_reason (Q1259)", () => {
  const { file, values } = newestClosedReasons();

  it("the inventory is real: the newest closed_reason CHECK is found and lists values", () => {
    expect(file).toMatch(/^\d{14}_/);
    expect(values.length).toBeGreaterThan(2);
    expect(values).toContain("offer_expired");
  });

  it("CLOSED_REASON_BADGE names exactly the values the constraint admits", () => {
    expect(Object.keys(CLOSED_REASON_BADGE).sort()).toEqual([...values].sort());
  });

  it("an expired offer reads 'Offer expired', never 'Declined'", () => {
    expect(posterApplicantBadge({ status: "rejected", closed_reason: "offer_expired" })?.label).toBe("Offer expired");
    expect(posterApplicantBadge({ status: "rejected", closed_reason: null })?.label).toBe("Declined");
    expect(posterApplicantBadge({ status: "rejected", closed_reason: "job_cancelled" })).toBeNull();
    expect(posterApplicantBadge({ status: "accepted", closed_reason: null })?.label).toBe("Selected");
    expect(posterApplicantBadge({ status: "pending", closed_reason: null })).toBeNull();
  });

  it("ApplicantsPanel renders ApplicantStatusBadge, which reads posterApplicantBadge, and nothing hard-codes Declined", () => {
    const panel = blankComments(readFileSync(join(ROOT, "src/pages/posts/postedJobs/ApplicantsPanel.tsx"), "utf8"));
    const badge = blankComments(readFileSync(join(ROOT, "src/pages/posts/postedJobs/ApplicantStatusBadge.tsx"), "utf8"));
    expect(panel).toMatch(/<ApplicantStatusBadge app=\{app\} \/>/);
    expect(badge).toMatch(/const badge = posterApplicantBadge\(app\);/);
    for (const src of [panel, badge]) expect(src).not.toMatch(/"Declined"|>\s*Declined\s*</);
  });
});
