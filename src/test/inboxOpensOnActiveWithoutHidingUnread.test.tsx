/**
 * THE INBOX OPENS ON ACTIVE — AND MAY NOT HIDE ANYTHING UNREAD WHILE IT DOES.
 *
 * Owner, 2026-09-19: "for messages the page should open to unread or active."
 * Shown the 2026-08-30 history (the Unread-when-unread default was removed
 * because "the inbox's default view moved around depending on read state"),
 * they chose ACTIVE — a landing tab that is a constant, not a function of
 * what you have read.
 *
 * THE CLASS, not the instance. The defect this guards is not "the wrong tab
 * is selected"; it is **a default view that conceals something the user has
 * not read**. Active is `LIVE_JOB_STATUSES`, which excludes `open` — so an
 * applicant's unread question on a posting you have not awarded yet, the most
 * common unread thread a poster gets, is NOT in the tab the app now opens on.
 * Any narrowing default has to carry an escape hatch that names the number it
 * is hiding, or it is a silent-loss bug.
 *
 * Four things are asserted, and each one has failed in a previous life of
 * this screen:
 *   1. the seeded tab is Active (and the rule is read from ONE module);
 *   2. an unread thread outside the live slice produces a banner that names
 *      the count and moves the reader to All;
 *   3. nothing is claimed when nothing is hidden (no permanent nag);
 *   4. the Active empty state reads as "nothing running", points at All, and
 *      its button actually WIDENS the view — the button used to be wired to
 *      `DEFAULT_INBOX_TAB`, which since today is Active itself, i.e. a no-op.
 *
 * @mutate src/lib/inboxDefault.ts | return "active"; | return "all";
 * @mutate src/components/messages/ConversationList.tsx | hiddenUnreadCount > 0 && ( | false && (
 * @mutate src/components/messages/ConversationList.tsx | setInboxFilter(UNFILTERED_INBOX_TAB); }}>\n                  Show All | setInboxFilter(DEFAULT_INBOX_TAB); }}>\n                  Show All
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
import { defaultInboxTab, UNFILTERED_INBOX_TAB, coerceInboxView } from "@/lib/inboxDefault";

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

function renderInbox(conversations: Conversation[]) {
  return render(
    <MemoryRouter>
      <ConversationList
        conversations={conversations}
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

function selectedTabLabel(): string | null {
  const group = screen.queryByRole("group", { name: "Filter conversations" });
  if (!group) return null;
  // UnderlineTabs marks the current slice with aria-pressed, not
  // aria-selected — read the control's own contract, not a guessed one.
  const on = within(group)
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-pressed") === "true");
  return on ? (on.textContent ?? "").replace(/\d+/g, "").trim() : null;
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

afterEach(() => { cleanup(); setWebDesktop(false); });

describe("Messages opens on Active, and says what Active is hiding", () => {
  it("the inventory is real: these fixtures contain live, unread-open and finished threads", () => {
    // Guards against the whole file passing on an empty list. Every assertion
    // below is about which threads are shown, so an empty inbox would render
    // the global "No messages yet" state and satisfy nothing.
    expect(MIXED.length).toBeGreaterThan(2);
    expect(MIXED.some((c) => c.jobStatus === "in_progress")).toBe(true);
    expect(MIXED.some((c) => c.jobStatus === "open" && c.unread > 0)).toBe(true);
    expect(ALL_FINISHED.every((c) => c.jobStatus === "completed" || c.jobStatus === "cancelled")).toBe(true);
    expect(ALL_FINISHED.length).toBeGreaterThan(0);
  });

  it("the rule itself: the default tab is Active, and it does not depend on unread count", () => {
    // Stable by construction — the 2026-08-30 complaint was that the landing
    // tab moved with read state. Asked with 0 and with 7 unread, same answer.
    expect(defaultInboxTab(0)).toBe("active");
    expect(defaultInboxTab(7)).toBe("active");
    // And "unfiltered" is a DIFFERENT value, or every "Show All" is a no-op.
    expect(UNFILTERED_INBOX_TAB).toBe("all");
    expect(UNFILTERED_INBOX_TAB).not.toBe(defaultInboxTab(0));
  });

  it("the retired Unread view coerces to Active rather than rendering an unknown tab", () => {
    // A session open across today's change, or any future stored/linked tab
    // value, must not land on a highlighted-nothing empty list.
    expect(coerceInboxView("unread")).toBe("active");
    expect(coerceInboxView("nonsense")).toBe("active");
    expect(coerceInboxView(null)).toBe("active");
    // Real views still pass through untouched.
    expect(coerceInboxView("all")).toBe("all");
    expect(coerceInboxView("pinned")).toBe("pinned");
    expect(coerceInboxView("recentlyDeleted")).toBe("recentlyDeleted");
  });

  it("seeds Active on first load, and Active is the narrow slice", () => {
    setWebDesktop(true);
    renderInbox(MIXED);
    expect(selectedTabLabel()).toBe("Active");
    // The rows themselves are virtualized (VirtualList) and jsdom's viewport
    // has no height, so the TAB COUNTS are what proves the two slices differ:
    // 1 live thread out of 3. Reading the counts also catches a tab whose
    // number disagrees with its own filter, which is its own class of lie.
    expect(tabCounts()).toEqual({ Active: 1, All: 3 });
  });

  it("names the unread it is hiding, and the banner moves the reader to All", () => {
    setWebDesktop(false); // phone: the tab counts are behind the disclosure
    renderInbox(MIXED);

    // TWO unread THREADS are outside the live slice (open-1 and open-2) —
    // threads, not messages: open-1 alone carries 2 unread messages, and
    // counting those would say "3", which is not the number of conversations
    // the reader cannot see.
    const banner = screen.getByRole("button", {
      name: /2 unread conversations aren't in Active/i,
    });
    expect(banner).toBeTruthy();

    // BELOW the rows (owner, 2026-09-26, MQ28): above them, its arrival
    // pushed every row down. The live row must come first in the document.
    const liveRow = screen.getAllByTestId("row-name")[0];
    expect(
      liveRow.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(banner);
    openPhoneDisclosure();
    expect(selectedTabLabel()).toBe("All");
    // ...and the banner is gone, because All is not hiding them any more.
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
  });

  it("stays quiet when Active is hiding nothing unread", () => {
    setWebDesktop(false);
    renderInbox(ALL_LIVE);
    // ALL_LIVE has an unread thread, but it is IN Active — nothing concealed,
    // so no banner. A banner that always shows is a nag, not a safeguard.
    expect(screen.queryByText(/aren't in Active/i)).toBeNull();
  });

  it("a user whose jobs are all finished sees 'nothing running', not a broken inbox", () => {
    setWebDesktop(false);
    renderInbox(ALL_FINISHED);

    expect(screen.getByText("Nothing here right now")).toBeTruthy();
    expect(
      screen.getByText(/No conversations belong to a job that's still running\. Finished ones are under All\./),
    ).toBeTruthy();

    // The button must WIDEN the view. Wired to the default tab it would set
    // Active from Active and do nothing — which is exactly what conflating
    // DEFAULT_INBOX_TAB with "unfiltered" would produce.
    const showAll = screen.getByRole("button", { name: /Show All \(2\)/ });
    fireEvent.click(showAll);
    expect(screen.queryByText("Nothing here right now")).toBeNull();
    openPhoneDisclosure();
    expect(selectedTabLabel()).toBe("All");
  });
});
