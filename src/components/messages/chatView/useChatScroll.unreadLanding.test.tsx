/**
 * OWNER REPORT (2026-09-16): "messages should open to the unread messages."
 *
 * Opening a thread always landed on the NEWEST message — `openConvo`
 * (useMessagesData.ts) ends in a double-rAF `scrollToBottom()`. With unread
 * messages that drops you at the end of what you have not read and asks you to
 * scroll UP to find where you left off.
 *
 * CLASS CHECK: a thread opened WITH unread messages lands on the first unread
 * `[data-msg-id]`, and a thread opened with NONE is left alone so the existing
 * bottom landing still stands. Both halves matter — a landing fix that also
 * fired on a caught-up thread would park every conversation at the top.
 *
 * The render sequence here is production's, not a convenience: `openConvo`
 * batches `setActiveConvo(convo)` with `setMessages([])`, so ChatView always
 * mounts with an EMPTY thread and the messages arrive a render later. That is
 * what gives the unread snapshot effect its chance to run before the landing
 * effect has anything to anchor to.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useChatScroll } from "./useChatScroll";
import type { Conversation, Message } from "../types";

const ME = "me-user";
const THEM = "them-user";

const msg = (id: string, from: string, to: string): Message =>
  ({
    id,
    job_id: "job-1",
    sender_id: from,
    receiver_id: to,
    content: id,
    created_at: `2026-09-16T10:0${id.slice(-1)}:00Z`,
    read: false,
    is_system: false,
  }) as unknown as Message;

// m1 outbound, then three inbound. With unread = 2 the first unread is m3.
const THREAD: Message[] = [
  msg("m1", ME, THEM),
  msg("m2", THEM, ME),
  msg("m3", THEM, ME),
  msg("m4", THEM, ME),
];

const convo = (unread: number): Conversation =>
  ({
    jobId: "job-1",
    otherUserId: THEM,
    unread,
    lastAt: "2026-09-16T10:04:00Z",
  }) as unknown as Conversation;

function Harness({
  activeConvo,
  messages,
}: {
  activeConvo: Conversation;
  messages: Message[];
}) {
  const { setThreadRef } = useChatScroll({
    activeConvo,
    messages,
    userId: ME,
    keyboardInset: 0,
    onRefreshThread: async () => {},
    chatContainerRef: { current: null },
  });
  return (
    <div ref={setThreadRef} data-testid="thread">
      {messages.map((m) => (
        <div key={m.id} data-msg-id={m.id}>
          {m.content}
        </div>
      ))}
    </div>
  );
}

let scrolled: { id: string | null; arg: unknown }[] = [];

beforeEach(() => {
  scrolled = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
    arg?: unknown,
  ) {
    scrolled.push({ id: this.getAttribute("data-msg-id"), arg });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("opening a thread lands on the first unread message", () => {
  it("with unread messages, it scrolls to the first unread anchor — not the bottom", () => {
    // Mount empty, exactly as openConvo leaves it…
    const { rerender } = render(
      <Harness activeConvo={convo(2)} messages={[]} />,
    );
    expect(scrolled).toEqual([]);

    // …then the first page of messages arrives.
    rerender(<Harness activeConvo={convo(2)} messages={THREAD} />);

    expect(scrolled.length).toBeGreaterThan(0);
    expect(scrolled[0].id).toBe("m3");
    expect(scrolled[0].arg).toEqual({ behavior: "auto", block: "start" });
    // Never the newest message — that is the landing this replaces.
    expect(scrolled.some((s) => s.id === "m4")).toBe(false);
  });

  it("a caught-up thread is left alone, so the existing bottom landing stands", () => {
    const { rerender } = render(
      <Harness activeConvo={convo(0)} messages={[]} />,
    );
    rerender(<Harness activeConvo={convo(0)} messages={THREAD} />);

    expect(scrolled).toEqual([]);
  });

  it("a realtime inbound message does not yank the reader back to the anchor", () => {
    const { rerender } = render(
      <Harness activeConvo={convo(2)} messages={[]} />,
    );
    rerender(<Harness activeConvo={convo(2)} messages={THREAD} />);
    const afterLanding = scrolled.length;

    // A new message arrives while the reader is part-way through.
    rerender(
      <Harness
        activeConvo={convo(2)}
        messages={[...THREAD, msg("m5", THEM, ME)]}
      />,
    );
    expect(scrolled.length).toBe(afterLanding);
  });
});
