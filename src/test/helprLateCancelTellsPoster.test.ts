/**
 * Q2693 (audit 1102e row 2, HIGH): after the hired Helpr cancelled (helper_cancel_booking: the job goes back to open,
 * helper_id NULL, and their application becomes status 'rejected' with closed_reason 'helper_cancelled'), the poster's
 * page was a plain open listing: "1 applicant" (the Helpr who cancelled, counted as an applicant), "Waiting for Helprs
 * to apply". Nothing said who cancelled, when, or that the job is open again. Now the step line says it, with the
 * next step, and the Helpr who cancelled is no applicant.
 *
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |   const cancels = rows.filter((r) => r.closed_reason === "helper_cancelled" && r.status !== "pending"); |   const cancels = rows.filter(() => false);
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |   const live = rows.filter((r) => r.closed_reason !== "no_show" && !cancels.includes(r)); |   const live = rows.filter((r) => r.closed_reason !== "no_show");
 * @mutate src/components/tracker/jobNextStep.ts |     if (gone && n === 0) return | if (false) return
 * @mutate src/components/tracker/jobNextStep.ts |     if (n > 0) return { who: "you", text: "Choose a Helpr", by: `${n} applied`, ...(gone ? { body: gone.body } : {}) }; |     if (n > 0) return { who: "you", text: "Choose a Helpr", by: `${n} applied` };
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | helprCancelled={helprCancelled} | helprCancelled={null}
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import type { JobProgressState } from "@/components/tracker/jobProgressState";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { applicantCounts } from "@/pages/jobs/jobPage/useJobPage";

const AT = "2037-10-19T11:00:00Z"; // Mon 6:00 AM in Louisiana
const posted: JobProgressState = { stage: 0, waitingOnYou: false, tone: "progress", word: "Posted", next: "Waiting for Helprs to apply", held: true };

describe("a late cancel by the hired Helpr is told to the poster (Q2693)", () => {
  it("the Helpr who cancelled is no applicant, and the page knows who and when", () => {
    const c = applicantCounts([
      { status: "rejected", closed_reason: "helper_cancelled", updated_at: AT, helper_id: "eli" },
    ]);
    expect(c).toMatchObject({ total: 0, pending: 0, helprCancelled: { at: AT, helperId: "eli" } });
    const two = applicantCounts([
      { status: "rejected", closed_reason: "helper_cancelled", updated_at: AT, helper_id: "eli" },
      { status: "pending", closed_reason: null, updated_at: AT, helper_id: "kim" },
    ]);
    expect(two).toMatchObject({ total: 1, pending: 1 });
    expect(applicantCounts([{ status: "pending", closed_reason: null, updated_at: AT, helper_id: "kim" }]).helprCancelled).toBeNull();
  });

  it("nobody applied yet: the line says who cancelled, when, and that the job is open again", () => {
    const s = jobNextStep(posted, { side: "poster", pendingApplicants: 0, helprCancelled: { name: "Eli", at: AT } });
    expect(s).toMatchObject({ who: "info", text: "Eli cancelled Mon 6:00 AM" });
    expect(s?.body).toBe("Your job is open again, so other Helprs can apply.");
    expect(`${s?.text} ${s?.by ?? ""}`).not.toMatch(/Waiting for Helprs/);
  });

  it("new applicants: the step is still choosing, with the cancel said under it", () => {
    const s = jobNextStep(posted, { side: "poster", pendingApplicants: 2, helprCancelled: { name: "Eli", at: AT } });
    expect(s).toMatchObject({ who: "you", text: "Choose a Helpr", by: "2 applied" });
    expect(s?.body).toBe("Eli cancelled Mon 6:00 AM. Your job is open again, so other Helprs can apply.");
  });

  it("the page reads the cancelled row's Helpr and passes it to the tracker, only while the job is open", () => {
    const hook = readFileSync(resolve(__dirname, "../pages/jobs/jobPage/useJobPage.ts"), "utf8");
    expect(hook).toContain('.select("status, closed_reason, updated_at, helper_id")');
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    expect(page).toContain("helprCancelled={helprCancelled}");
    expect(page).toMatch(/const cancelledRow = isPoster && open && !job\.helper_id \? applicants\.data\?\.helprCancelled \?\? null : null;/);
  });
});
