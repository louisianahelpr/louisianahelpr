/**
 * THE 30-MINUTE WAIT, ON THE COLLAPSED CARD, AND THE BUTTON'S ONE NAME (audit 2026-10-30).
 *
 * Owner, 2026-10-08: "mark job complete should be greyed out until its available in the 30 min". The Working card's
 * button was greyed; the collapsed card's and the job page's read a solid, live "Mark done", and pressing it just
 * opened the card to a greyed button. The same control also had two names ("Mark done", "Mark job complete").
 *
 * The real card, the real face and the real hook; the job page's half is in jobPage/JobPage.test.tsx.
 *
 * @mutate src/pages/jobs/AppliedJobCard.tsx |     doneFloorMinutes,\n |
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts | label: "Mark job complete" }; | label: "Mark done" };
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts | step: step.key, disabled: true, note: | step: step.key, note:
 * @mutate src/components/job-card/MineJobFace.tsx |       <MineFaceNote note={action?.note} className="order-3 mt-1 md:order-none md:basis-full md:mt-0 md:text-right" />\n |
 * AUD31-78 (audit 10-31): the open Working card's "Available in 1 min" line stayed for up to a minute after
 * Mark job complete turned on (ActiveJobSection re-read the clock only every 60 s). It now also wakes at the unlock.
 * @mutate src/pages/jobs/appliedJobCard/ActiveJobSection.tsx |     const atUnlock = setTimeout(() => setNow(Date.now()), Math.max(0, payoutUnlocksAt - Date.now()) + 50); |     const atUnlock = setTimeout(() => {}, 0);
 * @mutate src/components/job-card/useDoneFloor.ts |     const t = setInterval(() => tick((n) => n + 1), 30_000); |     const t = setInterval(() => {}, 30_000);
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { AppliedApp, Job } from "../../components/job-card/activityConstants";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useUnsettledDisputeJobIds", () => ({ useUnsettledDisputeJobIds: () => undefined }));
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null, helperDayOfConfirmation: () => true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/components/schedule/ScheduleChangeControl", () => ({ ScheduleChangeControl: () => null, ScheduleChangeAskDialog: () => null, usePendingScheduleChange: () => ({ data: null }) }));
vi.mock("@/components/series/SeriesDatesPanel", () => ({ SeriesDatesPanel: () => null }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn(), hapticImpactForce: vi.fn() }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/pages/jobs/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null, PhotoProofCaptureChip: () => null }));
vi.mock("../../components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

import { AppliedJobCard } from "./AppliedJobCard";
import { useDoneFloorMinutesLeft } from "@/components/job-card/useDoneFloor";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { pinJobClock } from "@/test/helpers/pinJobClock";

// A job dated today with a literal start runs on a pinned clock (jobDayFixtureTimezone); re-pinned after each test.
pinJobClock();

afterEach(() => { cleanup(); vi.useRealTimers(); pinJobClock(); });

function card(arrivedMinutesAgo: number, toggle = vi.fn(), expanded = false) {
  const arrived = new Date(Date.now() - arrivedMinutesAgo * 60_000).toISOString();
  const job = {
    id: "job-1", title: "Pressure wash the driveway", description: "Front driveway.", category: "cleaning", budget: 120,
    status: "in_progress", customer_id: "poster-1", helper_id: "helper-1", location: "3419 Magazine St, New Orleans, LA 70115",
    date_needed: jobLocalDateISO(0), start_time: "09:00", payment_status: "escrow",
    helper_confirmed_at: arrived, helper_dayof_confirmed_at: arrived, poster_confirmed_at: arrived,
    helper_on_the_way_at: arrived, helper_arrived_at: arrived, poster_confirmed_arrival_at: arrived,
    require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
  } as unknown as Job;
  const app = { id: "app-1", job_id: "job-1", helper_id: "helper-1", status: "accepted", closed_reason: null, posterName: "Poster P", job } as unknown as AppliedApp;
  const noop = () => {};
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
    <MemoryRouter>
      <AppliedJobCard
        app={app}
        expandedJobIds={new Set(expanded ? ["job-1"] : [])}
        toggleExpandedJobId={toggle}
        helperReviewedJobIds={new Set()}
        userId="helper-1"
        initialTracking={{ id: "t", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: arrived }}
        onHelperResponse={noop}
        respondingHelperAppId={null}
        onComplete={noop}
        completingJobId={null}
        onResolveRevision={noop}
        onHelperReview={noop}
        onDispute={noop}
        onViewDispute={noop}
        onRefresh={noop}
        disputeResponse=""
        setDisputeResponse={noop}
        respondingJobId={null}
        setRespondingJobId={noop}
        submittingResponse={false}
        setSubmittingResponse={noop}
        withdrawingAppId={null}
        setWithdrawTarget={noop}
        uploadingAttachment={null}
        editingMessageAppId={null}
        setEditingMessageAppId={noop}
        editMessageText=""
        setEditMessageText={noop}
        savingMessage={false}
        handleSaveMessage={noop}
        handleAddAttachment={noop}
        handleRemoveAttachment={noop}
      />
    </MemoryRouter>
    </QueryClientProvider>,
  );
  return toggle;
}

describe("the collapsed Working card during the 30-minute wait", () => {
  it("is greyed, says when it turns on, and a press opens nothing", () => {
    const toggle = card(10);
    const face = screen.getByRole("button", { name: "Mark job complete" }) as HTMLButtonElement;
    expect(face.disabled).toBe(true);
    expect(screen.getByText("Available in 20 min — 30 minutes after you arrived, to ensure quality.")).toBeTruthy();
    fireEvent.click(face);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("after the 30 minutes it is live, with no note, and a press opens the card", () => {
    const toggle = card(31);
    const face = screen.getByRole("button", { name: "Mark job complete" }) as HTMLButtonElement;
    expect(face.disabled).toBe(false);
    expect(document.querySelector("[data-mine-face-note]")).toBeNull();
    fireEvent.click(face);
    expect(toggle).toHaveBeenCalled();
  });
});

describe("AUD31-78: the open Working card's wait line goes when the button turns on", () => {
  it("arrived 29.5 min ago: 'Available in 1 min', and 31 s later the line is gone", () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    card(29.5, vi.fn(), true);
    expect(screen.getAllByText(/^Available in 1 min/).length).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(screen.queryAllByText(/^Available in/)).toEqual([]);
  });
});

describe("useDoneFloorMinutesLeft", () => {
  it("counts down on its own and reaches 0 at the end of the 30 minutes", () => {
    vi.useFakeTimers();
    const start = new Date(Date.now() - 10 * 60_000).toISOString();
    const { result } = renderHook(() => useDoneFloorMinutesLeft(start));
    expect(result.current).toBe(20);
    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(result.current).toBe(15);
    act(() => { vi.advanceTimersByTime(15 * 60_000 + 1_000); });
    expect(result.current).toBe(0);
  });

  it("no stamp, no wait", () => {
    const { result } = renderHook(() => useDoneFloorMinutesLeft(null));
    expect(result.current).toBe(0);
  });
});

describe("the control has one name", () => {
  it('no button in the app is labelled "Mark done"', () => {
    const files = execFileSync("git", ["ls-files", "src/pages", "src/components"], { encoding: "utf8" })
      .trim().split("\n").filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(500);
    const hits = files.filter((f) => /["'>`]\s*Mark done\s*["'<`]/.test(blankComments(readFileSync(f, "utf8"))));
    expect(hits).toEqual([]);
  });
});
