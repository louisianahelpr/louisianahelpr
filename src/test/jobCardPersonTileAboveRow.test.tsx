/**
 * THE OTHER PARTY'S PROFILE SITS DIRECTLY ABOVE THE ACTION ROW — ON BOTH CARDS.
 *
 * Owner, 2026-09-19: "also the helpr or posted by should be right above the
 * buttons", and then, on the whole batch: "these changes all apply to jobs
 * also". So this is one rule with two proofs — `/my-posts` (PostedJobCard,
 * eyebrow "Helpr") and `/my-jobs` (AppliedJobCard, eyebrow "Posted by").
 *
 * ── WHY THIS ASSERTS POSITION AND NOT PRESENCE ────────────────────────────
 * The tile has now occupied THREE positions in five days — the meta row
 * (pre-VN-22), the card body under the description (VN-22, 2026-09-14), inside
 * the tracker between the rail and the map (2026-09-16), and now above the
 * row. Every one of those moves was made while a test asserting "the tile is on
 * the card" stayed green, because such a test passes wherever the tile sits.
 * `compareDocumentPosition` against `[data-job-step-row]` is the assertion that
 * can actually fail when somebody moves it again.
 *
 * ── AND WHY IT ALSO COUNTS ────────────────────────────────────────────────
 * The standing rule with it is the owner's "the name only needs to show once".
 * Both cards keep a FALLBACK copy for the states that draw no action row at all
 * (a cancelled post, a pending or not-selected application), so "exactly one"
 * is a real invariant with a real way to break: the shell and the fallback both
 * rendering. It is enforced by a CLAIM rather than by two files agreeing about
 * which statuses have a row (jobCardPerson.tsx) — this file is the proof that
 * the claim works, in the tracker states AND the no-row states.
 *
 * ── AND THAT IT IS NOT THERE AT ALL WHEN COLLAPSED (V6) ───────────────────
 * Owner, 2026-09-15 and again 2026-09-19. The helper's card is the harder side:
 * it mounts its tracker on a COLLAPSED card while the poster's does not, so a
 * gate that rode on the tracker would have printed the poster's name on every
 * collapsed Jobs card. Both sides are checked collapsed here.
 *
 * @mutate src/components/activity/JobStepCard.tsx | {personTile}\n        <div\n          ref={rowRef} | <div\n          ref={rowRef}
 * @mutate src/components/activity/jobCardPerson.tsx | return present ? tile : null; | return null;
 * @mutate src/components/activity/PostedJobCard.tsx | {!stepCarriesTile && helperTile} | {helperTile}
 * @mutate src/components/activity/AppliedJobCard.tsx | const bodyCarriesTile = !stepCarriesTile && posterTile !== null; | const bodyCarriesTile = posterTile !== null;
 * @mutate src/components/activity/AppliedJobCard.tsx | const posterTile =\n    isExpanded && posterId && app.posterName ? ( | const posterTile =\n    posterId && app.posterName ? (
 *
 * A NOTE ON WHAT THE MUTATIONS PROVE, because the two cards are NOT symmetric
 * here and one of them says so out loud. Dropping `isExpanded` from the tile on
 * the HELPER card kills this file — its step cards render on a collapsed card,
 * so that gate is the only thing holding V6. Dropping it on the POSTER card
 * does NOT kill, and that is correct rather than a hole: every render site on
 * that card (the step card and the body fallback) already sits behind
 * `isExpanded`, so the gate there is defence-in-depth for the NEXT time the
 * tile moves. The poster-side mutation therefore targets the mechanism that IS
 * load-bearing on that card — the fallback standing down when the shell has
 * claimed the tile, i.e. the "exactly once" rule.
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
  PhotoProofGroup: () => null,
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  PhotoProofCaptureChip: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
/* The tracker is stubbed to a marker, not to nothing: the tile used to live
   INSIDE it, so a stub that rendered nothing would make "the tile is not in the
   tracker" true by construction. This one is a real element the position
   assertions below can be measured against. */
/* PARTIAL MOCK, not a replacement. Only the <JobTracking> COMPONENT is stubbed
   (it opens a realtime channel and runs queries). Its pure exports —
   `deriveCurrentStatusIdx`, `railStepLabels`, `railDisplayIdx` — are the real
   ones, because the collapsed card's compact rail (owner, 2026-09-19) computes
   its dots from them. A mock that dropped them made every card throw, which is
   a truthful failure: the card genuinely needs that derivation now. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
  deriveCurrentStatusIdx: () => 0,
  STATUS_IDX: { assigned: 0, confirmed: 1, job_confirmed: 2, on_the_way: 3, arrived: 4, working: 5, done: 6 },
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  helperDayOfConfirmation: () => true,
}));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/components/activity/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/activity/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/activity/JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("@/components/activity/postedJobCard/PostedJobApplicants", () => ({ PostedJobApplicants: () => null }));
vi.mock("@/hooks/useFundExistingJob", () => ({ useFundExistingJob: () => ({ fundJob: vi.fn(), fundingJobId: null }) }));
vi.mock("@/components/activity/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

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

import { PostedJobCard } from "@/components/activity/PostedJobCard";
import { AppliedJobCard } from "@/components/activity/AppliedJobCard";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const POSTER = "poster-1";
const HELPER = "helper-1";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const noop = () => {};

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseJob = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  status: "in_progress",
  customer_id: POSTER,
  helper_id: HELPER,
  location: "Lafayette, LA",
  date_needed: "2026-09-20",
  start_time: "09:00",
  payment_status: "escrow",
  helper_confirmed_at: ago(48),
  helper_dayof_confirmed_at: ago(30),
  poster_confirmed_at: ago(47),
  helper_on_the_way_at: ago(7),
  helper_arrived_at: ago(6),
  proof_before_urls: ["b.jpg"],
  proof_after_urls: ["a.jpg"],
} as unknown as Job;

function renderPosted(job: Job, expanded: boolean) {
  return wrap(
    <PostedJobCard
      job={job}
      applicantCounts={{}}
      expandedJobIds={new Set(expanded ? [job.id] : [])}
      toggleExpandedJobId={noop}
      helperNames={{ [HELPER]: "Hallie H." }}
      helperAvatars={{ [HELPER]: null }}
      completedJobMeta={{}}
      userId={POSTER}
      onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
      onRevision={noop} onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
      onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
      onConfirmWorking={noop} confirmingWorkingJobId={null}
      onLoadApplications={noop} onLoadInlineApplicants={noop}
      inlineApplicants={{}} loadingApplicants={{}} applicantErrors={{}}
      onActionComplete={noop}
    />,
  );
}

function renderApplied(app: AppliedApp, expanded: boolean) {
  return wrap(
    <AppliedJobCard
      app={app}
      expandedJobIds={new Set(expanded ? [app.job_id] : [])}
      toggleExpandedJobId={noop}
      helperReviewedJobIds={new Set()}
      userId={HELPER}
      onHelperResponse={noop} respondingHelperAppId={null}
      onComplete={noop} completingJobId={null}
      onResolveRevision={noop} onHelperReview={noop}
      onDispute={noop} onViewDispute={noop} onRefresh={noop}
      disputeResponse="" setDisputeResponse={noop}
      respondingJobId={null} setRespondingJobId={noop}
      submittingResponse={false} setSubmittingResponse={noop}
      withdrawingAppId={null} setWithdrawTarget={noop}
      uploadingAttachment={null} editingMessageAppId={null}
      setEditingMessageAppId={noop} editMessageText="" setEditMessageText={noop}
      savingMessage={false} handleSaveMessage={noop}
      handleAddAttachment={noop} handleRemoveAttachment={noop}
    />,
  );
}

const makeApp = (over: Record<string, unknown> = {}, jobOver: Record<string, unknown> = {}) =>
  ({
    id: "app-1",
    job_id: "job-1",
    helper_id: HELPER,
    status: "accepted",
    posterName: "Pierre B.",
    created_at: ago(72),
    job: { ...baseJob, ...jobOver },
    ...over,
  }) as unknown as AppliedApp;

/** The profile links on the card, in document order. */
const profileLinks = (href: string) => [...document.querySelectorAll<HTMLElement>(`a[href="${href}"]`)];

/** `true` when `a` comes strictly before `b` in the document. */
const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// ===========================================================================
// /my-posts — the Helpr's tile
// ===========================================================================
describe("Posts card: the Helpr tile is the last thing before the action row", () => {
  it("expanded: exactly one tile, and it sits ABOVE [data-job-step-row]", () => {
    renderPosted(baseJob, true);
    const links = profileLinks(`/user/${HELPER}`);
    expect(links, "the Helpr's profile must print exactly once on the card").toHaveLength(1);
    const tile = links[0];
    expect(tile).toHaveTextContent("Hallie H.");
    expect(tile).toHaveTextContent("Helpr");

    const row = document.querySelector("[data-job-step-row]");
    expect(row, "no action row rendered — the fixture stopped reaching the in-progress step").not.toBeNull();
    expect(
      before(tile, row!),
      "the Helpr tile must come BEFORE the action row (owner, 2026-09-19: " +
        "'the helpr or posted by should be right above the buttons')",
    ).toBe(true);

    // …and INSIDE the step card, not merely somewhere earlier in the document.
    // "Above the row" with the whole tracker, map and description in between is
    // not what was asked for; being the row's own previous sibling-block is.
    const stepCard = document.querySelector("[data-job-step]");
    expect(stepCard!.contains(tile), "the tile must be inside the step card that owns the row").toBe(true);

    // NOT in the tracker any more — that was the 2026-09-16 position.
    expect(screen.getByTestId("tracker").contains(tile)).toBe(false);
  });

  it("expanded: it comes AFTER the description and AFTER the tracker", () => {
    renderPosted(baseJob, true);
    const tile = profileLinks(`/user/${HELPER}`)[0];
    // The owner's full reading order: … description → tracker + map → person
    // tile → action row.
    expect(before(screen.getByText(/Front driveway/), tile)).toBe(true);
    expect(before(screen.getByTestId("tracker"), tile)).toBe(true);
  });

  it("collapsed: no Helpr name and no profile link anywhere (V6)", () => {
    renderPosted(baseJob, false);
    expect(screen.queryByText("Hallie H.")).toBeNull();
    expect(profileLinks(`/user/${HELPER}`)).toHaveLength(0);
  });

  it("collapsed + disputed: the FULL tracker is on the card, the tile is NOT", () => {
    // The one collapsed state that draws the full tracker on this card
    // (187f61c3f) — and the state where a tile riding inside the tracker would
    // leak, which is why V6 is gated on the tile itself and not the tracker.
    // Every other collapsed status gets the compact rail instead; the two are
    // exact complements, asserted below.
    renderPosted({ ...baseJob, status: "disputed" } as Job, false);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(
      document.querySelector("[data-job-rail-compact]"),
      "a contested collapsed card drew the full tracker AND the compact rail — the same " +
        "rail twice on one card",
    ).toBeNull();
    expect(profileLinks(`/user/${HELPER}`)).toHaveLength(0);
  });

  it("a status with NO action row keeps the tile, exactly once (the fallback)", () => {
    // `cancelled` is `false` in STATUS_RENDERS_ACTIONS, so PostedJobActions
    // returns null and nothing claims the tile. Without the fallback the
    // Helpr's profile would silently disappear from the card — the defect the
    // claim exists to make impossible.
    renderPosted({ ...baseJob, status: "cancelled" } as Job, true);
    expect(document.querySelector("[data-job-step-row]")).toBeNull();
    expect(profileLinks(`/user/${HELPER}`)).toHaveLength(1);
  });
});

// ===========================================================================
// /my-jobs — the poster's tile ("these changes all apply to jobs also")
// ===========================================================================
describe("Jobs card: the Posted-by tile is the last thing before the action row", () => {
  it("expanded: exactly one tile, and it sits ABOVE [data-job-step-row]", () => {
    renderApplied(makeApp(), true);
    const links = profileLinks(`/user/${POSTER}`);
    expect(links, "the poster's profile must print exactly once on the card").toHaveLength(1);
    const tile = links[0];
    expect(tile).toHaveTextContent("Pierre B.");
    expect(tile).toHaveTextContent("Posted by");

    const row = document.querySelector("[data-job-step-row]");
    expect(row, "no action row rendered — the fixture stopped reaching a step card").not.toBeNull();
    expect(before(tile, row!), "the Posted-by tile must come BEFORE the action row").toBe(true);
    expect(document.querySelector("[data-job-step]")!.contains(tile)).toBe(true);
    expect(screen.getByTestId("tracker").contains(tile)).toBe(false);
  });

  it("collapsed: the compact rail renders but the poster's name does NOT (V6)", () => {
    renderApplied(makeApp(), false);
    /* The helper's FULL tracker used to render on a collapsed card, which is
       why the tile needed its own gate. Owner, 2026-09-19 put it behind the
       expand and replaced it with the 16px rail, so the assertion moves to
       that — the collapsed card is still drawing this job's progress, so this
       case cannot pass by the card rendering nothing at all. */
    expect(document.querySelector("[data-job-rail-compact]")).toBeInTheDocument();
    expect(screen.queryByTestId("tracker"), "the full tracker is back on a collapsed card").toBeNull();
    expect(screen.queryByText("Pierre B.")).toBeNull();
    expect(profileLinks(`/user/${POSTER}`)).toHaveLength(0);
  });

  it("a state with NO step card keeps the tile, exactly once (the fallback)", () => {
    // Pending: PendingApplicationSection is not a step card, so nothing claims
    // the tile and the card body prints it. Five of this card's states are like
    // this — far more than the poster's two — which is why the claim is the
    // mechanism rather than a copied list of statuses.
    renderApplied(
      makeApp({ status: "pending" }, { status: "open", helper_id: null, helper_confirmed_at: null }),
      true,
    );
    expect(document.querySelector("[data-job-step-row]")).toBeNull();
    expect(profileLinks(`/user/${POSTER}`)).toHaveLength(1);
  });
});
