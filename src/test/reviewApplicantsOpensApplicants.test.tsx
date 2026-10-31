/**
 * "Review N applicants" on the job page (boards 22 / 170; audit 2026-10-25, ~/.lh-wt/boards-status-1025.md): the button
 * sent the poster to /posts?highlight=<id>, which only pulsed the card, so the applicants never opened and the poster
 * had to find the card and tap again. On the audit's two test jobs (never paid, so not on Posted at all) it landed on
 * the list with nothing said. Now the link carries `&applicants=1`, Posted opens that job's applicants (the panel the
 * card's own Review opens, actions.loadApplications), once; and a job not on Posted says why.
 * The job page's link: src/pages/jobs/jobPage/JobPage.test.tsx ("... reviews them in Posted").
 *
 * @mutate src/components/job-card/JobListPage.tsx |   useReviewApplicantsDeepLink(applicantsJobId, postedJobs, actions.loadApplications, onPostedList); |
 * @mutate src/components/job-card/useManageDeepLink.ts |     if (isOnList(job)) void open(job as never); |     void open(job as never);
 * @mutate src/components/job-card/useManageDeepLink.ts |     if (!target \|\| done.current === target) return;\n    const job | if (!target) return;\n    const job
 * @mutate src/components/job-card/JobListPage.tsx |   const applicantsJobId = defaultTab === "posted" && searchParams.get("applicants") === "1" ? searchParams.get("highlight") : null; |   const applicantsJobId = null;
 * @mutate src/components/job-card/JobListPage.tsx |     } else if (tab === "posted" && highlightJobId && !onList) { |     } else if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const data = vi.hoisted(() => ({ postedJobs: [] as unknown[], appliedApps: [] as unknown[] }));
const toastShown = vi.hoisted(() => vi.fn());
const loadApplications = vi.hoisted(() => vi.fn());
// One stable object, as the real hook's memoised actions: the deep-link effect depends on its fields.
const actions = vi.hoisted(() => ({
  expandedJobIds: new Set<string>(), inlineApplicants: {}, applicantErrors: {},
  tip: { target: null, open: () => {}, close: () => {} }, toggleExpandedJobId: () => {}, loadApplications,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gt", "is", "neq", "in", "not", "limit"]) chain[op] = () => chain;
  chain.order = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: () => chain, functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })),
    // useFeature (JobListQuotesSlot) waits on useAuthReady, which subscribes to auth.
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    } } };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("sonner", () => ({ toast: Object.assign(toastShown, { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "poster-1" }, loading: false }),
}));
vi.mock("@/components/job-card/useActivityActions", () => ({
  useActivityActions: () => actions,
}));
vi.mock("@/components/job-card/ActivityDialogs", () => ({ ActivityDialogs: () => null }));
vi.mock("@/pages/posts/PostedJobsTab", () => ({
  PostedJobsTab: ({ jobs }: { jobs: { id: string }[] }) => <div data-testid="posted-tab">{jobs.map((j) => j.id).join(",")}</div>,
}));
vi.mock("@/pages/jobs/AppliedJobsTab", () => ({ AppliedJobsTab: () => <div data-testid="applied-tab" /> }));
vi.mock("@/hooks/useActivityData", () => ({
  useActivityData: () => ({
    loading: false, loadError: false, postedJobs: data.postedJobs, appliedApps: data.appliedApps,
    applicantCounts: {}, pendingApplicantCounts: {}, helperNames: {}, helperAvatars: {},
    completedJobMeta: {}, declinedJobIds: new Set<string>(), helperReviewedJobIds: new Set<string>(),
    latestTracking: {}, groupHelpersByJob: {}, refresh: vi.fn(async () => {}),
  }),
}));

import Activity from "@/components/job-card/JobListPage";

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
/** Paid, open, no applicants, its day ahead: Waiting. */
const waitingJob = {
  id: "j-open", title: "Rake the yard", status: "open", payment_status: "escrow", customer_id: "poster-1",
  created_at: inDays(-1), date_needed: inDays(5).slice(0, 10), expires_at: inDays(4), budget: 80, category: "yard_work",
};
/** The audit's test jobs (1c7860dd, c91a2cac): open with an applicant, never paid. In the raw list, in no bucket. */
const unpaidWithApplicant = {
  id: "j-draft", title: "SEED Feed and walk two dogs", status: "open", payment_status: "unpaid", customer_id: "poster-1",
  created_at: inDays(-2), date_needed: inDays(3).slice(0, 10), expires_at: inDays(2), budget: 40, category: "pet_care",
};

// StrictMode, as the dev server runs it: effects run twice on mount, so "once per link" is really tested.
function renderAt(path: string, tab: "posted" | "applied") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Activity defaultTab={tab} embeddedHeader={<div />} />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  toastShown.mockClear();
  loadApplications.mockClear();
  data.postedJobs = [waitingJob, unpaidWithApplicant];
  data.appliedApps = [];
});

describe("Review N applicants opens the applicants (boards 22 / 170)", () => {
  it("a paid job on Posted: its applicants open, once, with no notice", async () => {
    const { rerender } = renderAt("/posts?highlight=j-open&applicants=1", "posted");
    await waitFor(() => expect(loadApplications).toHaveBeenCalledTimes(1));
    expect(loadApplications.mock.calls[0][0]).toMatchObject({ id: "j-open" });
    rerender(<div />);
    expect(loadApplications).toHaveBeenCalledTimes(1);
    expect(toastShown).not.toHaveBeenCalled();
  });

  it("a plain highlight (no applicants=1) still only marks the card", async () => {
    renderAt("/posts?highlight=j-open", "posted");
    expect(await screen.findByTestId("posted-tab")).toHaveTextContent("j-open");
    expect(loadApplications).not.toHaveBeenCalled();
  });

  it("a never-paid job (the audit's test jobs) opens nothing and says why", async () => {
    renderAt("/posts?highlight=j-draft&applicants=1", "posted");
    await waitFor(() => expect(toastShown).toHaveBeenCalledWith("That job isn't paid yet, so it isn't on Posted. Open it to pay for it."));
    expect(loadApplications).not.toHaveBeenCalled();
  });
});
