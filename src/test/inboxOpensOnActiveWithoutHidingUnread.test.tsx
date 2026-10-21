/**
 * THE INBOX OPENS ON ALL — AND ACTIVE, WHEN CHOSEN, MAY NOT HIDE UNREAD.
 *
 * (File name kept: OPEN.md cites it by name. Its subject changed on
 * 2026-10-20.)
 *
 * 2026-10-20, Option A: the owner adopted HELPR-DESIGN-SPEC v2 as the design
 * standard, and its Messages rule (§9.7, board 13) is "one inbox, All
 * default". The lead decided under it that the inbox lands on ALL, which
 * supersedes the 2026-09-19 open-on-Active rule. The landing tab is still a
 * CONSTANT (the 2026-08-30 complaint was a landing tab that moved with read
 * state), and All hides nothing, so the "N unread aren't in Active" bar never
 * shows on arrival.
 *
 * THE CLASS is unchanged: **a view that conceals something the user has not
 * read** must name what it hides. Active is `LIVE_JOB_STATUSES`, which
 * excludes `open`, so a reader who CHOOSES Active still gets the bar.
 *
 * Asserted:
 *   1. the seeded tab is All, read from ONE module, and All leads the strip;
 *   2. arriving hides nothing: no bar, even with unread on open postings;
 *   3. once Active is chosen, an unread thread outside it produces a bar that
 *      names the count and moves the reader back to All;
 *   4. nothing is claimed when nothing is hidden (no permanent nag);
 *   4b. the bar's X hides it until a NEW unread lands outside Active (owner,
 *      2026-09-26: "an x in that top bar ... so they can x it out");
 *   5. the Active empty state reads as "nothing running", points at All, and
 *      its button actually WIDENS the view.
 *
 * The loading-frame "held space" bar (MQ28) only renders while loading on
 * Active; since the inbox now loads on All it no longer renders on arrival,
 * and this file asserts that rather than mutating the held branch.
 *
 * @mutate src/lib/inboxDefault.ts | return "all"; | return "active";
 * @mutate src/lib/inboxDefault.ts | INBOX_TAB_ORDER: readonly InboxTab[] = ["all", "active"]; | INBOX_TAB_ORDER: readonly InboxTab[] = ["active", "all"];
 * @mutate src/components/messages/ConversationList.tsx | hiddenUnreadCount > dismissedHiddenUnread && ( | false && (
 * @mutate src/components/messages/ConversationList.tsx | hiddenUnreadCount > dismissedHiddenUnread && ( | hiddenUnreadCount > 0 && (
 * @mutate src/components/messages/HiddenUnreadBar.tsx | if (loading \|\| !userId \|\| count >= dismissedHiddenUnread) return; | return;
 * @mutate src/components/messages/ConversationList.tsx | setInboxFilter(UNFILTERED_INBOX_TAB); }}>\n                  Show all | setInboxFilter("active"); }}>\n                  Show all
 * @mutate src/components/messages/InboxMenus.tsx | aria-checked={inboxTab === key} | aria-checked={key === "all"}
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// jsdom has no layout, so the real virtualizer renders zero rows. Render them
// all, flat, so row ORDER against the banner can be asserted (MQ28).
vi.mock("@/components/VirtualList", () => ({
  VirtualList: <T,>({ items, getKey, renderItem }: {
    items: T[];
    getKey: (item: T, i: number) => string;
    renderItem: (item: T, i: number) => import("react").ReactNode;
  }) => (
    <div>{items.map((it, i) => <div key={getKey(it, i)}>{renderItem(it, i)}</div>)}</div>
  ),
}));
// No network (Q55a): ConversationList's mount-time pin/archive loads read
// thread_pins / thread_archives from Supabase. See the helper.
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

import { ConversationList } from "@/components/messages/ConversationList";
import type { Conversation } from "@/components/messages/types";
import { defaultInboxTab, UNFILTERED_INBOX_TAB, coerceInboxView, INBOX_TAB_ORDER } from "@/lib/inboxDefault";
// The phone header is the shared AppTopBar since Q2231; its bell and avatar
// need the app's providers, and this file tests the list, not the bar.
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title }: { title?: string }) => <header data-testid="app-top-bar"><h1>{title}</h1></header>,
}));


// Phone, so the tabs sit behind the disclosure — the surface where the
// hidden-unread banner matters most, because the tab counts are not on screen.
function setWebDesktop(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: on && /min-width:\s*900px/.test(query),
      media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function convo(over: Partial<Conversation> & { jobId: string }): Conversation {
  return {
    otherUserId: `u-${over.jobId}`,
    otherUserName: `Person ${over.jobId}`,
    jobTitle: `Job ${over.jobId}`,
    lastMessage: "hi",
    lastAt: new Date().toISOString(),
    unread: 0,
    ...over,
  } as Conversation;
}

/** One live thread (in Active) and one unread thread on an OPEN posting. */
const MIXED: Conversation[] = [
  convo({ jobId: "live-1", jobStatus: "in_progress", unread: 0 }),
  convo({ jobId: "open-1", jobStatus: "open", unread: 2 }),
  convo({ jobId: "open-2", jobStatus: "open", unread: 1 }),
];

/** Every thread is live and read — nothing for the banner to report. */
const ALL_LIVE: Conversation[] = [
  convo({ jobId: "live-1", jobStatus: "in_progress", unread: 0 }),
  convo({ jobId: "live-2", jobStatus: "accepted", unread: 1 }),
];

/** A user whose jobs have all finished: Active is empty, All is not. */
const ALL_FINISHED: Conversation[] = [
  convo({ jobId: "done-1", jobStatus: "completed", unread: 0 }),
  convo({ jobId: "done-2", jobStatus: "cancelled", unread: 0 }),
];

function renderInbox(conversations: Conversation[], loading = false, userId: string | null = "user-1") {
  return render(
    <MemoryRouter>
      <ConversationList
        conversations={conversations}
        loading={loading}
        loadError={false}
        retryInbox={vi.fn()}
        userId={userId}
        loadConversations={vi.fn(async () => {})}
        openConvo={vi.fn()}
        setDeleteConvoConfirm={vi.fn()}
        onBatchArchive={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function selectedTabLabel(): string | null {
  const group = screen.queryByRole("group", { name: "Filter conversations" });
  // PHONE since Q2231: Active / All are a radio pair in the search row's one
  // "more" menu, so read the CHECKED item there (and close the menu again).
  if (!group) return checkedInMoreMenu();
  // UnderlineTabs marks the current slice with aria-pressed, not
  // aria-selected — read the control's own contract, not a guessed one.
  const on = within(group)
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-pressed") === "true");
  return on ? (on.textContent ?? "").replace(/\d+/g, "").trim() : null;
}

/** Radix's DropdownMenu opens on a keyboard Enter in jsdom (no pointer events). */
function checkedInMoreMenu(): string | null {
  const trigger = screen.queryByRole("button", { name: "More conversation options" });
  if (!trigger) return null;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  const on = screen
    .queryAllByRole("menuitemradio")
    .filter((el) => el.getAttribute("aria-checked") === "true");
  const label = on.length === 1 ? (on[0].textContent ?? "").trim() : null;
  fireEvent.keyDown(document.activeElement ?? trigger, { key: "Escape" });
  return label;
}

/** Each tab's label -> its count badge, read from the control's own group. */
function tabCounts(): Record<string, number> {
  const group = screen.getByRole("group", { name: "Filter conversations" });
  const out: Record<string, number> = {};
  for (const b of within(group).getAllByRole("button")) {
    const text = b.textContent ?? "";
    const label = text.replace(/\d+/g, "").trim();
    out[label] = Number((text.match(/\d+/) ?? ["0"])[0]);
  }
  return out;
}

function openPhoneDisclosure() {
  const chevron = screen.queryByRole("button", { name: "Filter conversations" });
  if (chevron) fireEvent.click(chevron);
}

/** Pick a tab the way a reader does: the desktop strip, or the phone's "more" menu. */
function chooseTab(label: "All" | "Active") {
  const group = screen.queryByRole("group", { name: "Filter conversations" });
  if (group) {
    const btn = within(group)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").replace(/\d+/g, "").trim() === label);
    if (!btn) throw new Error(`no ${label} tab`);
    fireEvent.click(btn);
    return;
  }
  const trigger = screen.getByRole("button", { name: "More conversation options" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  const item = screen.getAllByRole("menuitemradio").find((el) => (el.textContent ?? "").trim() === label);
  if (!item) throw new Error(`no ${label} menu item`);
  fireEvent.click(item);
}

afterEach(() => { cleanup(); setWebDesktop(false); localStorage.clear(); });

describe("Messages opens on All, and Active (when chosen) says what it is hiding", () => {
  it("the inventory is real: these fixtures contain live, unread-open and finished threads", () => {
    // Guards against the whole file passing on an empty list.
    expect(MIXED.length).toBeGreaterThan(2);
    expect(MIXED.some((c) => c.jobStatus === "in_progress")).toBe(true);
    expect(MIXED.some((c) => c.jobStatus === "open" && c.unread > 0)).toBe(true);
    expect(ALL_FINISHED.every((c) => c.jobStatus === "completed" || c.jobStatus === "cancelled")).toBe(true);
    expect(ALL_FINISHED.length).toBeGreaterThan(0);
  });

  it("the rule itself: the default tab is All, it does not depend on unread count, and it leads the strip", () => {
    // Stable by construction: the 2026-08-30 complaint was a landing tab that
    // moved with read state. Asked with 0 and with 7 unread, same answer.
    expect(defaultInboxTab(0)).toBe("all");
    expect(defaultInboxTab(7)).toBe("all");
    expect(UNFILTERED_INBOX_TAB).toBe("all");
    // The tab you land on is the first one painted.
    expect(INBOX_TAB_ORDER[0]).toBe(defaultInboxTab(0));
    expect([...INBOX_TAB_ORDER].sort()).toEqual(["active", "all"]);
  });

  it("the retired Unread view and unknown values coerce to All rather than an unknown tab", () => {
    expect(coerceInboxView("unread")).toBe("all");
    expect(coerceInboxView("nonsense")).toBe("all");
    expect(coerceInboxView(null)).toBe("all");
    // Real views still pass through untouched.
    expect(coerceInboxView("active")).toBe("active");
    expect(coerceInboxView("pinned")).toBe("pinned");
    expect(coerceInboxView("recentlyDeleted")).toBe("recentlyDeleted");
  });

  it("seeds All on first load (desktop strip), All first, and Active is the narrow slice", () => {
    setWebDesktop(true);
    renderInbox(MIXED);
    expect(selectedTabLabel()).toBe("All");
    // jsdom has no layout, so the TAB COUNTS prove the two slices differ:
    // 1 live thread out of 3, painted All first.
    expect(tabCounts()).toEqual({ All: 3, Active: 1 });
    expect(Object.keys(tabCounts())).toEqual(["All", "Active"]);
  });

  it("seeds All on a phone too (the checked item in the more menu)", () => {
    setWebDesktop(false);
    renderInbox(MIXED);
    expect(selectedTabLabel()).toBe("All");
  });

  it("arriving hides nothing: no bar, even with unread threads on open postings", () => {
    setWebDesktop(false);
    renderInbox(MIXED);
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
    // ...and every unread row is in the list the reader landed on.
    const names = screen.getAllByTestId("row-name").map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(["Person open-1", "Person open-2", "Person live-1"]));
  });

  it("the loading frame holds no bar any more: the inbox loads on All (MQ28 held space is Active-only)", () => {
    setWebDesktop(false);
    localStorage.clear();
    renderInbox(MIXED);
    chooseTab("Active");
    // A settled Active view still records the count for this account...
    expect(localStorage.getItem("helpr_inbox_hidden_unread")).toBe("user-1:2");
    cleanup();
    // ...but the next visit loads on All, which hides nothing.
    const { container } = renderInbox([], true);
    expect(container.textContent).not.toMatch(/aren't in Active/);
    localStorage.clear();
  });

  it("once Active is chosen, it names the unread it is hiding, and the bar moves the reader to All", () => {
    setWebDesktop(false); // phone: the tab counts are behind the menu
    renderInbox(MIXED);
    chooseTab("Active");
    expect(selectedTabLabel()).toBe("Active");

    // TWO unread THREADS are outside the live slice (open-1 and open-2):
    // threads, not messages (open-1 alone carries 2 unread messages).
    const banner = screen.getByRole("button", {
      name: /2 unread conversations aren't in Active/i,
    });
    // ON TOP of the rows (owner, 2026-09-26, MQ28).
    const liveRow = screen.getAllByTestId("row-name")[0];
    expect(
      liveRow.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    fireEvent.click(banner);
    openPhoneDisclosure();
    expect(selectedTabLabel()).toBe("All");
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
  });

  it("the X hides the bar until a new unread lands outside Active", () => {
    setWebDesktop(false);
    localStorage.clear();
    renderInbox(MIXED);
    chooseTab("Active");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
    cleanup();
    // Dismissed stays dismissed on the next visit to Active.
    renderInbox(MIXED);
    chooseTab("Active");
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
    cleanup();
    // A third hidden unread is news: the bar is back, with the new count.
    const MORE = [...MIXED, convo({ jobId: "open-3", jobStatus: "open", unread: 1 })];
    renderInbox(MORE);
    chooseTab("Active");
    expect(screen.getByRole("button", { name: /3 unread conversations aren't in Active/i })).toBeTruthy();
    cleanup();
    // Dismiss at 3, read one (2 hidden), then one more arrives (3 again):
    // the mark fell with the count, so the new one re-shows the bar.
    renderInbox(MORE);
    chooseTab("Active");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    cleanup();
    renderInbox(MIXED);
    chooseTab("Active");
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
    cleanup();
    renderInbox(MORE);
    chooseTab("Active");
    expect(screen.getByRole("button", { name: /3 unread conversations aren't in Active/i })).toBeTruthy();
  });

  it("stays quiet when Active is hiding nothing unread", () => {
    setWebDesktop(false);
    renderInbox(ALL_LIVE);
    chooseTab("Active");
    // ALL_LIVE has an unread thread, but it is IN Active: nothing concealed.
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
  });

  it("a user whose jobs are all finished, on Active, sees 'nothing running' and Show all widens", () => {
    setWebDesktop(false);
    renderInbox(ALL_FINISHED);
    // Arrival is All, so the finished threads are on screen at once.
    expect(screen.queryByText("Nothing here right now")).toBeNull();
    chooseTab("Active");

    expect(screen.getByText("Nothing here right now")).toBeTruthy();
    expect(
      screen.getByText(/No conversations belong to a job that's still running\. Finished ones are under All\./),
    ).toBeTruthy();

    // The button must WIDEN the view.
    const showAll = screen.getByRole("button", { name: /Show all \(2\)/ });
    fireEvent.click(showAll);
    expect(screen.queryByText("Nothing here right now")).toBeNull();
    openPhoneDisclosure();
    expect(selectedTabLabel()).toBe("All");
  });
});
