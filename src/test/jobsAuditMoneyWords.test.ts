/**
 * Jobs audit 10-30: money and dispute sentences that stopped being true.
 *
 * JOBS2-31 / 32: since Q2362 an unsettled dispute goes to Helpr support and the money stays held. The Helpr read that
 * the payment "releases on its normal schedule"; the poster read "72 hours only".
 * JOBS3-53: "Send to Helpr" read as sending it to the worker.
 * JOBS-5: a no-show comes after the start, and a hire is refused within 15 minutes of it, so "pick another applicant"
 * could not happen on that date.
 * JOBS-15: the apply sheet and Help described "released when marked complete" and "pays at that moment".
 * JOBS3-47: "until you hire someone" while "Hire" and "Send offer" charge nothing: the charge is at the Helpr's accept.
 * JOBS3-50 / JOBS-28: member-visible "escrow".
 *
 * @mutate src/components/DisputeDialog.tsx | If nobody settles it by the deadline, Helpr support decides, and the payment stays on hold until then. | If nobody resolves or escalates it, the hold simply lapses at the deadline and the payment releases on its normal schedule.
 * @mutate src/components/job-card/ActivityDialogs.tsx | Take them off your job. Its start time has passed, so to hire someone else, change the date right away. Otherwise it's cancelled and refunded | Reopen your job so you can pick another applicant
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx | We hold the payment. You're paid {STANDARD_PAYOUT_PHRASE}. | Held securely, released when the job is marked complete.
 * @mutate src/components/richMessageInput/ViolationDialog.tsx | Keeping it here is what keeps the work covered, the payment held safely, | Keeping it here is what keeps the work covered, the payment held in escrow,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const code = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

const GONE: Array<[string, RegExp]> = [
  ["src/components/DisputeDialog.tsx", /simply lapses|releases on its normal schedule|72 hours only|"Send to Helpr"/],
  ["src/components/job-card/ActivityDialogs.tsx", /pick another applicant/],
  ["src/components/job-card/activityActions/useLifecycleHandlers.ts", /your job is open again/],
  ["src/components/CancellationDialog.tsx", /Free cancellation/],
  ["src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx", /released when the job is marked complete/],
  ["src/pages/info/helpCenter/helpCenterContent.ts", /pays at that moment|held in escrow/],
  ["src/pages/post-job/FormStep.tsx", /until you hire someone/],
  ["src/pages/post-job/CheckoutStepView.tsx", /until you hire someone/],
  ["src/pages/jobs/jobPage/JobPageParts.tsx", /until you hire someone/],
  ["src/components/richMessageInput/ViolationDialog.tsx", /escrow/],
  ["src/components/BlockUserDialog.tsx", /Any escrow held/],
  ["supabase/functions/charge-recurring-visits/index.ts", /booked and held in escrow/],
];

describe("Jobs audit money and dispute words", () => {
  it("the inventory is real", () => {
    expect(GONE.length).toBeGreaterThan(10);
  });
  it.each(GONE)("%s no longer says the untrue thing", (file, untrue) => {
    expect(code(file)).not.toMatch(untrue);
  });
  it("the dispute dialog says who decides, on both sides", () => {
    const dialog = code("src/components/DisputeDialog.tsx");
    expect(dialog).toContain("If nobody settles it by the deadline, Helpr support decides, and the payment stays on hold until then.");
    expect(dialog).toContain("If unresolved in 72 hours, Helpr support decides, and the payment stays on hold until then.");
  });
});
