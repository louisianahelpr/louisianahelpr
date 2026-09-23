/**
 * A THREAD CANCELLED WHILE YOU ARE TYPING CLOSES IN PLACE — NOT ON THE TAP.
 *
 * ── THE DEFECT, MEASURED ON PROD 2026-09-19 ────────────────────────────────
 * Text in the composer; the other party cancels. The "Job cancelled" system
 * bubble arrived LIVE — so the app already knew — but the header still read
 * OPEN and the composer stayed enabled. `threadClosed` derived only from
 * `activeConvo.messagingClosesAt`, fetched once at inbox load, and nothing
 * re-asked. Pressing Send was what "fixed" it: RLS refused with 42501,
 * sendHandlers re-read the job, the chip flipped to CANCELLED, and the typed
 * text became a failed "Not Sent — Conversation Closed" bubble.
 *
 * That is fail-on-tap, which ChatComposer's own header says this codebase
 * rejects. It also made the dashed `thread-closed-unsent-draft` box —
 * whose comment describes this exact cancellation case — unreachable on it,
 * because the draft had already been consumed into the failed bubble.
 *
 * ── THE CLASS THIS GUARDS ─────────────────────────────────────────────────
 * "A cancelled thread shows a notice" was already true and already tested
 * (cancelledJobThreadClosesImmediately) — for a thread OPENED after the
 * cancellation. The defect is entirely in the transition, so the guard is in
 * three layers, each of which was independently broken or absent:
 *
 *   1. DERIVATION. Every announcement the database trigger can write is read
 *      back into the status it announces. The inventory is parsed out of the
 *      trigger migration's own CASE arms, so a new transition added in SQL
 *      that the client cannot read is a failure here, not a surprise in
 *      production.
 *   2. DELIVERY. BOTH realtime listeners hand the announcement on. The
 *      trigger writes it with the poster as `sender_id` and the other
 *      participant as `receiver_id`, so each party sees it on a different
 *      listener — wiring one is a fix for exactly half the users.
 *   3. THE SCREEN. ChatView flips to closed on the prop change alone, with no
 *      send, no refetch and no tap — and the draft it was holding is STILL
 *      there, which is what routes it to the "Not sent" box instead of a
 *      failed bubble.
 *
 * @mutate src/components/messages/jobStatusAnnouncement.ts | { matches: /\bcancell?ed\b/i, jobStatus: "cancelled", closesAt: (at) => at }, | { matches: /\bcancell?ed\b/i, jobStatus: "cancelled", closesAt: null },
 * @mutate src/components/messages/jobStatusAnnouncement.ts | messagingClosesAt: patch.messagingClosesAt ?? convo.messagingClosesAt, | messagingClosesAt: convo.messagingClosesAt,
 * @mutate src/pages/messages/useMessagesRealtime.ts | if (msg.is_system) onJobStatusAnnouncement(msg);\n      // Same-job is not enough | // Same-job is not enough
 * @mutate src/pages/messages/useMessagesRealtime.ts | if (msg.is_system) onJobStatusAnnouncement(msg);\n          // Only echo into the active thread | // Only echo into the active thread
 * @mutate src/pages/messages/useMessagesRealtime.ts | if (payload.eventType === "INSERT") onInboundInsert(payload); | if (payload.eventType !== "DELETE") onInboundInsert(payload);
 * @mutate src/pages/messages/useMessagesRealtime.ts | else if (payload.eventType === "UPDATE") onInboundUpdate(payload); | void onInboundUpdate;
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";

const hoisted = vi.hoisted(() => ({
  listeners: [] as { filter?: string; handler: (payload: unknown) => void }[],
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const builder = new Proxy(chain, {
    get: (_t, prop) =>
      prop === "then" ? (fn: (r: unknown) => unknown) => fn({ error: null }) : () => builder,
  });
  return {
    supabase: {
      channel: () => {
        const chan = {
          on: (_event: string, cfg: { filter?: string }, handler: (p: unknown) => void) => {
            hoisted.listeners.push({ filter: cfg.filter, handler });
            return chan;
          },
        };
        return chan;
      },
      from: () => builder,
      rpc: () => builder,
    },
  };
});
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: (factory: (name: string) => unknown) => {
    factory("test-channel");
    return { close: vi.fn() };
  },
}));

/* ChatView's data/scroll children are stubbed — this file is about WHEN the
   composer becomes a notice, not about what renders inside the timeline. The
   composer itself is captured rather than replaced, so the props ChatView
   actually hands it are the thing under test. */
const composerProps: { threadClosed?: boolean; draft?: string }[] = [];
/** The props ChatView handed the composer on its most recent render. */
const lastComposer = () => composerProps[composerProps.length - 1];
vi.mock("@/components/messages/chatView/ChatComposer", () => ({
  ChatComposer: (p: { threadClosed?: boolean; draft?: string; setDraft: (s: string) => void }) => {
    composerProps.push({ threadClosed: p.threadClosed, draft: p.draft });
    return (
      <div data-testid="composer-probe">
        <button type="button" onClick={() => p.setDraft("Hey, are we still on for Saturday?")}>
          type
        </button>
      </div>
    );
  },
}));
vi.mock("@/components/messages/chatView/ChatPaneShell", () => ({
  ChatPaneShell: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <div>{header}{children}</div>
  ),
}));
vi.mock("@/components/messages/chatView/ChatTimeline", () => ({ ChatTimeline: () => null }));
vi.mock("@/components/messages/chatView/JumpToBottomButton", () => ({ JumpToBottomButton: () => null }));
vi.mock("@/components/messages/MuteSheet", () => ({ MuteSheet: () => null }));
vi.mock("@/components/messages/MessageActionSheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/dashboard/PhotoLightbox", () => ({ PhotoLightbox: () => null }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({ BrandConfirmDialog: () => null }));
vi.mock("@/components/messages/useMessageReactions", () => ({
  useMessageReactions: () => ({ reactions: new Map(), react: vi.fn() }),
}));
vi.mock("@/components/messages/chatView/useTimestampReveal", () => ({
  useTimestampReveal: () => ({ reveal: 0, handlers: {} }),
}));
vi.mock("@/components/messages/chatView/useChatScroll", () => ({
  useChatScroll: () => ({
    scrollContainerRef: { current: null },
    initialFirstUnreadIdRef: { current: null },
    initialUnreadCountRef: { current: 0 },
    showJumpToBottom: false,
    firstUnreadOffscreen: false,
    setThreadRef: () => {},
    pullDistance: 0,
    refreshing: false,
    isPulling: false,
    canTrigger: false,
  }),
}));
vi.mock("@/lib/recipientGate", () => ({
  useRecipientRestricted: () => false,
  RECIPIENT_RESTRICTED_TOAST: "",
  RECIPIENT_RESTRICTED_NOTICE: "",
  fetchRecipientRestricted: vi.fn(async () => false),
}));

import {
  threadPatchFromSystemMessage,
  patchThreadForAnnouncement,
} from "@/components/messages/jobStatusAnnouncement";
import { isThreadClosed } from "@/lib/messagingLockout";
import { useMessagesRealtime } from "@/pages/messages/useMessagesRealtime";
import { ChatView } from "@/components/messages/ChatView";
import type { Conversation, Message } from "@/components/messages/types";

const ROOT = path.resolve(__dirname, "../..");

/* ── 1. DERIVATION, against the trigger's own CASE arms ────────────────────
   The inventory is the SQL, not a list in this file: every
   `WHEN '<status>' THEN '<content>'` the trigger can write must round-trip
   back to that same status. A transition added to the trigger that the client
   cannot read fails here. */
function triggerAnnouncements(): { status: string; content: string }[] {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260720130000_fix_job_status_trigger_null_sender.sql"),
    "utf8",
  );
  const body = sql.match(/v_content := CASE NEW\.status::text([\s\S]*?)END;/)?.[1] ?? "";
  return [...body.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([^']+)'/g)].map((m) => ({
    status: m[1],
    content: m[2],
  }));
}
const ANNOUNCED = triggerAnnouncements();

const AT = "2026-09-19T18:30:00.000Z";
const AT_MS = Date.parse(AT);

function convo(over: Partial<Conversation> = {}): Conversation {
  return {
    otherUserId: "u2",
    otherUserName: "Perry P.",
    jobTitle: "Fix a leaking kitchen faucet",
    jobId: "job-1",
    jobStatus: "in_progress",
    lastMessage: "on my way",
    lastAt: AT,
    unread: 0,
    ...over,
  } as Conversation;
}

function announcement(over: Partial<Message> = {}): Message {
  return {
    id: "sys-1",
    job_id: "job-1",
    sender_id: "poster",
    receiver_id: "me",
    content: "✕ Job cancelled",
    created_at: AT,
    is_system: true,
    ...over,
  } as Message;
}

afterEach(() => {
  cleanup();
  hoisted.listeners.length = 0;
  composerProps.length = 0;
});

describe("1. every announcement the trigger can write is readable as a status", () => {
  it("has a real inventory to check", () => {
    // Floor: the trigger writes five transitions. A regex that matched
    // nothing would make every assertion below vacuous.
    expect(ANNOUNCED.length).toBeGreaterThan(4);
    expect(ANNOUNCED.map((a) => a.status)).toContain("cancelled");
  });

  it("round-trips each one back to the status it announces", () => {
    const unreadable = ANNOUNCED.filter(
      (a) => threadPatchFromSystemMessage(a.content, AT)?.jobStatus !== a.status,
    );
    expect(
      unreadable.map((a) => `${a.content} → ${threadPatchFromSystemMessage(a.content, AT)?.jobStatus}`),
      "the client cannot read a transition the database can write",
    ).toEqual([]);
  });

  it("cancellation closes the thread AT the cancellation instant, not later", () => {
    const patch = threadPatchFromSystemMessage("✕ Job cancelled", AT)!;
    expect(patch.jobStatus).toBe("cancelled");
    expect(patch.messagingClosesAt).toBe(AT);
    // Closed the moment it is read, which mirrors job_messaging_closes_at's
    // cancelled arm ("already in the past by construction", 20260919220233).
    expect(isThreadClosed(patch.messagingClosesAt, AT_MS)).toBe(true);
  });

  it("completion does NOT close it on arrival — the 24h window is the point", () => {
    const patch = threadPatchFromSystemMessage("✓ Job completed", AT)!;
    expect(patch.jobStatus).toBe("completed");
    expect(isThreadClosed(patch.messagingClosesAt, AT_MS)).toBe(false);
    // Strictly later, not merely different — Math.abs would hide the sign.
    expect(Date.parse(patch.messagingClosesAt!) - AT_MS).toBeGreaterThan(0);
  });

  it("a transition that closes nothing leaves the existing deadline alone", () => {
    const completedAt = new Date(AT_MS + 60_000).toISOString();
    const held = convo({ messagingClosesAt: completedAt, jobStatus: "completed" });
    const after = patchThreadForAnnouncement(held, announcement({ content: "⚠ Dispute opened" }));
    expect(after.jobStatus).toBe("disputed");
    expect(after.messagingClosesAt).toBe(completedAt);
  });

  it("a thread on another job is untouched", () => {
    const other = convo({ jobId: "job-2" });
    expect(patchThreadForAnnouncement(other, announcement())).toBe(other);
  });

  it("a human message is not an announcement", () => {
    const open = convo();
    expect(
      patchThreadForAnnouncement(open, announcement({ is_system: false, content: "are we still on?" })),
    ).toBe(open);
    expect(patchThreadForAnnouncement(open, announcement({ content: "see you then" }))).toBe(open);
  });
});

describe("2. both realtime listeners deliver the announcement", () => {
  function mountRealtime() {
    const onJobStatusAnnouncement = vi.fn();
    renderHook(() =>
      useMessagesRealtime({
        userId: "me",
        activeConvoRef: { current: null },
        setMessages: vi.fn(),
        scrollToBottom: vi.fn(),
        patchConversationForMessage: vi.fn(),
        onJobStatusAnnouncement,
        onRecovered: vi.fn(),
      }),
    );
    return onJobStatusAnnouncement;
  }

  it("subscribes the two message-INSERT filters the trigger's row can match", () => {
    mountRealtime();
    // Floor: without listeners, "the handler called the callback" is vacuous.
    expect(hoisted.listeners.length).toBeGreaterThan(3);
    expect(hoisted.listeners.some((l) => l.filter === "receiver_id=eq.me")).toBe(true);
    expect(hoisted.listeners.some((l) => l.filter === "sender_id=eq.me")).toBe(true);
  });

  it.each([
    ["the helpr, who RECEIVES the announcement", "receiver_id=eq.me"],
    ["the poster, whose id the trigger stamps as its SENDER", "sender_id=eq.me"],
  ])("%s gets the thread closed for them", (_who, filter) => {
    const spy = mountRealtime();
    const listener = hoisted.listeners.find((l) => l.filter === filter)!;
    listener.handler({ eventType: "INSERT", new: announcement() });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as Message).content).toBe("✕ Job cancelled");
  });

  it("an ordinary message is not mistaken for one", () => {
    const spy = mountRealtime();
    for (const filter of ["receiver_id=eq.me", "sender_id=eq.me"]) {
      hoisted.listeners
        .find((l) => l.filter === filter)!
        .handler({ eventType: "INSERT", new: announcement({ is_system: false, content: "on my way" }) });
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("2b. inbound messages ride the shared user bus and split by event type (Q105)", () => {
  // The receiver binding is ONE `messages *` subscription shared with the nav
  // unread badge, so the page must tell an INSERT from an UPDATE itself: an
  // edit appended as a new bubble (or a new message silently dropped) is the
  // failure this pins.
  function mount(active: Conversation | null) {
    const setMessages = vi.fn();
    const patch = vi.fn();
    const onRecovered = vi.fn();
    const hook = renderHook(() =>
      useMessagesRealtime({
        userId: "me",
        activeConvoRef: { current: active },
        setMessages,
        scrollToBottom: vi.fn(),
        patchConversationForMessage: patch,
        onJobStatusAnnouncement: vi.fn(),
        onRecovered,
      }),
    );
    const inbound = hoisted.listeners.filter((l) => l.filter === "receiver_id=eq.me");
    return { setMessages, patch, onRecovered, inbound, hook };
  }
  const human = announcement({ is_system: false, content: "on my way", sender_id: "u2" });

  it("binds the receiver filter exactly once (the bus's `*`), not once per event", () => {
    const { inbound } = mount(null);
    expect(inbound.length).toBe(1);
  });

  it("an inbound INSERT appends to the open thread and patches the inbox row", () => {
    const { setMessages, patch, inbound } = mount(convo());
    inbound[0].handler({ eventType: "INSERT", new: human });
    expect(patch).toHaveBeenCalledTimes(1);
    const updater = setMessages.mock.calls[0][0] as (prev: Message[]) => Message[];
    expect(updater([]).map((m) => m.id)).toEqual(["sys-1"]);
  });

  it("an inbound UPDATE edits in place and never appends or patches the inbox", () => {
    const { setMessages, patch, inbound } = mount(convo());
    const edited = { ...human, content: "on my way (edited)" };
    inbound[0].handler({ eventType: "UPDATE", new: edited });
    expect(patch).not.toHaveBeenCalled();
    const updater = setMessages.mock.calls[0][0] as (prev: Message[]) => Message[];
    expect(updater([human]).map((m) => m.content)).toEqual(["on my way (edited)"]);
    expect(updater([]).length).toBe(0);
  });

  it("a DELETE on the shared binding does nothing here", () => {
    const { setMessages, patch, inbound } = mount(convo());
    inbound[0].handler({ eventType: "DELETE", new: {}, old: { id: "sys-1" } });
    expect(setMessages).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("3. the screen closes on the status alone, and keeps the draft", () => {
  const noop = () => {};

  function renderChat(activeConvo: Conversation) {
    return (
      <MemoryRouter>
        <ChatView
          embedded
          activeConvo={activeConvo}
          onCloseThread={noop}
          keyboardInset={0}
          isOtherOnline={false}
          isOtherTyping={false}
          broadcastTyping={noop}
          messages={[]}
          userId="me"
          chatLoadError={false}
          chatLoading={false}
          onRetryLoad={noop}
          hasMoreMessages={false}
          loadingMore={false}
          loadOlderMessages={noop}
          onRefreshThread={async () => {}}
          sendMessage={async () => true}
          retryMessage={noop}
          chatContainerRef={{ current: null }}
          bottomRef={{ current: null }}
          setReportTarget={noop}
          setBlockTarget={noop}
          setDeleteMessageConfirm={noop}
          onEditMessage={async () => {}}
          onToggleMute={noop}
          onSnoozeMute={noop}
          onUnmute={noop}
          jobSystemEvents={[]}
        />
      </MemoryRouter>
    );
  }

  it("goes from open composer to closed notice on the patched convo, with the text intact", () => {
    const open = convo();
    const { rerender } = render(renderChat(open));

    // Open: a composer, not a notice.
    expect(lastComposer().threadClosed).toBe(false);

    // The user types. Nothing is sent.
    act(() => {
      screen.getByText("type").click();
    });
    expect(lastComposer().draft).toBe("Hey, are we still on for Saturday?");
    expect(lastComposer().threadClosed).toBe(false);

    // The other party cancels. The ONLY thing that happens is the
    // announcement folding into the conversation — no send, no refetch.
    const closed = patchThreadForAnnouncement(open, announcement());
    expect(closed.jobStatus).toBe("cancelled");
    rerender(renderChat(closed));

    const after = lastComposer();
    expect(after.threadClosed, "the composer is still live after a cancellation").toBe(true);
    expect(
      after.draft,
      "the half-typed message must reach the 'Not sent' box, not a failed bubble",
    ).toBe("Hey, are we still on for Saturday?");
  });

  it("the same convo WITHOUT the announcement stays open — the close is caused, not constant", () => {
    const open = convo();
    const { rerender } = render(renderChat(open));
    rerender(renderChat({ ...open, lastMessage: "still talking" }));
    expect(lastComposer().threadClosed).toBe(false);
  });
});
