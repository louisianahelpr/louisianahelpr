/**
 * Boards 14 and 21 (lead 2026-10-20): a Posted / Working card is a FACE —
 * thumb, title, date · time, one status line, money on the right — that opens
 * the job page when tapped, with exactly ONE button: the card's real next step
 * ("Review N applicants", "Confirm arrival", "Approve and release", "Leave a
 * review"), or "Manage job" when the next step is only waiting. The card's full
 * controls (tracker, More, Report, SOS) stay one tap away, in place.
 *
 * RED before this branch: the poster card had no link to /jobs/:id, no
 * `[data-mine-face-action]`, and a tap on it toggled the card in place.
 *
 * Money: "Approve and release" opens the card and its completion sheet (the
 * sheet is the confirmation); it never calls onComplete itself.
 *
 * @mutate src/components/job-card/MineJobFace.tsx |           {buttonLabel(action.label)} |           {action.label}
 * @mutate src/components/job-card/MineJobFace.tsx | to={`/jobs/${encodeURIComponent(jobId)}`} | to="/posts"
 * @mutate src/pages/posts/PostedJobCard.tsx | action={isExpanded ? null : faceAction} | action={faceAction}
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | openApplicants: () => a.onLoadApplications(job), | openApplicants: () => {},
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | confirmArrival: () => a.onConfirmArrival(job.id), | confirmArrival: () => toggle(job.id),
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | h.confirmingArrival ? "Confirming…" : "Confirm they've arrived", | h.confirmingArrival ? "Confirming…" : "Confirm arrival",
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | if (!a.isExpanded) toggle(job.id);\n      setCompletionRequest | void 0;\n      setCompletionRequest
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | return { label: "Leave a review", onClick: h.review, tone: "primary" }; | return { label: "Manage job", onClick: h.manage, tone: "secondary" };
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | return { label: `Message ${first(h.helperName)}`, onClick: h.message, tone: "secondary" }; | return { label: `Message ${first(h.helperName)}`, onClick: h.message, tone: "primary" };
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts | if (s.isMinimalCard \|\| s.isOffered) return null; | if (s.isMinimalCard) return null;
 * @mutate src/pages/posts/PostedJobCard.tsx | expandable={false}\n            expanded={isExpanded} | expandable\n            expanded={isExpanded}
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Job } from "@/components/job-card/activityConstants";
import { POSTER_WAIT_IDS } from "@/components/job-card/jobStatusLine";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import { helperFaceAction } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false })); // no QueryClient here
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("@/hooks/useUnsettledDisputeJobIds", () => ({ useUnsettledDisputeJobIds: () => undefined }));
vi.mock("@/hooks/useCurrentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCurrentUser")>()),
  useCurrentUser: () => ({ profile: null }),
}));
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null }));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/pages/posts/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/job-card/JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("@/pages/posts/postedJobCard/PostedJobApplicants", () => ({ PostedJobApplicants: () => null }));
vi.mock("@/pages/posts/postedJobCard/PostedJobActions", () => ({ PostedJobActions: () => <div data-testid="step-row" /> }));
vi.mock("@/components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/components/schedule/ScheduleChangeControl", () => ({
  ScheduleChangeControl: () => null,
  ScheduleChangeAskDialog: () => null,
  usePendingScheduleChange: () => ({ data: null }),
}));
vi.mock("@/components/series/SeriesDatesPanel", () => ({ SeriesDatesPanel: () => null }));

import { PostedJobCard } from "@/pages/posts/PostedJobCard";

const base = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: "Lafayette, LA",
  date_needed: jobLocalDateISO(0),
  payment_status: "escrow",
  status: "in_progress",
  helper_confirmed_at: "2026-09-19T12:00:00Z",
  helper_arrived_at: "2026-09-19T14:00:00Z",
  poster_confirmed_arrival_at: null,
  poster_confirmed_working_at: null,
  helper_completed_at: null,
  photos: [],
} as unknown as Job;

function renderCard(
  job: Job,
  opts: { expanded?: boolean; pending?: number; meta?: Record<string, { tipped: boolean; reviewed: boolean }> } = {},
) {
  const h = {
    toggle: vi.fn(),
    onConfirmArrival: vi.fn(),
    onLoadApplications: vi.fn(),
    onComplete: vi.fn(),
    onReview: vi.fn(),
    onTip: vi.fn(),
  };
  render(
    <MemoryRouter>
      <PostedJobCard
        job={job}
        applicantCounts={{ [job.id]: opts.pending ?? 0 }}
        pendingApplicantCounts={{ [job.id]: opts.pending ?? 0 }}
        expandedJobIds={new Set(opts.expanded ? [job.id] : [])}
        toggleExpandedJobId={h.toggle}
        helperNames={{ "helper-1": "Hallie H." }}
        helperAvatars={{ "helper-1": null }}
        completedJobMeta={opts.meta ?? {}}
        userId="poster-1"
        onBoost={() => {}} onEdit={() => {}} onCancel={() => {}} onComplete={h.onComplete} completingJobId={null}
        onNoShow={() => {}} onTip={h.onTip} onReview={h.onReview} onDispute={() => {}} onReport={() => {}}
        onViewDispute={() => {}} onConfirmArrival={h.onConfirmArrival} confirmingArrivalJobId={null}
        onConfirmWorking={() => {}} confirmingWorkingJobId={null}
        onLoadApplications={h.onLoadApplications} onLoadInlineApplicants={() => {}}
        inlineApplicants={{}} loadingApplicants={{}} applicantErrors={{}}
        onActionComplete={() => {}}
      />
    </MemoryRouter>,
  );
  return h;
}

const faceButtons = () => [...document.querySelectorAll("[data-mine-face-action]")] as HTMLButtonElement[];

describe("the Posted card face (board 14)", () => {
  it("opens the job page: the face is a link to /jobs/:id, and the card itself no longer toggles", () => {
    const h = renderCard(base);
    const link = document.querySelector("[data-mine-face-open]") as HTMLAnchorElement;
    expect(link, "no link on the card face").not.toBeNull();
    expect(link.getAttribute("href")).toBe("/jobs/job-1");
    fireEvent.click(document.querySelector("[data-activity-card]")!);
    expect(h.toggle, "a tap on the card still expands it in place").not.toHaveBeenCalled();
  });

  it("has exactly ONE button, and the poster sees their budget, never a take-home", () => {
    renderCard(base);
    expect(faceButtons()).toHaveLength(1);
    expect(document.querySelector("[data-mine-face-money]")?.textContent).toBe("$120");
    expect(document.body.textContent).not.toMatch(/take home/i);
  });

  it("Confirm arrival runs the poster's real arrival handler", () => {
    const h = renderCard(base);
    const [btn] = faceButtons();
    // Owner 11-01: the button reads just "Confirm"; its name keeps the full words.
    expect(btn.textContent).toBe("Confirm");
    expect(btn.getAttribute("aria-label")).toBe("Confirm they've arrived");
    fireEvent.click(btn);
    expect(h.onConfirmArrival).toHaveBeenCalledWith("job-1");
  });

  it("Review N applicants opens the applicants panel", () => {
    const open = { ...base, status: "open", helper_id: null, helper_confirmed_at: null, helper_arrived_at: null } as unknown as Job;
    const h = renderCard(open, { pending: 3 });
    const [btn] = faceButtons();
    expect(btn.textContent).toBe("Review 3 applicants");
    fireEvent.click(btn);
    expect(h.onLoadApplications).toHaveBeenCalledTimes(1);
  });

  it("Approve and release opens the card and its sheet; it never releases the money itself", () => {
    const done = { ...base, helper_completed_at: "2026-09-19T16:00:00Z" } as unknown as Job;
    const h = renderCard(done);
    const [btn] = faceButtons();
    expect(btn.textContent).toBe("Approve and release");
    fireEvent.click(btn);
    expect(h.toggle).toHaveBeenCalledWith("job-1");
    expect(h.onComplete).not.toHaveBeenCalled();
  });

  it("Leave a review on a finished job with the review still open", () => {
    const fin = { ...base, status: "completed", payment_status: "released", poster_completed_at: new Date().toISOString() } as unknown as Job;
    const h = renderCard(fin, { meta: { "job-1": { tipped: true, reviewed: false } } });
    const [btn] = faceButtons();
    expect(btn.textContent).toBe("Leave a review");
    fireEvent.click(btn);
    expect(h.onReview).toHaveBeenCalledTimes(1);
  });

  it("only waiting: the quiet fallback is 'Message <name>', with a small Manage job link that opens the controls in place (owner, 2026-10-23, card critique item 13)", () => {
    const waiting = { ...base, status: "accepted", helper_confirmed_at: null, helper_arrived_at: null } as unknown as Job;
    const h = renderCard(waiting);
    const [btn] = faceButtons();
    expect(btn.textContent).toMatch(/^Message /);
    expect(btn.getAttribute("data-mine-face-action")).toBe("secondary");
    const manage = document.querySelector("[data-mine-face-also]") as HTMLButtonElement;
    expect(manage.textContent).toBe("More options");
    fireEvent.click(manage);
    expect(h.toggle).toHaveBeenCalledWith("job-1");
  });

  it("open: the face drops its button (the step row carries the action) and offers the chevron by the title", () => {
    const h = renderCard(base, { expanded: true });
    expect(faceButtons()).toHaveLength(0);
    expect(screen.getByTestId("step-row")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Close / }));
    expect(h.toggle).toHaveBeenCalledWith("job-1");
  });
});

describe("every poster state has a face button", () => {
  const h = {
    pendingApplicants: 2, helperName: "Hallie H.", confirmingArrival: false, completing: false,
    openApplicants: vi.fn(), confirmArrival: vi.fn(), approve: vi.fn(), review: vi.fn(), tip: vi.fn(), postAgain: vi.fn(), message: vi.fn(), manage: vi.fn(),
    confirm: vi.fn(), noShow: vi.fn(), cancel: vi.fn(), viewDispute: vi.fn(),
  };
  it("the inventory is real", () => expect(POSTER_WAIT_IDS.length).toBeGreaterThan(20));
  it("a stalled job (Needs you) offers Message, never a release the poster cannot make", () => {
    const a = posterFaceAction("stalled", { is_group_job: false }, h);
    expect(a.label).toBe("Message Hallie");
    expect(a.tone, "a long Needs-you list must not stack filled primaries").toBe("secondary");
    a.onClick();
    expect(h.message).toHaveBeenCalledTimes(1);
  });
  it.each(POSTER_WAIT_IDS)("%s", (id) => {
    const a = posterFaceAction(id, { is_group_job: false }, h);
    expect(a.label.trim().length).toBeGreaterThan(0);
    // Sentence case: only the first letter (and a name) may be capitalised.
    expect(a.label).not.toMatch(/ (And|Job|Applicants?|Review|Arrival|Again)\b/);
  });
});

describe("the Working card's one button (board 21)", () => {
  const s = { review: vi.fn(), manage: vi.fn() };
  it("an offer draws none: Accept / Decline already sit on the card", () => {
    expect(helperFaceAction({ ...s, isMinimalCard: false, isOffered: true, owesReview: false })).toBeNull();
  });
  it("not picked or cancelled: none", () => {
    expect(helperFaceAction({ ...s, isMinimalCard: true, isOffered: false, owesReview: false })).toBeNull();
  });
  it("a review owed: Leave a review, else Manage job", () => {
    expect(helperFaceAction({ ...s, isMinimalCard: false, isOffered: false, owesReview: true, posterId: "poster-1" })?.label).toBe("Leave a review");
    expect(helperFaceAction({ ...s, isMinimalCard: false, isOffered: false, owesReview: false })?.label).toBe("Manage job");
  });
});
