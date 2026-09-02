import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  useActivityFilters,
  APPLIED_STATUS_FILTERS,
  appliedActivityBucket,
  type ActivityBucket,
} from "./activityFilters";
import { AppliedJobCard } from "@/components/activity/AppliedJobCard";
import type { AppliedApp } from "@/components/activity/activityConstants";

/**
 * The tab badge and the list under it must agree.
 *
 * Verified live during the overnight audit: the Done tab's badge read 3 while
 * only 2 cards rendered. Every unit test passed, because the count and the
 * render were tested separately and each was self-consistent. The row that
 * went missing was a REJECTED application whose job row the jobs SELECT policy
 * had stopped returning — counted by the bucketing function, and silently
 * dropped by `if (!job) return null` in AppliedJobCard.
 *
 * So this file asserts the chain end to end, over a fixture set covering every
 * helper-side state:
 *   1. bucketing is total and exclusive (nothing lost, nothing double-counted),
 *   2. the badge count equals the filtered list length, per bucket,
 *   3. every row in a filtered list actually RENDERS a card.
 *
 * (3) is the one that would have failed before the fix, and it is the reason
 * this file renders at all rather than staying purely functional.
 */

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ profile: { subscription_tier: "free", subscription_expires_at: null } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// The state-specific sections are exercised by singlePrimaryCta.test.tsx. Here
// the question is only "did a card appear for this row", so they are stubbed —
// that keeps the render fast and deterministic, and crucially does NOT stub the
// `!job` branch, which is where the missing row lived.
// (factories are hoisted — each returns its own inline stub, no shared helper)
vi.mock("@/components/activity/appliedJobCard/PendingApplicationSection", () => ({ PendingApplicationSection: () => <div data-testid="pending" /> }));
vi.mock("@/components/activity/appliedJobCard/OfferedActions", () => ({ OfferedActions: () => <div data-testid="offered" /> }));
vi.mock("@/components/activity/appliedJobCard/ConfirmedSection", () => ({ ConfirmedSection: () => <div data-testid="confirmed" /> }));
vi.mock("@/components/activity/appliedJobCard/ActiveJobSection", () => ({ ActiveJobSection: () => <div data-testid="active" /> }));
vi.mock("@/components/activity/appliedJobCard/DisputedSection", () => ({ DisputedSection: () => <div data-testid="disputed" /> }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => <div data-testid="proof" /> }));

const HELPER = "helper-1";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

interface Fixture {
  name: string;
  bucket: ActivityBucket;
  app: AppliedApp;
}

let seq = 0;
function fixture(
  name: string,
  bucket: ActivityBucket,
  appStatus: string,
  job: Record<string, unknown> | null,
): Fixture {
  const id = `f${++seq}`;
  return {
    name,
    bucket,
    app: {
      id: `app-${id}`,
      job_id: `job-${id}`,
      helper_id: HELPER,
      status: appStatus,
      created_at: ago(96),
      message: null,
      attachment_urls: null,
      job:
        job === null
          ? null
          : {
              id: `job-${id}`,
              title: `Job ${id}`,
              description: "Details",
              location: "Lafayette, LA",
              customer_id: "poster-1",
              budget: 100,
              category: "yard_work",
              date_needed: new Date().toISOString().slice(0, 10),
              start_time: "09:00",
              helper_id: null,
              helper_confirmed_at: null,
              offered_to_helper_id: null,
              direct_offer_status: null,
              helper_completed_at: null,
              poster_completed_at: null,
              proof_before_urls: null,
              proof_after_urls: null,
              ...job,
            },
    } as unknown as AppliedApp,
  };
}

/**
 * Every helper-side state a row can be in. The last one is the row that caused
 * the original badge/list mismatch: a rejected application whose job is no
 * longer visible to this helper, so `job` comes back null.
 */
const FIXTURES: Fixture[] = [
  fixture("applied, awaiting a decision", "waiting", "pending", { status: "open" }),
  fixture("direct offer, pending", "needs_you", "pending", {
    status: "open", offered_to_helper_id: HELPER, direct_offer_status: "pending",
  }),
  fixture("offered — accepted, not yet confirmed", "needs_you", "accepted", {
    status: "accepted", helper_id: HELPER,
  }),
  fixture("offer expired — job reopened, application rejected", "cancelled", "rejected", {
    status: "open",
  }),
  fixture("confirmed booking", "scheduled", "accepted", {
    status: "accepted", helper_id: HELPER, helper_confirmed_at: ago(20),
  }),
  fixture("on the way", "scheduled", "accepted", {
    status: "in_progress", helper_id: HELPER, helper_confirmed_at: ago(20), helper_on_the_way_at: ago(2),
  }),
  fixture("arrived", "scheduled", "accepted", {
    status: "in_progress", helper_id: HELPER, helper_confirmed_at: ago(20), helper_arrived_at: ago(1),
  }),
  fixture("working", "scheduled", "accepted", {
    status: "in_progress", helper_id: HELPER, helper_confirmed_at: ago(20),
    helper_arrived_at: ago(3), poster_confirmed_working_at: ago(2),
  }),
  fixture("awaiting the poster's approval", "waiting", "accepted", {
    status: "in_progress", helper_id: HELPER, helper_confirmed_at: ago(30), helper_completed_at: ago(1),
  }),
  fixture("revision requested", "needs_you", "accepted", {
    status: "revision_requested", helper_id: HELPER, helper_confirmed_at: ago(40),
    helper_completed_at: ago(5), revision_requested_at: ago(3), revision_note: "Missed the back gate",
  }),
  fixture("disputed", "needs_you", "accepted", {
    status: "disputed", helper_id: HELPER, helper_confirmed_at: ago(50), disputed_at: ago(2),
  }),
  fixture("completed", "done", "accepted", {
    status: "completed", helper_id: HELPER, helper_confirmed_at: ago(70),
    helper_completed_at: ago(30), poster_completed_at: ago(29),
  }),
  fixture("cancelled", "cancelled", "accepted", { status: "cancelled", helper_id: HELPER }),
  fixture("not selected", "cancelled", "rejected", { status: "accepted", helper_id: "someone-else" }),
  fixture("not selected, job no longer visible (job === null)", "cancelled", "rejected", null),
];

const BUCKETS: ActivityBucket[] = ["needs_you", "scheduled", "waiting", "done", "cancelled"];

function filters(statusFilter: string) {
  return renderHook(() =>
    useActivityFilters({
      postedJobs: [],
      appliedApps: FIXTURES.map((f) => f.app),
      statusFilter,
      searchQuery: "",
      userId: HELPER,
    }),
  ).result.current;
}

describe("Activity (helper) — bucketing is total and exclusive", () => {
  it("puts every fixture in the bucket its state belongs to", () => {
    for (const f of FIXTURES) {
      expect(
        appliedActivityBucket(f.app),
        `"${f.name}" landed in the wrong tab`,
      ).toBe(f.bucket);
    }
  });

  it("the five buckets account for every row exactly once", () => {
    const total = BUCKETS.reduce((n, b) => n + filters(b).filteredAppliedApps.length, 0);
    expect(
      total,
      "a row is either missing from every tab or showing in two — the five buckets " +
        "must partition the list",
    ).toBe(FIXTURES.length);
  });

  it("every bucket has a chip to reach it", () => {
    const keys = APPLIED_STATUS_FILTERS.map((f) => f.key);
    for (const b of BUCKETS) {
      expect(keys, `bucket "${b}" has rows but no filter chip`).toContain(b);
    }
  });
});

describe("Activity (helper) — the tab badge equals the list it labels", () => {
  for (const bucket of BUCKETS) {
    it(`badge count === filtered list length: ${bucket}`, () => {
      const { appliedCounts, filteredAppliedApps } = filters(bucket);
      const expected = FIXTURES.filter((f) => f.bucket === bucket).length;
      expect(appliedCounts[bucket], `the ${bucket} badge is wrong`).toBe(expected);
      expect(
        filteredAppliedApps.length,
        `the ${bucket} badge says ${appliedCounts[bucket]} but the list holds ` +
          `${filteredAppliedApps.length} rows`,
      ).toBe(appliedCounts[bucket]);
    });
  }
});

describe("Activity (helper) — every counted row actually renders a card", () => {
  const noop = () => {};
  function renderCard(app: AppliedApp) {
    return render(
      <MemoryRouter>
        <AppliedJobCard
          app={app}
          highlight={false}
          expandedJobIds={new Set()}
          toggleExpandedJobId={noop}
          helperReviewedJobIds={new Set<string>()}
          initialTracking={null}
          userId={HELPER}
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
      </MemoryRouter>,
    );
  }

  for (const f of FIXTURES) {
    it(`renders a card for: ${f.name}`, () => {
      const { container } = renderCard(f.app);
      expect(
        container.textContent?.trim(),
        `"${f.name}" is counted in the ${f.bucket} badge but rendered NOTHING — ` +
          `that is exactly the badge-says-3 / list-shows-2 mismatch`,
      ).toBeTruthy();
    });
  }

  it("the not-selected row with no visible job still says what happened", () => {
    // The pre-fix behaviour was a bare `return null`. A blank row would be no
    // better than a missing one, so assert the copy, not just non-emptiness.
    const orphan = FIXTURES.find((f) => f.app.job == null)!;
    const { container } = renderCard(orphan.app);
    expect(container.textContent).toContain("Not selected");
    expect(container.textContent).toMatch(/closed/i);
  });

  it.each(BUCKETS)(
    "the number of cards rendered equals the badge: %s",
    (bucket) => {
      // The end-to-end statement: badge → filtered rows → rendered cards.
      const { appliedCounts, filteredAppliedApps } = filters(bucket);
      let rendered = 0;
      for (const app of filteredAppliedApps) {
        const view = renderCard(app);
        if ((view.container.textContent || "").trim().length > 0) rendered++;
        view.unmount();
      }
      expect(
        rendered,
        `the ${bucket} tab badge reads ${appliedCounts[bucket]} but only ${rendered} cards render`,
      ).toBe(appliedCounts[bucket]);
    },
    15_000,
  );
});
