/**
 * MESSAGES: ONE INBOX WITH FILTER CHIPS (board 13, owner 2026-10-20; it
 * replaced the 10-19 "section tabs, never mixed" rule). Layers checked:
 *   1. the rule (messageSections.ts): All shows every thread, Unread the
 *      unread ones, a section chip its own section's threads plus support
 *      ("Louisiana Helpr Team"); the section chips follow the member's
 *      Customize order and hidden sections, but Jobs stays while it has a
 *      thread; `?section=` falls back to All; the row caption names only a
 *      side the thread knows for certain;
 *   2. the hook (useMessageSections): the chips read All / Unread · n /
 *      sections, the URL picks the chip, a Declutter/Shops/Homes chip with no
 *      threads gets its friendly empty state ("coming soon" while its switch
 *      is off);
 *   3. the screen (ConversationList): the strip renders under the title, the
 *      section empty state replaces "No messages yet" and the Active / All
 *      filter (job states) leaves that tab; Messages.tsx passes the hook's
 *      threads, not the raw inbox.
 *
 * @mutate src/components/messages/messageSections.ts |     return s === "support" \|\| s === section; |     return true;
 * @mutate src/components/messages/messageSections.ts |   if (jobThreads > 0) keep.add("jobs"); |   void 0;
 * @mutate src/pages/messages/useMessageSections.tsx |     (k) => live[k] \|\| conversations.some((c) => threadSection(c) === k), |     (k) => k !== undefined,
 * @mutate src/components/messages/messageSections.ts |   if (filter === "all") return [...list]; |   if (filter === "all") return list.filter((c) => !!c.teamThread);
 * @mutate src/components/messages/messageSections.ts |   if (filter === "unread") return list.filter((c) => c.unread > 0); |   if (filter === "unread") return [...list];
 * @mutate src/components/messages/messageSections.ts |   return "all";\n} |   return "jobs";\n}
 * @mutate src/components/messages/messageSections.ts |   if (c.viewerIsAssignedHelper) return "You're working"; |   if (!c.viewerIsPoster) return "You're working";
 * @mutate src/pages/messages/useMessageSections.tsx |     { value: "unread", label: unread > 0 ? `Unread · ${unread}` : "Unread" }, |     { value: "unread", label: `Unread · ${unread}` },
 * @mutate src/pages/messages/Messages.tsx |       conversations={inbox.conversations} |       conversations={conversations}
 * @mutate src/components/messages/ConversationList.tsx |       {phoneSearchRow}\n      {sectionTabs && ( |       {phoneSearchRow}\n      {false && (
 * @mutate src/pages/messages/useMessageSections.tsx |     mainEmptyBody: mainInboxEmptyBody(live.declutter), |     mainEmptyBody: mainInboxEmptyBody(false),
 * @mutate src/components/messages/ConversationList.tsx |                 body={mainEmptyBody} |                 body={mainInboxEmptyBody(false)}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
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

import { coerceInboxFilter, messageSectionTabs, threadRoleCaption, threadsForFilter, threadsForSection } from "@/components/messages/messageSections";
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

describe("the rule: one inbox, filtered by chips", () => {
  it("All = every thread; Unread = unread threads; a section chip = its own threads plus support", () => {
    expect(KEYS.length).toBeGreaterThan(3);
    expect(threadsForFilter([JOB, TEAM], "all")).toEqual([JOB, TEAM]);
    expect(threadsForFilter([JOB, TEAM], "unread")).toEqual([JOB]);
    for (const k of KEYS) {
      const shown = threadsForSection([JOB, TEAM], k);
      expect(shown, k).toContain(TEAM);
      expect(shown.includes(JOB), k).toBe(k === "jobs");
      expect(threadsForFilter([JOB, TEAM], k)).toEqual(shown);
    }
  });

  it("section chips follow Customize order and hidden sections; Jobs stays while it has a thread; ?section= falls back to All", () => {
    expect(messageSectionTabs(["shops", "jobs"], ["shops", "jobs", "declutter", "homes"], 0)).toEqual(["shops", "jobs"]);
    expect(messageSectionTabs(["shops"], ["jobs", "declutter", "shops", "homes"], 0)).toEqual(["shops"]);
    expect(messageSectionTabs(["shops"], ["jobs", "declutter", "shops", "homes"], 3)).toEqual(["jobs", "shops"]);
    expect(coerceInboxFilter(null, ["shops", "jobs"])).toBe("all");
    expect(coerceInboxFilter("nope", ["shops", "jobs"])).toBe("all");
    expect(coerceInboxFilter("unread", ["shops", "jobs"])).toBe("unread");
    expect(coerceInboxFilter("shops", ["shops", "jobs"])).toBe("shops");
  });

  it("the row caption names only a side the thread knows: your job, or the job you were hired for", () => {
    expect(threadRoleCaption({ viewerIsPoster: true })).toBe("Your job");
    expect(threadRoleCaption({ viewerIsAssignedHelper: true })).toBe("You're working");
    expect(threadRoleCaption({})).toBeNull();
    expect(threadRoleCaption({ teamThread: { userId: "me", viewerIsStaff: false } })).toBeNull();
  });
});

const wrap = (entry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };

describe("the hook", () => {
  it("All (default): every thread, chips All / Unread · n / the OPEN sections, no section empty state", () => {
    const { result } = renderHook(() => useMessageSections([JOB, TEAM], [JOB, TEAM]), { wrapper: wrap("/messages") });
    expect(result.current.section).toBe("all");
    expect(result.current.conversations).toEqual([JOB, TEAM]);
    expect(result.current.sectionEmpty).toBeNull();
    render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
    const chips = screen.getAllByRole("button").map((b) => b.textContent);
    // Declutter is switched off here and has no threads: no chip (owner 2026-10-21).
    expect(chips).toEqual(["All", "Unread · 1", "Jobs", "Shops", "Homes"]);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("with nothing unread the chip reads just 'Unread' (never '· 0')", () => {
    const { result } = renderHook(() => useMessageSections([TEAM], [TEAM]), { wrapper: wrap("/messages") });
    render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument();
  });

  it("an open section with no threads says so and offers Browse; a switched-off one has no chip at all", () => {
    const shops = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=shops") });
    expect(shops.result.current.conversations).toEqual([]);
    expect(shops.result.current.sectionEmpty).toMatchObject({ title: "No Shops messages yet", action: { label: "Browse Shops", to: "/shops" } });
    // A switched-off section has no chip, so its link falls back to All (owner 2026-10-21).
    const declutter = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=declutter") });
    expect(declutter.result.current.section).toBe("all");
    expect(declutter.result.current.sectionEmpty).toBeNull();
  });

  // Owner 2026-10-28 via the lead: the All empty state talked only about jobs
  // (~/.lh-shots/declutter-walk-1028/45-messages-all-empty-jobs-only.png).
  it("the empty All inbox names Declutter while Declutter is on for the member, and only then", () => {
    featureOn.declutter = true;
    const on = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
    expect(on.result.current.mainEmptyBody).toMatch(/Declutter/);
    expect(on.result.current.mainEmptyBody).toMatch(/job/);
    featureOn.declutter = false;
    const off = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
    expect(off.result.current.mainEmptyBody).not.toMatch(/Declutter/);
  });

  it("a hidden section has no chip, and its URL falls back to All", () => {
    prefs.hidden = ["homes"];
    const { result } = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=homes") });
    expect(result.current.section).toBe("all");
  });
});

describe("the screen", () => {
  const renderList = (sectionEmpty: Parameters<typeof ConversationList>[0]["sectionEmpty"], mainEmptyBody?: string) =>
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
          mainEmptyBody={mainEmptyBody}
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
    expect(screen.getByRole("button", { name: "Inbox views and options" })).toBeTruthy();
  });

  it("the empty All inbox shows the line it is handed", () => {
    renderList(null, "Apply to a job, accept a Helpr's offer, or buy or sell on Declutter. Your conversations show up here.");
    expect(screen.getByText(/buy or sell on Declutter/)).toBeInTheDocument();
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/messages/Messages.tsx"), "utf8"));
    expect(src).toMatch(/mainEmptyBody=\{inbox\.mainEmptyBody\}/);
  });

  it("Messages.tsx hands the list the tab's threads, never the raw inbox", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/messages/Messages.tsx"), "utf8"));
    expect(src).toMatch(/conversations=\{inbox\.conversations\}/);
    expect(src).toMatch(/allConversations=\{inbox\.allConversations\}/);
    expect(src).toMatch(/sectionTabs=\{inbox\.strip\}/);
  });
});
