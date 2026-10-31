/**
 * A LINK TO A JOB ON WORKING NAMES THE JOB, AND OPENS ITS CARD.
 *
 * Audit 2026-10-28 (part 4 half 2, F10; shot p4j-hired-working-375.png): the hired Helpr's job page said
 * "Open in working" and landed on the plain, unfiltered Working list, the job neither picked out nor opened.
 * Its siblings were worse in a quieter way: "See the offer", "View application" (job page) and the chat card's
 * "Open job" sent `/jobs?tab=working&highlight=<job id>`, but on the Working tab `?highlight=` names an
 * APPLICATION (JobListPage: `a.id === highlightAppId`), so a job id there matched nothing at all.
 *
 * `?job=<job id>` is the param that picks the card's live bucket and pulses it; `&open=1` now also expands it
 * (useManageDeepLink, the Posted side's `manage=1`).
 *
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const highlight = `/jobs?tab=working&job=${encodeURIComponent(job.id)}&open=1`; |   const highlight = `/jobs?tab=working&highlight=${encodeURIComponent(job.id)}`;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |       ? { label: "Open in working", go: () => navigate(highlight) } |       ? { label: "Open in working", go: () => navigate("/jobs?tab=working") }
 * @mutate src/components/job-card/useManageDeepLink.ts | useManageDeepLink(jobId, refs, cards); | void refs;
 * @mutate src/components/messages/chatView/DealCard.tsx |         : `/jobs?tab=working&job=${job.id}&open=1`, |         : `/jobs?tab=working&highlight=${job.id}`,
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const data = vi.hoisted(() => ({ appliedApps: [] as unknown[] }));
const toggle = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({
  expandedJobIds: new Set<string>(), inlineApplicants: {}, applicantErrors: {},
  tip: { target: null, open: () => {}, close: () => {} }, toggleExpandedJobId: toggle, loadApplications: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gt", "is", "neq", "in", "not", "limit"]) chain[op] = () => chain;
  chain.order = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: () => chain, functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })),
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
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "helpr-1" }, loading: false }) }));
vi.mock("@/components/job-card/useActivityActions", () => ({ useActivityActions: () => actions }));
vi.mock("@/components/job-card/ActivityDialogs", () => ({ ActivityDialogs: () => null }));
vi.mock("@/pages/posts/PostedJobsTab", () => ({ PostedJobsTab: () => <div data-testid="posted-tab" /> }));
vi.mock("@/pages/jobs/AppliedJobsTab", () => ({
  AppliedJobsTab: ({ apps }: { apps: { job_id: string }[] }) => <div data-testid="applied-tab">{apps.map((a) => a.job_id).join(",")}</div>,
}));
vi.mock("@/hooks/useActivityData", () => ({
  useActivityData: () => ({
    loading: false, loadError: false, postedJobs: [], appliedApps: data.appliedApps,
    applicantCounts: {}, pendingApplicantCounts: {}, helperNames: {}, helperAvatars: {},
    completedJobMeta: {}, declinedJobIds: new Set<string>(), helperReviewedJobIds: new Set<string>(),
    latestTracking: {}, groupHelpersByJob: {}, refresh: vi.fn(async () => {}),
  }),
}));

import Activity from "@/components/job-card/JobListPage";

if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
/** Hallie's hired, booked job (the audit's AA5-AUDIT-1029). */
const hiredApp = {
  id: "app-1", job_id: "j-hired", helper_id: "helpr-1", status: "accepted", closed_reason: null, created_at: inDays(-1), posterName: "E2E Poster",
  job: {
    id: "j-hired", title: "AA5-AUDIT-1029 test clean", status: "accepted", payment_status: "escrow", customer_id: "poster-1",
    helper_id: "helpr-1", helper_confirmed_at: inDays(-1), created_at: inDays(-2), date_needed: inDays(1).slice(0, 10),
    start_time: "09:00:00", budget: 40, category: "cleaning",
  },
};

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Activity defaultTab="applied" embeddedHeader={<div />} />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  toggle.mockClear();
  data.appliedApps = [hiredApp];
});

describe("Working opens the job a link names (F10)", () => {
  it("`?job=<id>&open=1` opens that card, once", async () => {
    renderAt("/jobs?tab=working&job=j-hired&open=1");
    await waitFor(() => expect(toggle).toHaveBeenCalledWith("j-hired"));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("applied-tab")).toHaveTextContent("j-hired");
  });

  it("a plain `?job=` still only picks out the card (notifications keep their behaviour)", async () => {
    renderAt("/jobs?tab=working&job=j-hired");
    expect(await screen.findByTestId("applied-tab")).toHaveTextContent("j-hired");
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe("no link sends a JOB id as Working's `highlight` (an application id there)", () => {
  const ROOT = resolve(__dirname, "../..");
  const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\./.test(f) && !f.startsWith("src/test/"));

  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    const toWorking = files.filter((f) => /tab=working/.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    // JobPage, DealCard, YourActivity on 2026-10-28.
    expect(toWorking.length).toBeGreaterThanOrEqual(3);
  });

  it("every `tab=working` link names the job with `job=`, never `highlight=`", () => {
    const bad = files.filter((f) => /tab=working&highlight=/.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(bad).toEqual([]);
  });
});
