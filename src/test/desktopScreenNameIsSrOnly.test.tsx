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
 * Registered mutation: painting the name on desktop again (all four desktop
 * cases red, all four phone cases still green).
 * @mutate src/components/job-card/JobListPage.tsx | titleSrOnly={isWebDesktop} | titleSrOnly={false}
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, loading: false }),
}));
vi.mock("@/components/job-card/useActivityActions", () => ({
  useActivityActions: () => ({ expandedJobIds: new Set<string>(), inlineApplicants: {}, applicantErrors: {} }),
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
        <Activity defaultTab={tab} />
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

describe("desktop website (>=900px): the screen name is sr-only, never painted", () => {
  it.each([
    ["My Posts", "posted", "empty"],
    ["My Posts", "posted", "with items"],
    ["My Jobs", "applied", "empty"],
    // THE BUG: an account with no applications. Same line as My Posts above,
    // opposite answer, and the only one of the four screens still painting.
    ["My Jobs", "applied", "with items"],
  ] as const)("%s (%s list, %s)", async (title, tab, fill) => {
    activityData.rows = fill === "empty" ? [] : [ROW];
    setWebDesktop(true);
    renderActivity(tab);

    const h1 = await heading(title);
    // Hidden, never dropped — a screen with no h1 is an a11y defect.
    expect(h1.className).toContain("sr-only");
    expect(h1.className).not.toContain("text-ds-20");
    // And nothing else paints the name either (the search-mode <span> twin).
    expect(screen.queryByText(title, { selector: "span" })).toBeNull();
  });

  it("Messages, the screen the other three were matched to", async () => {
    setWebDesktop(true);
    renderInbox();
    expect((await heading("Messages")).className).toContain("sr-only");
  });
});

describe("phone / native (<900px): the visible title is untouched", () => {
  it.each([
    ["My Posts", "posted", "empty"],
    ["My Posts", "posted", "with items"],
    ["My Jobs", "applied", "empty"],
    ["My Jobs", "applied", "with items"],
  ] as const)("%s (%s list, %s) still paints its name", async (title, tab, fill) => {
    activityData.rows = fill === "empty" ? [] : [ROW];
    setWebDesktop(false);
    renderActivity(tab);

    const h1 = await heading(title);
    // The exact classes ScreenHeaderRow paints — 20px Bodoni, unchanged.
    expect(h1.className).not.toContain("sr-only");
    expect(h1.className).toContain("font-display");
    expect(h1.className).toContain("text-ds-20");
  });

  it("Messages too", async () => {
    setWebDesktop(false);
    renderInbox();
    expect((await heading("Messages")).className).not.toContain("sr-only");
  });
});
