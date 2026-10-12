/**
 * Mount wiring: My Posts (PostedJobsTab) opens the Applicants panel for the
 * selected job, and only then.
 *
 * posterMessagesApplicants.test.tsx renders ApplicantsPanel alone, so a tab
 * that stopped mounting it (or passed it the wrong job) stayed green; main's
 * Vacuity (run 38317156550, 2026-10-12) flagged it as a mount-wiring gap. The
 * panel itself is stubbed here (its own tests cover what it draws); this test
 * is about the tab: the real PostedJobsTab must mount it with the selected
 * job, the loaded applications and the same Boost/Edit levers its cards use.
 *
 * @mutate src/pages/posts/PostedJobsTab.tsx |       {selectedJob && ( |       {false && (
 * @mutate src/pages/posts/PostedJobsTab.tsx |           selectedJob={selectedJob}\n |           selectedJob={null as never}\n
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { PostedJobsTab } from "../PostedJobsTab";

const seen = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("./ApplicantsPanel", () => ({
  ApplicantsPanel: (p: Record<string, unknown>) => {
    seen.props.push(p);
    const job = p.selectedJob as { id: string; title: string } | null;
    return <div data-testid="applicants-panel">{job ? `${job.id}:${job.title}` : "no job"}</div>;
  },
}));
vi.mock("./RecurringVisitPayments", () => ({ RecurringVisitPayments: () => null }));
// The cards are not what this test is about (the tab returns its empty state, and no panel, without one).
vi.mock("../PostedJobCard", () => ({ PostedJobCard: () => <div data-testid="posted-card" /> }));
vi.mock("./useApplicantSignals", () => ({
  useApplicantSignals: () => ({
    neighborCountMap: {},
    completedCountsMap: {},
    repeatHireMap: {},
    onTimeMap: {},
    distanceBandMap: {},
    signalsPending: false,
  }),
}));
vi.mock("./useJobAnalytics", () => ({ useJobAnalytics: () => ({ jobAnalyticsMap: {} }) }));

type Props = ComponentProps<typeof PostedJobsTab>;
const noop = () => {};
const job = { id: "job-1", title: "SEED Deep clean a kitchen", status: "open" };
const onBoost = vi.fn();
const onEdit = vi.fn();

function renderTab(selectedJob: unknown) {
  const props = {
    jobs: [job],
    applicantCounts: {},
    pendingApplicantCounts: {},
    closedApplicantSummaries: {},
    expandedJobIds: new Set<string>(),
    toggleExpandedJobId: noop,
    helperNames: {},
    helperAvatars: {},
    completedJobMeta: {},
    latestTracking: {},
    groupHelpersByJob: {},
    userId: "poster-1",
    onBoost,
    onEdit,
    onCancel: noop,
    onComplete: noop,
    onNoShow: noop,
    onTip: noop,
    onReview: noop,
    onDispute: noop,
    onReport: noop,
    onViewDispute: noop,
    onConfirmArrival: noop,
    onConfirmWorking: noop,
    onLoadApplications: noop,
    selectedJob,
    setSelectedJob: noop,
    applications: [{ id: "app-1" }],
    onAcceptApplication: noop,
    onDeclineApplication: noop,
    onLoadInlineApplicants: noop,
    inlineApplicants: {},
    loadingApplicants: {},
    applicantErrors: {},
    onActionComplete: noop,
    statusFilter: "all",
    statusCounts: { all: 1 },
    statusLabels: [],
    onSelectStatusFilter: noop,
  } as unknown as Props;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PostedJobsTab {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("My Posts mounts the Applicants panel for the selected job", () => {
  it("a selected job opens the panel with that job, its applications and the card's Boost/Edit levers", () => {
    seen.props = [];
    renderTab(job);
    expect(screen.getByTestId("applicants-panel").textContent).toBe("job-1:SEED Deep clean a kitchen");
    expect(seen.props.length).toBeGreaterThan(0);
    const last = seen.props[seen.props.length - 1];
    expect(last.applications).toEqual([{ id: "app-1" }]);
    expect(last.onBoost).toBe(onBoost);
    expect(last.onEdit).toBe(onEdit);
  });

  it("no selected job, no panel", () => {
    seen.props = [];
    renderTab(null);
    expect(screen.queryByTestId("applicants-panel")).toBeNull();
    expect(seen.props).toEqual([]);
  });
});
