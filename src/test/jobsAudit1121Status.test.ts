/**
 * Jobs audit 11-21 (G6): the poster's status said different things on the collapsed card, the open card and the job
 * page. Each sentence is now read from the one place the card reads it.
 *
 * (1) The open Posted card's tracker said "Pick your Helpr" (with an olive Applicants button) where the collapsed card
 *     said "No applicants yet": the tracker was handed no count. Guard: PostedJobCard.openApplicantsLine.test.tsx.
 * (2) An unpaid job said "Not paid yet. Helprs can't see this job" beside "Posted" and "Next: choose a Helpr · 1 applied".
 * @mutate src/components/tracker/jobNextStep.ts |   if (o.side === "poster" && progress.unpaid) return { who: "you", text: t("ns.payToPost"), body: t("ns.payToPostBody") }; |
 * @mutate src/components/tracker/jobProgressState.ts | return { ...at(0, true, t("jl.notPosted"), t("jl.payToPost"), false), unpaid: true }; | return at(0, false, "Posted", t("jl.waitPayment"), false);
 * (3) A Helpr who never checked in: the card said "Your Helpr didn't show up" and the job page "Hallie is on the way · since
 *     Mon, Nov 9". The page drops the on-the-way block then, and its next line is the card's own sentence.
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {isPoster && !continueDay.row && !noShowLead && <OnTheWayNow | {isPoster && !continueDay.row && <OnTheWayNow
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | continueStep={continueDay.step ?? (isPoster && noShowLead ? youStep(posterStatusLine(job as unknown as Job, pending, undefined, undefined, false, helperFirst).detail, helperFirst) | continueStep={continueDay.step ?? (false ? youStep("", null)
 * (4) Past the review window the card said "time's up, Helpr support steps in", the page "You can still approve".
 * @mutate src/pages/posts/postedJobCard/PosterStatusStrip.tsx |   if (mins <= 0) return t("jl.approveLateShort"); |   if (mins <= 0) return "time's up, Helpr support steps in";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { jobLocalDateISO } from "./helpers/jobLocalDate";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { reviewTimeLeft } from "@/pages/jobs/jobPage/reviewTimeLeft";
import "@/lib/i18n/enJobLines";
import "@/lib/i18n/enNextStep";
import { t } from "@/lib/i18n/language";

const code = (f: string) => blankComments(readFileSync(f, "utf8"));
const openJob = (payment_status: string) =>
  ({ id: "j1", status: "open", helper_id: null, date_needed: jobLocalDateISO(23), start_time: null, payment_status }) as never;

describe("G6 (2): an unpaid job is not posted, and its one step is paying", () => {
  it("the poster's tracker: 'Not posted yet', the step is theirs, and never 'Choose a Helpr' even with an applicant", () => {
    const p = jobProgress(openJob("abandoned"), { viewer: "poster", pendingApplicants: 1 });
    expect(p.word).toBe("Not posted yet");
    expect(p.unpaid).toBe(true);
    const step = jobNextStep(p, { side: "poster", pendingApplicants: 1 })!;
    expect(step.text).toBe("Not posted yet: pay to post it");
    expect(step.text).not.toMatch(/choose/i);
    expect(step.who).toBe("you");
  });

  it("a paid open job is unchanged: Posted, and Choose a Helpr when someone applied", () => {
    const p = jobProgress(openJob("escrow"), { viewer: "poster", pendingApplicants: 1 });
    expect(p.word).toBe("Posted");
    expect(p.unpaid).toBeUndefined();
    expect(jobNextStep(p, { side: "poster", pendingApplicants: 1 })!.text).toBe(t("ns.choose"));
  });
});

describe("G6 (3): a no-show lead on the job page says the card's sentence, never 'on the way'", () => {
  const page = code("src/pages/jobs/jobPage/JobPage.tsx");
  it("the on-the-way block and its hidden next line both wait on !noShowLead", () => {
    expect(page).toContain("{isPoster && !continueDay.row && !noShowLead && <OnTheWayNow");
    expect(page).toContain("(isPoster && !continueDay.row && !noShowLead && showsNow(job, trackingStatus))");
  });
  it("the tracker's next line is posterStatusLine's detail, named, while the no-show leads", () => {
    // #42 (deep audit 11-22): through youStep, so the Helpr's name keeps its capital ("Next: Hallie didn't show up").
    expect(page).toMatch(/continueStep=\{continueDay\.step \?\? \(isPoster && noShowLead \? youStep\(posterStatusLine\(job as unknown as Job, pending, undefined, undefined, false, helperFirst\)\.detail, helperFirst\)/);
  });
});

describe("G6 (4): past the review window the card and the page both say the poster can still approve", () => {
  it("the card's short line is the page's fact", () => {
    expect(code("src/pages/posts/postedJobCard/PosterStatusStrip.tsx")).toContain('if (mins <= 0) return t("jl.approveLateShort");');
    expect(t("jl.approveLateShort")).toMatch(/still approve/);
    expect(t("jl.approveLateShort")).not.toMatch(/time's up/i);
    expect(reviewTimeLeft(Date.now() - 60_000)).toMatch(/still approve/);
  });
});
