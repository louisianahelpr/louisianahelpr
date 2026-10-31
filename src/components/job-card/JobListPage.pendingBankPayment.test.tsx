/**
 * Owner, 2026-10-17: "The job shouldn't post until the money is paid." A job
 * whose bank (ACH) payment is on its way is 'unpaid' with the PaymentIntent
 * stored (stripe-webhook checkoutSessionCompleted), and NEVER_PAID_STATUSES
 * hid it from My Posts entirely: a poster who paid by bank saw NOTHING for up
 * to four business days (measured on main b5aae43d5: the page showed only
 * "Nothing posted yet", ~/.lh-shots/sec-a-unpaid/). Now it shows a plain
 * waiting card, in no bucket and no count, on both the empty branch and the
 * list branch.
 *
 * @mutate src/components/job-card/JobListPage.tsx |             {tab === "posted" && <PendingBankPayments jobs={postedJobs} className="mx-4 mt-3" />} |
 * @mutate src/components/job-card/JobListPage.tsx |           {tab === "posted" && <PendingBankPayments jobs={postedJobs} className="mb-3" />} |
 * @mutate src/lib/pendingBankPayment.ts |   return j.payment_status === "unpaid" && !!j.stripe_payment_intent_id && j.status !== "cancelled"; |   return j.payment_status === "unpaid" && j.status !== "cancelled";
 * @mutate src/lib/pendingBankPayment.ts |   return j.payment_status === "unpaid" && !!j.stripe_payment_intent_id && j.status !== "cancelled"; |   return j.payment_status === "unpaid" && !!j.stripe_payment_intent_id;
 * @mutate src/pages/posts/postedJobs/PendingBankPayments.tsx | This usually takes up to 4 business days; your job posts when it arrives. | Your job posts soon.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const visitRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const posted = vi.hoisted(() => ({ jobs: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gt", "is", "neq", "in", "not", "limit"]) chain[op] = () => chain;
  chain.order = () => Promise.resolve({ data: visitRows.value, error: null });
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
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
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
    loading: false, loadError: false, postedJobs: posted.jobs, appliedApps: [],
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
        <Activity defaultTab="posted" embeddedHeader={<div />} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COPY = "Bank payment pending. This usually takes up to 4 business days; your job posts when it arrives.";
const job = (over: Record<string, unknown>) => ({
  id: "j-1", title: "Mow & weed eat", status: "open", payment_status: "unpaid",
  stripe_payment_intent_id: "pi_bank_1", created_at: "2026-10-17T12:00:00Z", customer_id: "payer-1", ...over,
});

describe("a job waiting for its bank payment shows on My Posts (owner, 2026-10-17)", () => {
  it("pending bank job alone: the waiting card, above the empty state, not in the list", async () => {
    visitRows.value = [];
    posted.jobs.splice(0, posted.jobs.length, job({}));
    renderPosts();
    expect(await screen.findByText(COPY)).toBeInTheDocument();
    expect(screen.getByText("Mow & weed eat")).toBeInTheDocument();
    expect(screen.queryByTestId("posted-tab")).toBeNull();
  });

  it("with real posts too: the card shows above the list", async () => {
    visitRows.value = [];
    posted.jobs.splice(0, posted.jobs.length, job({}), job({ id: "j-2", title: "Paid job", payment_status: "escrow", stripe_payment_intent_id: "pi_2" }));
    renderPosts();
    expect(await screen.findByText(COPY)).toBeInTheDocument();
    expect(await screen.findByTestId("posted-tab")).toBeInTheDocument();
  });

  it.each([
    ["a checkout that never completed (no PaymentIntent)", { stripe_payment_intent_id: null }],
    ["a cancelled job", { status: "cancelled" }],
    ["a bounced bank payment", { payment_status: "failed" }],
    ["a funded job", { payment_status: "escrow" }],
  ])("no card for %s", async (_label, over) => {
    visitRows.value = [];
    posted.jobs.splice(0, posted.jobs.length, job(over));
    renderPosts();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(COPY)).toBeNull();
  });
});
