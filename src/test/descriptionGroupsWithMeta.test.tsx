/**
 * THE DESCRIPTION READS WITH THE META LINE, NOT WITH THE TRACKER — BOTH CARDS.
 *
 * Owner, 2026-09-19, quoting a job's own brief back: "Four crepe myrtles along
 * the driveway plus one hedge line. Bring your own loppers; haul-off included.
 * should be under the location date and time on expansion. not with the live
 * tracker box."
 *
 * ── WHAT THE INVESTIGATION FOUND, AND WHY THIS IS A SPACING TEST ──────────
 * The description was ALREADY under the meta row in document order, on both
 * cards. Moving it would have been "fixing" something that was not broken —
 * and would not have addressed the complaint, because the complaint was about
 * what the block reads AS.
 *
 * What was actually wrong was PROXIMITY, and the numbers said it plainly:
 *
 *   meta -> description    10px (title bar `pb-2.5`) + 10px (body `pt-2.5`) = 20px
 *   description -> tracker  8px (`space-y-2`)
 *
 * The brief sat twice as far from the line it belongs to as from the block it
 * does not. Gestalt does the rest: it read as the tracker's caption. Inverted
 * now, with no element moved and nothing added:
 *
 *   meta -> description    10px + 4px (`pt-1`)   = 14px
 *   description -> tracker  8px + 12px (`pt-3`)  = 20px
 *
 * ── WHY IT ASSERTS THE INEQUALITY, NOT THE PIXELS ─────────────────────────
 * The rule is "closer to the meta than to the tracker", not "14 and 20". A
 * test pinning the two constants would fail on any future spacing pass that
 * kept the relationship the owner asked for — and would pass on a pass that
 * doubled both and destroyed it. The inequality IS the design.
 *
 * jsdom computes no layout, so the gaps are resolved from the rendered
 * Tailwind classes through the spacing scale. That is a real value, not a
 * class-name match: `pt-1` and `pt-3` become 4 and 12 and are compared as
 * numbers.
 *
 * @mutate src/components/activity/PostedJobCard.tsx | <div className="px-4 pt-1 pb-2.5 space-y-2" data-job-card-body=""> | <div className="px-4 pt-2.5 pb-2.5 space-y-2" data-job-card-body="">
 * @mutate src/components/activity/PostedJobCard.tsx | <div className="pt-3" data-job-card-tracker-gap=""> | <div className="pt-0" data-job-card-tracker-gap="">
 * @mutate src/components/activity/AppliedJobCard.tsx | className={`px-4 pt-1 space-y-2 ${ | className={`px-4 pt-4 space-y-2 ${
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "@/components/activity/activityConstants";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => null, PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  PhotoProofCaptureChip: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null, helperDayOfConfirmation: () => true }));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/components/activity/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/activity/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/activity/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/hooks/useFundExistingJob", () => ({ useFundExistingJob: () => ({ fundJob: vi.fn(), fundingJobId: null }) }));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import { AppliedJobCard } from "@/components/activity/AppliedJobCard";
import { PostedJobCard } from "@/components/activity/PostedJobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

/** Tailwind's spacing scale, in px. `pt-2.5` -> 10. */
function spacingPx(token: string): number {
  const n = Number(token);
  expect(Number.isFinite(n), `"${token}" is not a spacing-scale value`).toBe(true);
  return n * 4;
}

/** The px value of one padding class on an element, or 0 when absent. */
function padPx(el: Element, side: "t" | "b"): number {
  const m = new RegExp(`(?:^|\\s)p${side}-([\\d.]+)(?:\\s|$)`).exec(el.className);
  if (!m) {
    const both = /(?:^|\s)py-([\d.]+)(?:\s|$)/.exec(el.className);
    return both ? spacingPx(both[1]) : 0;
  }
  return spacingPx(m[1]);
}

const HELPER = "helper-1";
const POSTER = "poster-1";
const DESCRIPTION = "Four crepe myrtles along the driveway plus one hedge line.";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const noop = () => {};

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

const baseJob = {
  id: "job-1", title: "Trim the crepe myrtles", description: DESCRIPTION,
  category: "yard_work", budget: 120, status: "in_progress",
  customer_id: POSTER, helper_id: HELPER, location: "Lafayette, LA",
  date_needed: jobLocalDateISO(0), start_time: "09:00", payment_status: "escrow",
  helper_confirmed_at: ago(48), helper_dayof_confirmed_at: ago(30),
  poster_confirmed_at: ago(47), helper_on_the_way_at: ago(7), helper_arrived_at: ago(6),
  proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
} as unknown as Job;

/**
 * The gap the description has ABOVE it (to the meta line, which lives in the
 * title bar) and BELOW it (to whatever the card puts next).
 *
 * Above  = the title bar's bottom padding + the body block's top padding.
 * Below  = `space-y-2`'s 8px + any extra padding on the block that follows.
 */
const SPACE_Y_2 = 8;

function gapsAroundDescription(): { above: number; below: number } {
  const body = document.querySelector("[data-job-card-body]")!;
  const titleBar = body.previousElementSibling!;
  const above = padPx(titleBar, "b") + padPx(body, "t");
  // The block that follows the description inside the same `space-y-2` group,
  // or (on the helper card, where the tracker is a later sibling of the body)
  // the body's own bottom padding.
  const gap = document.querySelector("[data-job-card-tracker-gap]");
  const below = gap ? SPACE_Y_2 + padPx(gap, "t") : SPACE_Y_2 + padPx(body, "b");
  return { above, below };
}

describe("Posts: the brief groups with the meta line, not with the tracker", () => {
  it("is closer to the meta above it than to the block below it", () => {
    wrap(
      <PostedJobCard
        job={baseJob} applicantCounts={{}} expandedJobIds={new Set([baseJob.id])}
        toggleExpandedJobId={noop} helperNames={{ [HELPER]: "Hallie H." }}
        helperAvatars={{ [HELPER]: null }} completedJobMeta={{}} userId={POSTER}
        onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
        onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop}
        onReport={noop} onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
        onConfirmWorking={noop} confirmingWorkingJobId={null} onLoadApplications={noop}
        onLoadInlineApplicants={noop} inlineApplicants={{}} loadingApplicants={{}}
        applicantErrors={{}} onActionComplete={noop}
      />,
    );
    expect(screen.getByText(DESCRIPTION), "the fixture stopped rendering a description").toBeInTheDocument();
    const { above, below } = gapsAroundDescription();
    expect(
      above,
      `the brief sits ${above}px below the meta line and ${below}px above the tracker. ` +
        `Owner, 2026-09-19: it "should be under the location date and time... not with the ` +
        `live tracker box" — so it has to be nearer the thing it belongs to.`,
    ).toBeLessThan(below);
  });
});

describe("Jobs: the same grouping, on the other card", () => {
  it("is closer to the meta above it than to the section below it", () => {
    const app = {
      id: "app-1", job_id: "job-1", helper_id: HELPER, status: "accepted",
      posterName: "Pierre B.", created_at: ago(72), job: baseJob,
    } as unknown as AppliedApp;
    wrap(
      <AppliedJobCard
        app={app} expandedJobIds={new Set(["job-1"])} toggleExpandedJobId={noop}
        helperReviewedJobIds={new Set()} userId={HELPER}
        onHelperResponse={noop} respondingHelperAppId={null}
        onComplete={noop} completingJobId={null} onResolveRevision={noop}
        onHelperReview={noop} onDispute={noop} onViewDispute={noop} onRefresh={noop}
        disputeResponse="" setDisputeResponse={noop} respondingJobId={null}
        setRespondingJobId={noop} submittingResponse={false} setSubmittingResponse={noop}
        withdrawingAppId={null} setWithdrawTarget={noop} uploadingAttachment={null}
        editingMessageAppId={null} setEditingMessageAppId={noop} editMessageText=""
        setEditMessageText={noop} savingMessage={false} handleSaveMessage={noop}
        handleAddAttachment={noop} handleRemoveAttachment={noop}
      />,
    );
    expect(screen.getByText(DESCRIPTION), "the fixture stopped rendering a description").toBeInTheDocument();
    const { above, below } = gapsAroundDescription();
    expect(
      above,
      `the brief sits ${above}px below the meta line and ${below}px above the next block. ` +
        `Both cards take the same regrouping — "these changes all apply to jobs also".`,
    ).toBeLessThan(below);
  });
});
