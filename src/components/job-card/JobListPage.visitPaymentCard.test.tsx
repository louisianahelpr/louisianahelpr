/**
 * Q1465 (found by money lane A's Q749 screenshot pass, 2026-10-07): the
 * "Confirm your next visit" Pay card lived only inside PostedJobsTab, and
 * JobListPage renders ActivityEmptyState INSTEAD of PostedJobsTab when the
 * current Posts bucket is empty, so a payer landing on an empty "Needs you"
 * (where the visit notification sends them) never saw the $300+ visit waiting
 * on payment. Measured on a local build against prod: card absent on the
 * landing bucket at 375 and 1440, light and dark (~/.lh-shots/money-a/q749-landing-*.png).
 *
 * @mutate src/components/job-card/JobListPage.tsx |             {tab === "posted" && user && <RecurringVisitPayments userId={user.id} className="mx-4 mt-3" />} |
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const visitRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gt", "is", "neq", "in", "not", "limit"]) chain[op] = () => chain;
  chain.order = () => Promise.resolve({ data: visitRows.value, error: null });
  return { supabase: { from: () => chain, functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })) } };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "payer-1" }, loading: false }),
}));
vi.mock("@/components/job-card/useActivityActions", () => ({
  useActivityActions: () => ({ expandedJobIds: new Set<string>(), inlineApplicants: {}, applicantErrors: {}, tip: { target: null, open: () => {}, close: () => {} } }),
}));
vi.mock("@/components/job-card/ActivityDialogs", () => ({ ActivityDialogs: () => null }));
vi.mock("@/pages/posts/PostedJobsTab", () => ({ PostedJobsTab: () => <div data-testid="posted-tab" /> }));
vi.mock("@/pages/jobs/AppliedJobsTab", () => ({ AppliedJobsTab: () => <div data-testid="applied-tab" /> }));
vi.mock("@/hooks/useActivityData", () => ({
  useActivityData: () => ({
    loading: false, loadError: false, postedJobs: [], appliedApps: [],
    applicantCounts: {}, pendingApplicantCounts: {}, helperNames: {}, helperAvatars: {},
    completedJobMeta: {}, declinedJobIds: new Set<string>(), helperReviewedJobIds: new Set<string>(),
    latestTracking: {}, groupHelpersByJob: {}, refresh: vi.fn(async () => {}),
  }),
}));

import Activity from "@/components/job-card/JobListPage";

// jsdom implements no scrollTo; the Activity scroll container calls it.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}

function renderPosts() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/posts"]}>
        <Activity defaultTab="posted" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Q1465: a visit waiting on payment shows on an empty Posts bucket", () => {
  it("the Pay card renders above the empty state", async () => {
    visitRows.value = [{ id: "vp-1", visit_date: "2099-10-08", amount_cents: 33600, parent_job_id: "p-1", jobs: { title: "Weekly yard care" } }];
    renderPosts();
    expect(await screen.findByText("Confirm your next visit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay \$336\.00/ })).toBeInTheDocument();
    expect(screen.queryByTestId("posted-tab")).toBeNull();
  });

  it("nothing waiting: only the empty state", async () => {
    visitRows.value = [];
    renderPosts();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Confirm your next visit")).toBeNull();
  });
});
