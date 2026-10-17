/**
 * Q1668: a notification link to a job that is not on My Posts (or My Jobs)
 * says so, and the page opens on the first bucket that holds anything.
 *
 * Found 2026-10-12 in e2e-journeys 38181872855 (notifications milestones
 * `link_posts_job_8f7f2e80...` and `..._bfb11c76...`, chromium 390): both
 * links pointed at poster-e2e's cancelled, never-paid is_seed jobs (read-only
 * SQL 2026-10-17: status cancelled, payment_status unpaid). My Posts drops a
 * never-paid job from every bucket (jobIsUnfundedDraft), yet the deep-link
 * effect still found it in the raw list and chose its bucket, and Q1537's
 * open-on-the-first-bucket rule skipped any page load whose link carried
 * `?job=`. The poster read "No jobs in this view" with a job sitting in
 * Waiting and no word about the job the notification named.
 *
 * Class: every `?job=` link whose job is in no bucket on this tab (never paid,
 * or not in the list at all), on both tabs. A job that IS on the list still
 * opens its own bucket with no notice.
 *
 * @mutate src/components/job-card/JobListPage.tsx |       if (job && !jobIsUnfundedDraft(job)) { |       if (job) {
 * @mutate src/components/job-card/JobListPage.tsx |     if (deepLinkJobId) return;\n    openedOnFirstBucketFor.current = tab; |     openedOnFirstBucketFor.current = tab;\n    if (deepLinkJobId) return;
 * @mutate src/components/job-card/JobListPage.tsx |       toast.info(`That job is no longer on ${tab === "posted" ? "My Posts" : "My Jobs"}.`); |       void tab;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const data = vi.hoisted(() => ({ postedJobs: [] as unknown[], appliedApps: [] as unknown[] }));
const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gt", "is", "neq", "in", "not", "limit"]) chain[op] = () => chain;
  chain.order = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: () => chain, functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })) } };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: toastInfo } }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "poster-1" }, loading: false }),
}));
vi.mock("@/components/job-card/useActivityActions", () => ({
  useActivityActions: () => ({ expandedJobIds: new Set<string>(), inlineApplicants: {}, applicantErrors: {}, tip: { target: null, open: () => {}, close: () => {} } }),
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
/** The journeys' job: cancelled before it was ever paid. In the raw list, in no bucket. */
const neverPaidJob = {
  id: "j-gone", title: "SEED cancelled draft", status: "cancelled", payment_status: "unpaid", customer_id: "poster-1",
  created_at: inDays(-2), date_needed: inDays(3).slice(0, 10), expires_at: inDays(2), budget: 40, category: "yard_work",
};

function renderAt(path: string, tab: "posted" | "applied") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Activity defaultTab={tab} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastInfo.mockClear();
  data.postedJobs = [waitingJob, neverPaidJob];
  data.appliedApps = [];
});

describe("Q1668: a ?job= link to a job not on the list", () => {
  it("a never-paid job: My Posts says so and opens Waiting, where the poster's job is", async () => {
    renderAt("/posts?job=j-gone", "posted");
    expect(await screen.findByTestId("posted-tab")).toHaveTextContent("j-open");
    expect(toastInfo).toHaveBeenCalledWith("That job is no longer on My Posts.");
    expect(screen.queryByText(/No jobs in this view/)).toBeNull();
  });

  it("a job not in the list at all: the same", async () => {
    renderAt("/posts?job=not-mine", "posted");
    expect(await screen.findByTestId("posted-tab")).toHaveTextContent("j-open");
    expect(toastInfo).toHaveBeenCalledWith("That job is no longer on My Posts.");
  });

  it("My Jobs says it with its own name", async () => {
    renderAt("/jobs?job=not-applied", "applied");
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("That job is no longer on My Jobs."));
  });

  it("a job that IS on the list opens its bucket with no notice", async () => {
    renderAt("/posts?job=j-open", "posted");
    expect(await screen.findByTestId("posted-tab")).toHaveTextContent("j-open");
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("a plain open still opens the first bucket with anything", async () => {
    renderAt("/posts", "posted");
    expect(await screen.findByTestId("posted-tab")).toHaveTextContent("j-open");
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
