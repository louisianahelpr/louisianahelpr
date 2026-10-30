/**
 * LIVE BUG (reproduced on prod 2026-10-29): Posted > Done showed "Leave a review" on a job whose Helpr had deleted
 * their account (jobs.helper_id NULL, jobs_helper_id_fkey ON DELETE SET NULL). The face's handler,
 * openReviewForPosted (useLifecycleHandlers), returns early on a NULL helper, so the button did nothing. The same
 * state offered "Tip <name>" for nobody. CompletedStep's canReview already refused it (AL-009); the face did not.
 *
 * THE CLASS: a face button never offers a Review or a Tip without a counterpart to receive it, on either side.
 * Poster: derivePosterWait (the ONE state id the status line and the face button both read) opens a loose end only
 * when there is someone to review/tip: the hired Helpr on a solo job, an unreviewed member on a crew. Helpr:
 * helperFaceAction offers its review only with the poster's id, and hands that id to the handler.
 * Every completion combination x counterpart present/absent x solo/crew is walked, both ways.
 *
 * @mutate src/components/job-card/jobStatusLine.ts | if (completion && hasCounterpart(job, completion) && !(completion.tipped && completion.reviewed)) { | if (completion && !(completion.tipped && completion.reviewed)) {
 * @mutate src/components/job-card/jobStatusLine.ts |   if (job.is_group_job) return (completion.crewToReview?.length ?? 0) > 0 \|\| completion.reviewed; |   if (job.is_group_job) return true;
 * @mutate src/components/job-card/jobStatusLine.ts |   return !!job.helper_id; |   return true;
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |   if (s.owesReview && posterId) | if (s.owesReview)
 */
import { describe, expect, it, vi } from "vitest";
import { derivePosterWait, type PosterWait } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import { helperFaceAction } from "@/pages/jobs/appliedJobCard/helperFaceAction";

const HELPER = "11111111-1111-4111-8111-111111111111";
const POSTER = "22222222-2222-4222-8222-222222222222";

const doneJob = (over: Record<string, unknown>) =>
  ({
    id: "job-1",
    title: "Pressure wash the driveway",
    status: "completed",
    payment_status: "released",
    customer_id: POSTER,
    helper_id: HELPER,
    is_group_job: false,
    poster_completed_at: new Date().toISOString(),
    ...over,
  }) as unknown as Job;

const handlers = () => ({
  pendingApplicants: 0, helperName: "Former member", confirmingArrival: false, completing: false,
  openApplicants: vi.fn(), confirmArrival: vi.fn(), approve: vi.fn(), review: vi.fn(), tip: vi.fn(), postAgain: vi.fn(),
  message: vi.fn(), manage: vi.fn(), confirm: vi.fn(), noShow: vi.fn(), cancel: vi.fn(), viewDispute: vi.fn(), tipsReady: true,
});

const LOOSE_ENDS: ReadonlySet<PosterWait> = new Set(["done_tip_open", "done_review_open", "done_both_open"]);
const offersReviewOrTip = (label: string) => label === "Leave a review" || /^Tip /.test(label);

type Case = { name: string; job: Job; completion: { tipped: boolean; reviewed: boolean; crewToReview?: Array<{ id: string; name: string }> }; counterpart: boolean };

const combos = [
  { tipped: false, reviewed: false },
  { tipped: true, reviewed: false },
  { tipped: false, reviewed: true },
];
const CASES: Case[] = [];
for (const c of combos) {
  CASES.push({ name: `solo, Helpr deleted, ${JSON.stringify(c)}`, job: doneJob({ helper_id: null }), completion: c, counterpart: false });
  CASES.push({ name: `solo, Helpr present, ${JSON.stringify(c)}`, job: doneJob({}), completion: c, counterpart: true });
  // A crew whose every member deleted their account: useActivityData leaves crewToReview [] and reviewed false.
  CASES.push({ name: `crew, every member deleted, ${JSON.stringify(c)}`, job: doneJob({ is_group_job: true, helper_id: null }), completion: { ...c, reviewed: false, crewToReview: [] }, counterpart: false });
  CASES.push({ name: `crew, a member left to review, ${JSON.stringify(c)}`, job: doneJob({ is_group_job: true, helper_id: null }), completion: { ...c, reviewed: false, crewToReview: [{ id: HELPER, name: "Hallie H." }] }, counterpart: true });
}
// A crew reviewed in full (crewToReview [] but reviewed true: there were members) still owes its tip.
CASES.push({ name: "crew, every member reviewed, tip open", job: doneJob({ is_group_job: true, helper_id: null }), completion: { tipped: false, reviewed: true, crewToReview: [] }, counterpart: true });

describe("the face never offers a Review or a Tip with nobody to receive it", () => {
  it("the inventory is real", () => {
    expect(CASES.length).toBeGreaterThan(10);
    expect(CASES.filter((c) => !c.counterpart).length).toBeGreaterThan(4);
  });

  it.each(CASES)("poster: $name", ({ job, completion, counterpart }) => {
    const wait = derivePosterWait(job, 0, new Date(), completion);
    const face = posterFaceAction(wait, job, handlers());
    if (counterpart) {
      // Two-way: with someone to receive it, the loose end is still the card's state.
      expect(LOOSE_ENDS.has(wait), `${wait}`).toBe(true);
    } else {
      expect(LOOSE_ENDS.has(wait), `${wait} names a loose end nobody can close`).toBe(false);
      expect(offersReviewOrTip(face.label), `face offered "${face.label}"`).toBe(false);
    }
  });

  it("poster: a deleted Helpr's finished job reads as finished (paid or payout pending), not as owed", () => {
    expect(derivePosterWait(doneJob({ helper_id: null }), 0, new Date(), { tipped: false, reviewed: false })).toBe("done_paid");
    expect(derivePosterWait(doneJob({ helper_id: null, payment_status: "payout_pending" }), 0, new Date(), { tipped: false, reviewed: false })).toBe("done_payout_pending");
  });

  it("Helpr: no review offered when the poster's account is gone, and the handler gets the poster's id when it is there", () => {
    const review = vi.fn();
    const base = { isMinimalCard: false, isOffered: false, owesReview: true, review, manage: vi.fn() };
    const gone = helperFaceAction({ ...base, posterId: null });
    expect(gone?.label).not.toBe("Leave a review");
    const there = helperFaceAction({ ...base, posterId: POSTER });
    expect(there?.label).toBe("Leave a review");
    there!.onClick();
    expect(review).toHaveBeenCalledWith(POSTER);
  });
});
