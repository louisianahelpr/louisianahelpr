/**
 * MOUNT WIRING: the poster's Posts tab really opens the Applicants screen.
 *
 * ApplicantsPanel is tested ALONE (src/test/posterMessagesApplicants.test.tsx
 * renders it directly). Nothing rendered PostedJobsTab, the only production
 * parent, so deleting the mount, gating it on the wrong value or passing it
 * another job's applicants stayed green (vacuity class (b), mount-wiring).
 * This renders the real PostedJobsTab: with a job selected, the Applicants
 * screen for THAT job is on the page with its applicant and the Message
 * button (owner, 2026-10-11); with none selected, it is not.
 *
 * The cards and the per-applicant signal fetches are stubbed; the panel itself
 * is the real component.
 *
 * @mutate src/pages/posts/PostedJobsTab.tsx | {selectedJob && ( | {false && (
 * @mutate src/pages/posts/PostedJobsTab.tsx |           applications={applications}\n |           applications={[]}\n
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PostedJobsTab } from "./PostedJobsTab";
import type { EnrichedApplication, Job } from "@/components/job-card/activityConstants";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "maybeSingle", "single"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    },
  };
});
vi.mock("./PostedJobCard", () => ({ PostedJobCard: ({ job }: { job: Job }) => <div data-testid={`card-${job.id}`} /> }));
vi.mock("./postedJobs/RecurringVisitPayments", () => ({ RecurringVisitPayments: () => null }));
vi.mock("./postedJobs/useJobAnalytics", () => ({ useJobAnalytics: () => ({ jobAnalyticsMap: {} }) }));
vi.mock("./postedJobs/useApplicantSignals", () => ({
  useApplicantSignals: () => ({
    neighborCountMap: new Map(),
    completedCountsMap: new Map(),
    repeatHireMap: new Map(),
    onTimeMap: new Map(),
    distanceBandMap: new Map(),
    signalsPending: false,
  }),
}));

const JOB = { id: "job-mount-2", title: "Rake the side yard", status: "open", created_at: new Date().toISOString() } as unknown as Job;
const APPLICANT = {
  id: "app-mount-2",
  job_id: JOB.id,
  helper_id: "helper-mount-2",
  status: "pending",
  message: "Should I bring my own rake?",
  created_at: new Date().toISOString(),
  profiles: { full_name: "Ann Boudreaux", skills: null, user_id: "helper-mount-2" },
} as unknown as EnrichedApplication;

const noop = () => {};

function renderTab(selectedJob: Job | null) {
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <PostedJobsTab
        jobs={[JOB]}
        applicantCounts={{ [JOB.id]: 1 }}
        expandedJobIds={new Set()}
        toggleExpandedJobId={noop}
        helperNames={{}}
        completedJobMeta={{}}
        latestTracking={{}}
        groupHelpersByJob={{}}
        userId="poster-mount-2"
        onBoost={noop}
        onEdit={noop}
        onCancel={noop}
        onComplete={noop}
        completingJobId={null}
        onNoShow={noop}
        onTip={noop}
        onReview={noop}
        onDispute={noop}
        onReport={noop}
        onViewDispute={noop}
        onConfirmArrival={noop}
        confirmingArrivalJobId={null}
        onConfirmWorking={noop}
        confirmingWorkingJobId={null}
        onLoadApplications={noop}
        selectedJob={selectedJob}
        setSelectedJob={noop}
        applications={[APPLICANT]}
        onAcceptApplication={noop}
        onDeclineApplication={noop}
        onLoadInlineApplicants={noop}
        inlineApplicants={{}}
        loadingApplicants={{}}
        applicantErrors={{}}
        onActionComplete={noop}
      />
    </MemoryRouter>,
  );
}

describe("PostedJobsTab mounts ApplicantsPanel", () => {
  it("a selected job opens its Applicants screen, with the applicant and a Message button", () => {
    renderTab(JOB);
    expect(screen.getByTestId(`card-${JOB.id}`)).toBeInTheDocument();
    const region = screen.getByRole("region", { name: /Applicants for Rake the side yard/ });
    expect(within(region).getByRole("button", { name: "Message Ann B." })).toBeInTheDocument();
  });

  it("no selected job, no Applicants screen", () => {
    renderTab(null);
    expect(screen.getByTestId(`card-${JOB.id}`)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Applicants for/ })).toBeNull();
  });
});
