/**
 * CLASS CHECK: on the desktop website, a list screen does not PAINT its own
 * page name.
 *
 * Owner decision, 2026-09-19, from the browser-verification pass: at 1440,
 * /home, /posts and /messages all render their h1 `sr-only`, and
 * /jobs was the only one still painting "My Jobs" in 20px Bodoni — so
 * moving Posts → Jobs → Messages made a title appear and vanish. The app bar
 * and the right rail already name the page.
 *
 * WHY /jobs AND /posts DIVERGED — they don't, by route. Both are
 * `src/components/job-card/JobListPage.tsx` (`defaultTab="posted"` / `"applied"`), rendering
 * ONE expression:
 *
 *     titleSrOnly={isWebDesktop && !isTrulyEmpty}
 *
 * `isTrulyEmpty` is `sourceCount === 0` for THIS tab. An account with posts
 * and no applications is therefore truly-empty on My Jobs and not on My
 * Posts — the same line, the opposite answer, which is exactly the pair of
 * screenshots the verification lane measured. The `!isTrulyEmpty` escape
 * hatch (external QA, 2026-09-07) is gone; Messages
 * (`titleSrOnly={embedded || isWebDesktop}`) never had one.
 *
 * The assertion is over the CLASS — every tab, empty and non-empty, plus
 * Messages — because the defect was never "My Jobs"; it was a screen-name
 * rule with a data-dependent hole in it.
 *
 * Shown able to fail: restoring `&& !isTrulyEmpty` turns both empty cases red
 * ("expected the h1 to be sr-only") and leaves every other case green.
 *
 * RE-POINTED 2026-10-19 (Q2205). My Posts / My Jobs became Jobs > Posted /
 * Working, under the section's own top bar, whose title the owner's final
 * section decisions show at every width (title · + · bell · profile). The
 * class this file exists for — a screen-name rule with a DATA-DEPENDENT HOLE
 * — is what is still pinned for the list: the page renders the section header
 * (and so its one h1) the same way empty or full, phone or desktop, and adds
 * no heading of its own. Messages keeps its own rule below.
 *
 * Registered mutation: the header dropped on an empty desktop list (both
 * desktop empty cases red, everything else green).
 * @mutate src/components/job-card/JobListPage.tsx |           {isWebDesktop && ( |           {isWebDesktop && !showEmptyState && (
 */
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// No network (Q55a): ConversationList's mount-time pin/archive loads read
// thread_pins / thread_archives from Supabase. See the helper.
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
  useCurrentUser: () => ({ user: { id: "user-1" }, loading: false }),
}));
vi.mock("@/components/job-card/useActivityActions", () => ({
  useActivityActions: () => ({ expandedJobIds: new Set<string>(), inlineApplicants: {}, applicantErrors: {}, tip: { target: null, open: () => {}, close: () => {} } }),
}));
vi.mock("@/components/job-card/ActivityDialogs", () => ({ ActivityDialogs: () => null }));
// The two tab bodies are lazy chunks; their contents are irrelevant here and
// their real prop surfaces are enormous. Stub them so the NON-empty case
// renders synchronously and the assertion is about the header row only.
vi.mock("@/pages/posts/PostedJobsTab", () => ({
  PostedJobsTab: () => <div data-testid="posted-tab" />,
}));
vi.mock("@/pages/jobs/AppliedJobsTab", () => ({
  AppliedJobsTab: () => <div data-testid="applied-tab" />,
}));
// Q1465: the empty posted state also mounts the visit-payment card, which
// reads Supabase; it is irrelevant to the header row asserted here.
vi.mock("@/pages/posts/postedJobs/RecurringVisitPayments", () => ({
  RecurringVisitPayments: () => null,
}));

const activityData = {
  rows: [] as unknown[],
};
vi.mock("@/hooks/useActivityData", () => ({
  useActivityData: (_user: unknown, tab: string) => ({
    loading: false,
    loadError: false,
    postedJobs: tab === "posted" ? activityData.rows : [],
    appliedApps: tab === "applied" ? activityData.rows : [],
    applicantCounts: {},
    pendingApplicantCounts: {},
    helperNames: {},
    helperAvatars: {},
    completedJobMeta: {},
    declinedJobIds: new Set<string>(),
    helperReviewedJobIds: new Set<string>(),
    latestTracking: {},
    groupHelpersByJob: {},
    refresh: vi.fn(async () => {}),
  }),
}));

import Activity from "@/components/job-card/JobListPage";
import { ConversationList } from "@/components/messages/ConversationList";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/** The exact gate `useIsWebDesktop` reads (min-width: 900px, non-native). */
function setWebDesktop(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: on && /min-width:\s*900px/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** A post / application row, enough for the lists to be non-empty. */
const ROW = {
  id: "job-1",
  title: "Mow the lawn",
  status: "open",
  created_at: "2026-09-19T12:00:00.000Z",
  date_needed: jobLocalDateISO(0),
  budget: 60,
  jobs: { id: "job-1", title: "Mow the lawn", status: "open", date_needed: jobLocalDateISO(0) },
};

function renderActivity(tab: "posted" | "applied") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[tab === "posted" ? "/posts" : "/jobs"]}>
        <Activity defaultTab={tab} embeddedHeader={<h1 className="text-page-title">Jobs</h1>} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderInbox() {
  return render(
    <MemoryRouter>
      <ConversationList
        conversations={[]}
        loading={false}
        loadError={false}
        retryInbox={vi.fn()}
        userId="user-1"
        loadConversations={vi.fn(async () => {})}
        openConvo={vi.fn()}
        setDeleteConvoConfirm={vi.fn()}
        onBatchArchive={vi.fn()}
      />
    </MemoryRouter>,
  );
}

/** The screen's single h1, whatever else is on the page. */
async function heading(name: string) {
  return await waitFor(() => screen.getByRole("heading", { level: 1, name }));
}

beforeEach(() => {
  activityData.rows = [];
  // jsdom implements no scrollTo; Activity's scroll container calls it on
  // every filter change. Not what this file is about.
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = () => {};
  }
});

afterEach(() => {
  cleanup();
  setWebDesktop(false);
});

describe("desktop website (>=900px): the list adds no screen name and drops none", () => {
  it.each([
    ["posted", "empty"],
    ["posted", "with items"],
    ["applied", "empty"],
    ["applied", "with items"],
  ] as const)("Jobs > %s (%s): the section header's h1 is the only one", async (tab, fill) => {
    activityData.rows = fill === "empty" ? [] : [ROW];
    setWebDesktop(true);
    renderActivity(tab);
    await heading("Jobs");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /My (Posts|Jobs)/ })).toBeNull();
  });

  it("Messages keeps its desktop rule: the name is sr-only", async () => {
    setWebDesktop(true);
    renderInbox();
    expect((await heading("Messages")).className).toContain("sr-only");
  });
});

describe("phone / native (<900px): the same, at phone width", () => {
  it.each([
    ["posted", "empty"],
    ["posted", "with items"],
    ["applied", "empty"],
    ["applied", "with items"],
  ] as const)("Jobs > %s (%s): the section header's h1 is the only one", async (tab, fill) => {
    activityData.rows = fill === "empty" ? [] : [ROW];
    setWebDesktop(false);
    renderActivity(tab);
    const h1 = await heading("Jobs");
    expect(h1.className).not.toContain("sr-only");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("Messages too", async () => {
    setWebDesktop(false);
    renderInbox();
    expect((await heading("Messages")).className).not.toContain("sr-only");
  });
});
