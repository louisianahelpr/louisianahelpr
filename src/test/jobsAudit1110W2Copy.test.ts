/**
 * Whole-app audit 11-10 (Worker 2, Jobs): in-app copy fixes, one block per finding, read from the component
 * source with comments blanked so a comment quoting the old words cannot keep a test green.
 *
 * F294: the Apply sheet's checkbox said "Save as my default pitch" — "pitch" is sales jargon a first-time Helpr
 * does not use. It now says "Use this message next time" (the row already wraps the control in a 44px label).
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | Use this message next time | Save as my default pitch
 *
 * F284a: the Browse filter's price caption said "The job's price as posted" while the cards show the Helpr's pay
 * after the fee (helprTakeHome.tsx), so the two numbers looked like a contradiction. The slider still filters on the
 * posted price (min_budget / max_budget are the posted figure), so the caption says so AND names the card's number.
 * @mutate src/components/dashboard/filterSheet/PayRangeSlider.tsx | The price set on the job. Cards show what you would take home. | The job's price as posted
 *
 * F295: the blocked-message sheet labelled a caught phrase "Off-platform language detected" and promised that
 * "no strike has been recorded" — moderation words that scare a well-meaning Helpr. The scanner now labels the two
 * catches in plain words ("Asking to pay outside Helpr", "Asking to call") and the callout drops "strike".
 * @mutate src/lib/messageScanner.ts | label: "Asking to pay outside Helpr" | label: "Off-platform language detected"
 * @mutate src/lib/messageScanner.ts | label: "Asking to call" | label: "Off-platform language detected"
 * @mutate src/components/richMessageInput/ViolationDialog.tsx | Nothing was sent and nothing counts against you | Nothing has been sent
          and no strike has been recorded
 *
 * F275: the paid job page's header said "Finished Mon 12:28 PM" with no date while every other line on the page
 * carried one. The Done line now uses the house dated style, "Finished Mon, Nov 9 at 12:28 PM".
 * @mutate src/components/tracker/jobProgressState.ts | t("jl.finishedAt", { when: whenDated(doneMs) }) | t("jl.finishedAt", { when: when(doneMs) })
 *
 * F261a (counter): "2 more characters to go" never said what the minimum was; now "At least 20 characters (2 to go)".
 * @mutate src/components/profile/ProfileEditForm.tsx | return `At least 20 characters (${left} to go)`; | return `${left} more characters to go`;
 *
 * F279a (placeholder part): under Bigger text the yard-work title placeholder was cut ("e.g. Mow and edge my yarc");
 * the audit asked for "e.g. Mow my yard". The sticky-bar padding and tile stacking asks of F279a are layout work, not here.
 * @mutate src/components/postjob/detailsSection/detailsSectionConstants.ts | yard_work: "e.g. Mow my yard", | yard_work: "e.g. Mow and edge my yard",
 *
 * F286: the Helpr read "E2E has until Tue 12:28 PM to check it" a day later, after that time had passed. The deadline
 * now carries its date, and once it has passed the line says what happens now (support is checking; the money is held).
 * @mutate src/components/tracker/jobProgressState.ts | : checkMs <= now ? t("jl.youDoneLate" | : false ? t("jl.youDoneLate"
 * @mutate src/components/tracker/jobProgressState.ts | t("jl.youDoneUntil", { name: other, when: whenDated(checkMs) }) | t("jl.youDoneUntil", { name: other, when: when(checkMs) })
 * @mutate src/components/tracker/jobProgressState.ts | t("jl.youSentUntil", { name: other, when: whenDated(checkMs) }) | t("jl.youSentUntil", { name: other, when: when(checkMs) })
 *
 * F291a (date part): the disputed job's "answer by Thu 12:28 PM" had no date; it is now "Thu, Nov 12 at 12:28 PM".
 * @mutate src/components/tracker/jobProgressState.ts | decideMs > now ? whenDated(decideMs) : null | decideMs > now ? when(decideMs) : null
 *
 * F283 (time part): "Hallie is on the way · since 12:28 PM" was yesterday's time and read as an hour ago. On any day
 * but today the stamp carries its date: "since Mon, Nov 9 at 12:28 PM".
 * @mutate src/pages/jobs/jobPage/OnTheWayNow.tsx | if (laDay(d) === laDay(now)) return clock; | return clock;
 *
 * F265a (review window): Jobs settings said instant release skips a "24-hour review" while the job page's guarantee
 * names 48 hours. They are two different windows; the line now names both so they no longer read as a contradiction.
 * @mutate src/pages/profile/AutoTip.tsx | The 48-hour Helpr Guarantee still applies. | They're paid 3 days later.
 *
 * F289: the Applicants sheet named two cut-offs on one day ("by Sun, Nov 15, 10:00 AM" then "If nobody is hired by
 * Sun, Nov 15, 12:28 PM, the job closes"). When the close is on the pick-by's day, the second line now says "by then".
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep.tsx | ifNot = byAt && dayWords(byAt) === dayWords(close) | ifNot = false
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep.tsx | ifNot = byAt && dayWords(byAt) === dayWords(close) | ifNot = true
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { bioCharsToGo } from "@/components/profile/ProfileEditForm";
import { titlePlaceholders } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { onTheWaySince } from "@/pages/jobs/jobPage/OnTheWayNow";
import { applicantsNextStep } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep";

/** The same minimal job jobProgressState.test.ts starts from. */
const DONE_BASE = { status: "open", helper_id: null, payment_status: "unpaid" } as const;

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("audit 11-10 W2: Jobs in-app copy", () => {
  it("F294: the Apply sheet offers to reuse the message in plain words, not 'pitch'", () => {
    const src = read("src/components/dashboard/applyConfirmDialog/ApplyBody.tsx");
    expect(src).toContain("Use this message next time");
    expect(src).not.toMatch(/(your|saved|default) pitch/i);
  });

  it("F284a: the price filter caption names both numbers (posted price vs the card's pay)", () => {
    const src = read("src/components/dashboard/filterSheet/PayRangeSlider.tsx");
    expect(src).toContain("The price set on the job. Cards show what you would take home.");
    expect(src).not.toContain("price as posted");
  });

  it("F295: blocked-message labels and callout use plain words, no 'language detected' or 'strike'", () => {
    const scanner = read("src/lib/messageScanner.ts");
    expect(scanner).toContain('label: "Asking to pay outside Helpr"');
    expect(scanner).toContain('label: "Asking to call"');
    expect(scanner).not.toContain("Off-platform language detected");
    const dialog = read("src/components/richMessageInput/ViolationDialog.tsx");
    expect(dialog).toContain("Nothing was sent and nothing counts against you");
    expect(dialog).not.toMatch(/strike/i);
  });

  it("F275: the finished line carries the date in the house style, not a bare weekday", () => {
    // 2037-10-21T14:20Z is Wed, Oct 21 at 9:20 AM in Louisiana.
    const done = jobProgress(
      { ...DONE_BASE, status: "completed", helper_id: "h", helper_confirmed_at: "t", payment_status: "payout_pending",
        helper_completed_at: "2037-10-21T14:00:00Z", poster_completed_at: "2037-10-21T14:20:00Z" },
      { viewer: "poster", otherFirst: "Yusef", now: new Date("2037-10-21T15:00:00Z") },
    );
    expect(done.next).toBe("Finished Wed, Oct 21 at 9:20 AM");
  });

  it("F261a: the About-you counter names the 20-character minimum", () => {
    expect(bioCharsToGo("a".repeat(18))).toBe("At least 20 characters (2 to go)");
    expect(bioCharsToGo("")).toMatch(/^At least 20 characters/);
  });

  it("F279a: the yard-work title placeholder is the short example the audit asked for", () => {
    expect(titlePlaceholders.yard_work).toBe("e.g. Mow my yard");
  });
  it("F286: the Helpr's done line carries the date; past the window it says support is checking", () => {
    // Marked done Wed, Oct 21 2037 at 9:30 AM Louisiana; the 24-hour approval window ends Thu, Oct 22 at 9:30 AM.
    const job = { ...DONE_BASE, status: "in_progress", helper_id: "h", helper_confirmed_at: "t", poster_confirmed_arrival_at: "t",
      payment_status: "held", helper_completed_at: "2037-10-21T14:30:00Z" } as const;
    const before = jobProgress(job, { viewer: "helpr", otherFirst: "Dana", threadHelprId: "h", now: new Date("2037-10-21T15:00:00Z") });
    expect(before.next).toBe("You marked it done. Dana has until Thu, Oct 22 at 9:30 AM to check it");
    const after = jobProgress(job, { viewer: "helpr", otherFirst: "Dana", threadHelprId: "h", now: new Date("2037-10-22T15:00:00Z") });
    expect(after.next).toBe("You marked it done. Dana didn't answer in time, so Helpr support is checking it. The money stays held.");
    expect(after.next).not.toMatch(/has until/);
    // The fix-sent line (revision_acceptance_deadline) is dated the same way.
    const fixSent = jobProgress({ ...job, status: "revision_requested", revision_accepted_at: "t", revision_completed_at: "t",
      revision_acceptance_deadline: "2037-10-24T15:00:00Z" } as never, { viewer: "helpr", otherFirst: "Dana", threadHelprId: "h", now: new Date("2037-10-22T15:00:00Z") });
    expect(fixSent.next).toContain("Dana has until Sat, Oct 24 at 10:00 AM to check it");
  });

  it("F291a: the disputed job names the answer-by date, not a bare weekday", () => {
    const p = jobProgress({ ...DONE_BASE, status: "disputed", helper_id: "h", helper_confirmed_at: "t", payment_status: "held",
      helper_completed_at: "2037-10-21T14:30:00Z", dispute_deadline: "2037-10-24T15:00:00Z" } as never,
      { viewer: "helpr", otherFirst: "Dana", threadHelprId: "h", now: new Date("2037-10-22T15:00:00Z") });
    expect(p.body).toContain("with an answer by Sat, Oct 24 at 10:00 AM.");
  });

  it("F283: the on-the-way stamp is a bare time today and carries its day otherwise", () => {
    // 2037-10-21T17:28Z is Wed, Oct 21 at 12:28 PM in Louisiana.
    expect(onTheWaySince("2037-10-21T17:28:00Z", new Date("2037-10-21T20:00:00Z"))).toBe("12:28 PM");
    expect(onTheWaySince("2037-10-21T17:28:00Z", new Date("2037-10-22T15:00:00Z"))).toBe("Wed, Oct 21 at 12:28 PM");
  });

  it("F265a: instant release names both windows (24-hour approval, 48-hour guarantee)", () => {
    const src = read("src/pages/profile/AutoTip.tsx");
    expect(src).toContain("with no 24-hour approval wait. The 48-hour Helpr Guarantee still applies.");
    expect(src).not.toContain("no 24-hour review");
  });
  // F289: one cut-off per day. Sat Nov 16 2058 9:00 AM CST start, close 12:28 PM the same Louisiana day.
  it("F289: a close on the pick-by's day refers back to it instead of naming a second time", () => {
    const now = new Date("2058-11-12T18:00:00Z");
    const sameDay = applicantsNextStep({ status: "open", payment_status: "held", date_needed: "2058-11-16", start_time: "09:00:00", expires_at: "2058-11-16T18:28:00Z" }, 2, now);
    expect(sameDay?.step.by).toBe("by Sat, Nov 16, 9:00 AM");
    expect(sameDay?.ifNot).toBe("If nobody is hired by then, the job closes and your card isn't charged.");
    // A close days after the start still names its own day and time: it is a different cut-off.
    const later = applicantsNextStep({ status: "open", payment_status: "held", date_needed: "2058-11-16", start_time: "09:00:00", expires_at: "2058-11-30T15:00:00Z" }, 2, now);
    expect(later?.ifNot).toBe("If nobody is hired by Sat, Nov 30, 9:00 AM, the job closes and your card isn't charged.");
  });
});
