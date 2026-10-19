/**
 * MESSAGES: ONE SCREEN WITH SECTION TABS, NEVER MIXED (owner, 2026-10-19,
 * PROMPT-LEAD "Global organization"). Layers checked:
 *   1. the rule (messageSections.ts): a tab lists only its own section's
 *      threads plus support ("Louisiana Helpr Team") threads; the tabs follow
 *      the member's Customize order and hidden sections, but Jobs stays while
 *      it has a thread (hiding a section never makes a conversation
 *      unreachable); `?section=` falls back to Jobs;
 *   2. the hook (useMessageSections): the strip lists those tabs, the URL picks
 *      the tab, a Declutter/Shops/Homes tab with no threads gets its friendly
 *      empty state ("coming soon" while its switch is off), Jobs gets none;
 *   3. the screen (ConversationList): the strip renders under the title, the
 *      section empty state replaces "No messages yet" and the Active / All
 *      filter (job states) leaves that tab; Messages.tsx passes the hook's
 *      threads, not the raw inbox.
 *
 * @mutate src/components/messages/messageSections.ts |     return s === "support" \|\| s === section; |     return true;
 * @mutate src/components/messages/messageSections.ts |   if (jobThreads > 0) keep.add("jobs"); |
 * @mutate src/components/messages/messageSections.ts |   return tabs.includes("jobs") ? "jobs" : tabs[0]; |   return tabs[0];
 * @mutate src/pages/messages/Messages.tsx |       conversations={inbox.conversations} |       conversations={conversations}
 * @mutate src/components/messages/ConversationList.tsx |           {sectionTabs && !searchOpen && !selectMode && ( |           {false && (
 * @mutate src/components/messages/ConversationList.tsx |           {!isWebDesktop && tabsOpen && !sectionEmpty && !searchOpen && !selectMode && ( |           {!isWebDesktop && tabsOpen && !searchOpen && !selectMode && (
 * @mutate src/pages/messages/useMessageSections.tsx |     empty = live[section] |     empty = true
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sofa } from "lucide-react";
import type { Conversation } from "@/components/messages/types";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
// The member's switches and Customize choice are inputs here, not what is under test.
const featureOn: Record<string, boolean> = { declutter: false, shops: true, rentals: true };
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => featureOn[k] ?? false }));
const prefs = { order: ["jobs", "declutter", "shops", "homes"] as SectionKey[], hidden: [] as SectionKey[] };
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS: S } = await import("@/components/sections/sectionsConfig");
  return {
    useSectionPrefs: () => ({
      prefs,
      visible: prefs.order.filter((k) => !prefs.hidden.includes(k)).map((k) => S.find((s) => s.key === k)!),
      setHidden: vi.fn(),
      move: vi.fn(),
    }),
  };
});

import { coerceMessageSection, messageSectionTabs, threadsForSection } from "@/components/messages/messageSections";
import { useMessageSections } from "@/pages/messages/useMessageSections";
import { ConversationList } from "@/components/messages/ConversationList";
// The phone header is the shared AppTopBar since Q2231; its bell and avatar
// need the app's providers, and this file tests the list, not the bar.
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title }: { title?: string }) => <header data-testid="app-top-bar"><h1>{title}</h1></header>,
}));


afterEach(() => {
  cleanup();
  prefs.order = ["jobs", "declutter", "shops", "homes"];
  prefs.hidden = [];
});

const convo = (over: Partial<Conversation>): Conversation =>
  ({
    otherUserId: "u2",
    otherUserName: "Pat",
    jobTitle: "Mow the lawn",
    jobId: "job-1",
    jobStatus: "accepted",
    lastMessage: "hi",
    lastAt: "2026-10-19T00:00:00Z",
    unread: 0,
    ...over,
  }) as Conversation;
const JOB = convo({ jobId: "job-1", unread: 2 });
const TEAM = convo({ jobId: "team:me", otherUserName: "Louisiana Helpr Team", teamThread: { userId: "me", viewerIsStaff: false } });
const KEYS = SECTIONS.map((s) => s.key);

describe("the rule: never mixed", () => {
  it("each tab lists its own threads plus support; Jobs threads appear on no other tab", () => {
    expect(KEYS.length).toBeGreaterThan(3);
    for (const k of KEYS) {
      const shown = threadsForSection([JOB, TEAM], k);
      expect(shown, k).toContain(TEAM);
      expect(shown.includes(JOB), k).toBe(k === "jobs");
    }
  });

  it("tabs follow Customize order and hidden sections; Jobs stays while it has a thread; ?section= falls back to Jobs", () => {
    expect(messageSectionTabs(["shops", "jobs"], ["shops", "jobs", "declutter", "homes"], 0)).toEqual(["shops", "jobs"]);
    expect(messageSectionTabs(["shops"], ["jobs", "declutter", "shops", "homes"], 0)).toEqual(["shops"]);
    expect(messageSectionTabs(["shops"], ["jobs", "declutter", "shops", "homes"], 3)).toEqual(["jobs", "shops"]);
    expect(coerceMessageSection(null, ["shops", "jobs"])).toBe("jobs");
    expect(coerceMessageSection("nope", ["shops", "jobs"])).toBe("jobs");
    expect(coerceMessageSection("shops", ["shops", "jobs"])).toBe("shops");
  });
});

const wrap = (entry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };

describe("the hook", () => {
  it("Jobs (default): the job + support threads, a strip of the four tabs, no section empty state", () => {
    const { result } = renderHook(() => useMessageSections([JOB, TEAM], [JOB, TEAM]), { wrapper: wrap("/messages") });
    expect(result.current.section).toBe("jobs");
    expect(result.current.conversations).toEqual([JOB, TEAM]);
    expect(result.current.sectionEmpty).toBeNull();
    render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual(["Jobs", "Declutter", "Shops", "Homes"]);
  });

  it("an open section with no threads says so and offers Browse; a switched-off one says coming soon", () => {
    const shops = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=shops") });
    expect(shops.result.current.conversations).toEqual([]);
    expect(shops.result.current.sectionEmpty).toMatchObject({ title: "No Shops messages yet", action: { label: "Browse Shops", to: "/shops" } });
    const declutter = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=declutter") });
    expect(declutter.result.current.sectionEmpty).toMatchObject({ title: "Declutter is coming soon" });
    expect(declutter.result.current.sectionEmpty?.action).toBeUndefined();
  });

  it("a hidden section has no tab, and its URL falls back to Jobs", () => {
    prefs.hidden = ["homes"];
    const { result } = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=homes") });
    expect(result.current.section).toBe("jobs");
  });
});

describe("the screen", () => {
  const renderList = (sectionEmpty: Parameters<typeof ConversationList>[0]["sectionEmpty"]) =>
    render(
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
          sectionTabs={<div>SECTION STRIP</div>}
          sectionEmpty={sectionEmpty}
        />
      </MemoryRouter>,
    );

  it("a section tab with no threads: the strip, its own empty state, no Active / All filter", () => {
    renderList({ icon: Sofa, title: "No Declutter messages yet", body: "b", action: { label: "Browse Declutter", to: "/declutter" } });
    expect(screen.getByText("SECTION STRIP")).toBeInTheDocument();
    expect(screen.getByText("No Declutter messages yet")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).toBeNull();
    expect(screen.queryByRole("button", { name: /conversation filters|filter conversations/i })).toBeNull();
    expect(screen.queryByRole("menuitemradio", { name: /^(Active|All)/ })).toBeNull();
    expect(document.getElementById("inbox-filter-tabs")).toBeNull();
  });

  it("the Jobs tab keeps the Jobs empty state, whose action goes to Jobs > Browse", () => {
    renderList(null);
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
    // Phone (Q2231): Active / All are reachable from the search row's more menu.
    expect(screen.getByRole("button", { name: "More conversation options" })).toBeTruthy();
  });

  it("Messages.tsx hands the list the tab's threads, never the raw inbox", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/messages/Messages.tsx"), "utf8"));
    expect(src).toMatch(/conversations=\{inbox\.conversations\}/);
    expect(src).toMatch(/allConversations=\{inbox\.allConversations\}/);
    expect(src).toMatch(/sectionTabs=\{inbox\.strip\}/);
  });
});
