/**
 * FINISHED THREADS AUTO-HIDE FROM ALL. THEY ARE NEVER DELETED, AND NEVER
 * HIDDEN WHILE UNREAD.
 *
 * Owner, 2026-09-19: "keep them, auto-hide after a while. Never delete."
 *
 * WHY DELETION IS OFF THE TABLE, and why that makes this a guard rather than
 * a nicety: a finished job's thread is EVIDENCE on precisely the jobs most
 * likely to be argued about. The dispute flow's "Timeline & Evidence" control
 * reads the thread; the safety ladder (`reports`, `user_violations`,
 * `message_violation_ladder`, `apply_message_scan_consequence`) escalates on
 * the COUNT of `messages` rows, so removing rows would quietly de-escalate a
 * repeat offender; and a completed job's messaging closes at +24h exactly so
 * a dispute window still has a record to look at.
 *
 * THE CLASS this guards: an automatic rule that removes something from a view
 * without leaving a way back to it. Three properties make "hidden" honest
 * rather than "deleted with extra steps", and all three are asserted here —
 *   1. the threshold is DERIVED from live server rules, not picked round;
 *   2. unread is never hidden, at any age;
 *   3. search still finds what the rule tucked away.
 * Plus the boundary that keeps a bug from hiding inside the rule: a thread
 * with no server-derived closing instant must never age out (fail-open).
 *
 * @mutate src/components/messages/threadAgeOut.ts | if (convo.unread > 0) return false; | if (false) return false;
 * @mutate src/components/messages/threadAgeOut.ts | export const REVIEW_BLIND_HOLD_DAYS = 14; | export const REVIEW_BLIND_HOLD_DAYS = 0;
 * @mutate src/components/messages/threadAgeOut.ts | if (Number.isNaN(closedAt)) return false; | if (Number.isNaN(closedAt)) return true;
 * @mutate src/components/messages/ConversationList.tsx | searching\n                ? orderedConversations\n                : allTabConversations | allTabConversations
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

import { ConversationList } from "@/components/messages/ConversationList";
import type { Conversation } from "@/components/messages/types";
import {
  isThreadAgedOut,
  THREAD_AGE_OUT_DAYS,
  REVIEW_WINDOW_DAYS,
  REVIEW_BLIND_HOLD_DAYS,
  FINISHED_JOB_STATUSES,
} from "@/components/messages/threadAgeOut";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

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
    lastAt: new Date(NOW).toISOString(),
    unread: 0,
    ...over,
  } as Conversation;
}

/** A thread whose job closed `days` ago. */
function closedDaysAgo(jobId: string, days: number, over: Partial<Conversation> = {}) {
  return convo({
    jobId,
    jobStatus: "completed",
    messagingClosesAt: new Date(NOW - days * DAY).toISOString(),
    ...over,
  });
}

afterEach(() => { cleanup(); setWebDesktop(false); vi.useRealTimers(); });

describe("threadAgeOut — the rule", () => {
  it("the threshold is DERIVED from the two live server rules, not chosen round", () => {
    // `public.can_review_job` on prod: completion must be within 30 days.
    expect(REVIEW_WINDOW_DAYS).toBe(30);
    // `public.set_review_visibility` on prod: a first-and-only review is held
    // invisible for 14 days, so the reply window opens only after it.
    expect(REVIEW_BLIND_HOLD_DAYS).toBe(14);
    // The last day the product itself can still send someone back here.
    expect(THREAD_AGE_OUT_DAYS).toBe(REVIEW_WINDOW_DAYS + REVIEW_BLIND_HOLD_DAYS);
    // Stated explicitly too, so a change to either leg is a visible decision.
    expect(THREAD_AGE_OUT_DAYS).toBe(44);
  });

  it("only FINISHED work ages out — live and open jobs never do, at any age", () => {
    expect([...FINISHED_JOB_STATUSES].sort()).toEqual(["cancelled", "completed"]);
    for (const status of ["open", "accepted", "in_progress", "disputed", "pending_approval", "revision_requested"]) {
      const ancient = convo({
        jobId: `x-${status}`,
        jobStatus: status,
        messagingClosesAt: new Date(NOW - 900 * DAY).toISOString(),
      });
      expect(isThreadAgedOut(ancient, NOW), `${status} must never age out`).toBe(false);
    }
  });

  it("the boundary: still shown ON day 44, hidden after it", () => {
    expect(isThreadAgedOut(closedDaysAgo("a", THREAD_AGE_OUT_DAYS - 1), NOW)).toBe(false);
    expect(isThreadAgedOut(closedDaysAgo("b", THREAD_AGE_OUT_DAYS), NOW)).toBe(false);
    expect(isThreadAgedOut(closedDaysAgo("c", THREAD_AGE_OUT_DAYS + 1), NOW)).toBe(true);
    // A cancelled job is closed on the instant of cancellation, and ages from
    // there on the same clock.
    expect(isThreadAgedOut(closedDaysAgo("d", 100, { jobStatus: "cancelled" }), NOW)).toBe(true);
    expect(isThreadAgedOut(closedDaysAgo("e", 2, { jobStatus: "cancelled" }), NOW)).toBe(false);
  });

  it("UNREAD is never hidden, however old", () => {
    // The whole point. A default view must not conceal something the reader
    // has not read — the same principle the Active default ships with.
    const oldUnread = closedDaysAgo("unread-1", 900, { unread: 1 });
    expect(isThreadAgedOut(oldUnread, NOW)).toBe(false);
    // ...and the identical thread, read, does age out — so the exemption is
    // doing the work and not some other condition.
    expect(isThreadAgedOut({ ...oldUnread, unread: 0 }, NOW)).toBe(true);
  });

  it("fail-OPEN: no server-derived closing instant means never hidden", () => {
    // `messagingClosesAt` comes from `get_messaging_closes_at`. An undeployed
    // RPC, a failed fetch or a non-party caller all yield null, and hiding on
    // a missing value would hide threads for a reason that is not about them.
    expect(isThreadAgedOut(convo({ jobId: "n1", jobStatus: "completed" }), NOW)).toBe(false);
    expect(isThreadAgedOut(convo({ jobId: "n2", jobStatus: "completed", messagingClosesAt: null }), NOW)).toBe(false);
    expect(isThreadAgedOut(convo({ jobId: "n3", jobStatus: "completed", messagingClosesAt: "not a date" }), NOW)).toBe(false);
  });
});

/* The inbox: three old finished threads (one still unread), one recently
   finished, one live. The All tab should hold everything except the two old,
   read, finished ones. */
const INBOX: Conversation[] = [
  convo({ jobId: "live-1", jobStatus: "in_progress" }),
  closedDaysAgo("recent-1", 3),
  closedDaysAgo("ancient-1", 200),
  closedDaysAgo("ancient-2", 90, { jobStatus: "cancelled" }),
  closedDaysAgo("ancient-unread", 300, { unread: 4, otherUserName: "Thibodeaux" }),
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

function tabCount(label: string): number {
  const group = screen.getByRole("group", { name: "Filter conversations" });
  const tab = within(group).getAllByRole("button").find((b) => (b.textContent ?? "").startsWith(label));
  return Number(((tab?.textContent ?? "").match(/\d+/) ?? ["-1"])[0]);
}

describe("threadAgeOut — the All tab", () => {
  it("the inventory is real: the fixture contains threads on both sides of the rule", () => {
    // Without this, every assertion below could pass on a list where nothing
    // is old enough to hide and nothing is young enough to keep.
    expect(INBOX.length).toBe(5);
    expect(INBOX.filter((c) => isThreadAgedOut(c, NOW)).length).toBe(2);
    expect(INBOX.filter((c) => !isThreadAgedOut(c, NOW)).length).toBe(3);
  });

  it("All holds back the old, read, finished threads — and says how many", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setWebDesktop(true);
    renderInbox(INBOX);

    fireEvent.click(within(screen.getByRole("group", { name: "Filter conversations" }))
      .getAllByRole("button").find((b) => (b.textContent ?? "").startsWith("All"))!);

    // 5 threads, 2 tucked away.
    expect(tabCount("All")).toBe(3);
    expect(
      screen.getByText(new RegExp(`2 finished conversations are older than ${THREAD_AGE_OUT_DAYS} days`)),
      "hiding silently is how 'hidden' becomes 'I lost my messages'",
    ).toBeTruthy();
    // The unread ancient thread is NOT one of them.
    expect(screen.queryByText(/3 finished conversations/)).toBeNull();
  });

  it("SEARCH still reaches an aged-out thread — hiding is not deleting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setWebDesktop(true);
    const { container } = renderInbox(INBOX);

    fireEvent.click(within(screen.getByRole("group", { name: "Filter conversations" }))
      .getAllByRole("button").find((b) => (b.textContent ?? "").startsWith("All"))!);

    // Open the search field and look for the 200-day-old finished thread.
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const input = container.querySelector('input[type="text"], input[type="search"]') as HTMLInputElement;
    expect(input, "the inbox must have a search field").not.toBeNull();
    fireEvent.change(input, { target: { value: "ancient-1" } });

    // The proof is the ABSENCE of the "no matches" state: if the age rule
    // applied to a search, this query would find nothing at all.
    expect(
      screen.queryByText(/No conversations match/i),
      "an aged-out thread must still be findable, or it is deleted with extra steps",
    ).toBeNull();
    // And the aged-out note comes off while searching — it is a statement
    // about the resting list, not about the search result.
    expect(screen.queryByText(/finished conversations are older than/)).toBeNull();
  });
});
