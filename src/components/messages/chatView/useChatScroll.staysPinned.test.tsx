/**
 * Audit 1122 #142 (measured on prod): a caught-up 131-message thread opened 214px short of the newest message, behind
 * "Jump to latest", at 375 and 1440. openConvo's double-rAF scrollToBottom() ran before the DealCard and the safety
 * banner above the thread had their height; the thread shrank afterwards and no scroll event fired.
 *
 * CLASS CHECK: while the reader is parked at the bottom, any size change of the thread (or of its content) re-pins it
 * to the newest message; a reader scrolled up in history, or a thread that opened on its first unread, is left alone.
 *
 * @mutate src/components/messages/chatView/useChatScroll.ts |       if (!landing() && !nearBottomRef.current) return; |       if (!landing()) return;
 * @mutate src/components/messages/chatView/useChatScroll.ts |     const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(pin); |     const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {});
 * @mutate src/components/messages/chatView/useChatScroll.ts |       landingUntilRef.current = initialFirstUnreadIdRef.current ? 0 : performance.now() + LANDING_MS; |       landingUntilRef.current = 0;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useChatScroll } from "./useChatScroll";
import type { Conversation, Message } from "../types";

const ME = "me";
const THEM = "them";
const msg = (id: string): Message =>
  ({ id, job_id: "j", sender_id: THEM, receiver_id: ME, content: id, created_at: "2026-11-22T10:00:00Z", read: true, is_system: false }) as unknown as Message;
const THREAD = Array.from({ length: 20 }, (_, i) => msg(`m${i}`));
const convo = (unread: number) => ({ jobId: "j", otherUserId: THEM, unread, lastAt: "2026-11-22T10:00:00Z" }) as unknown as Conversation;

let observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];
const RealRO = globalThis.ResizeObserver;
beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = class {
    private rec: { cb: ResizeObserverCallback; targets: Element[] };
    constructor(cb: ResizeObserverCallback) {
      this.rec = { cb, targets: [] };
      observers.push(this.rec);
    }
    observe(t: Element) { this.rec.targets.push(t); }
    unobserve() {}
    disconnect() { this.rec.targets = []; }
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = RealRO;
});

function Harness({ activeConvo, messages }: { activeConvo: Conversation; messages: Message[] }) {
  const { setThreadRef } = useChatScroll({ activeConvo, messages, userId: ME, keyboardInset: 0, onRefreshThread: async () => {}, chatContainerRef: { current: null } });
  return (
    <div ref={setThreadRef} data-testid="thread">
      <div>{messages.map((m) => <div key={m.id} data-msg-id={m.id}>{m.content}</div>)}</div>
    </div>
  );
}

/** The thread's box: scrollHeight 3817; clientHeight starts at 634 and the scroll sits at the bottom. */
function geometry(el: HTMLElement, box: { client: number; height: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => box.height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => box.client });
}

/** Fire every live observer that watches the thread or something inside it. */
function resize(thread: HTMLElement) {
  for (const o of observers) if (o.targets.some((t) => t === thread || thread.contains(t))) o.cb([], {} as ResizeObserver);
}

describe("a chat stays on the newest message while it lays out (#142)", () => {
  it("the thread shrinks after the bottom landing (DealCard + banner mount): it re-pins to the bottom", () => {
    const { rerender, getByTestId } = render(<Harness activeConvo={convo(0)} messages={[]} />);
    const thread = getByTestId("thread");
    const box = { client: 634, height: 3817 };
    geometry(thread, box);
    rerender(<Harness activeConvo={convo(0)} messages={THREAD} />);
    thread.scrollTop = 3817 - 634; // openConvo's scrollToBottom
    act(() => { thread.dispatchEvent(new Event("scroll")); });
    // DealCard and the banner take 214px: no scroll event, the bottom slides out of view.
    box.client = 420;
    act(() => resize(thread));
    expect(observers.some((o) => o.targets.includes(thread))).toBe(true);
    expect(thread.scrollTop).toBe(3817);
  });

  it("content grows inside the thread (an image loads): it re-pins", () => {
    const { rerender, getByTestId } = render(<Harness activeConvo={convo(0)} messages={[]} />);
    const thread = getByTestId("thread");
    const box = { client: 420, height: 3000 };
    geometry(thread, box);
    rerender(<Harness activeConvo={convo(0)} messages={THREAD} />);
    thread.scrollTop = 3000 - 420;
    act(() => { thread.dispatchEvent(new Event("scroll")); });
    box.height = 3300;
    act(() => resize(thread));
    expect(observers.some((o) => o.targets.includes(thread.firstElementChild as Element))).toBe(true);
    expect(thread.scrollTop).toBe(3300);
  });

  it("while it lands (the smooth scroll still under way, far from the bottom), a resize pins it to the bottom", () => {
    const { rerender, getByTestId } = render(<Harness activeConvo={convo(0)} messages={[]} />);
    const thread = getByTestId("thread");
    const box = { client: 634, height: 3817 };
    geometry(thread, box);
    rerender(<Harness activeConvo={convo(0)} messages={THREAD} />);
    thread.scrollTop = 900; // openConvo's smooth scroll, part-way down
    act(() => { thread.dispatchEvent(new Event("scroll")); });
    box.client = 420; // the DealCard and banner mount
    act(() => resize(thread));
    expect(thread.scrollTop).toBe(3817);
  });

  it("after the landing hold, a reader parked at the bottom is re-pinned when content grows", () => {
    const { rerender, getByTestId } = render(<Harness activeConvo={convo(0)} messages={[]} />);
    const thread = getByTestId("thread");
    const box = { client: 420, height: 3000 };
    geometry(thread, box);
    rerender(<Harness activeConvo={convo(0)} messages={THREAD} />);
    const later = performance.now() + 60_000;
    const now = vi.spyOn(performance, "now").mockReturnValue(later);
    thread.scrollTop = 3000 - 420 - 40; // parked near the bottom
    act(() => { thread.dispatchEvent(new Event("scroll")); });
    box.height = 3200;
    act(() => resize(thread));
    expect(thread.scrollTop).toBe(3200);
    // …and a reader 600px up is left alone.
    thread.scrollTop = 1000;
    act(() => { thread.dispatchEvent(new Event("scroll")); });
    box.height = 3400;
    act(() => resize(thread));
    expect(thread.scrollTop).toBe(1000);
    now.mockRestore();
  });

  it("a reader scrolled up in history is never pulled down", () => {
    const { rerender, getByTestId } = render(<Harness activeConvo={convo(0)} messages={[]} />);
    const thread = getByTestId("thread");
    const box = { client: 420, height: 3817 };
    geometry(thread, box);
    rerender(<Harness activeConvo={convo(0)} messages={THREAD} />);
    thread.dispatchEvent(new Event("wheel")); // the reader's own wheel ends the landing hold
    thread.scrollTop = 1000;
    act(() => { thread.dispatchEvent(new Event("scroll")); });
    box.height = 3900;
    act(() => resize(thread));
    expect(thread.scrollTop).toBe(1000);
  });

  it("a thread that opened on its first unread keeps that landing", () => {
    const { rerender, getByTestId } = render(<Harness activeConvo={convo(3)} messages={[]} />);
    const thread = getByTestId("thread");
    const box = { client: 420, height: 3817 };
    geometry(thread, box);
    const realIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    rerender(<Harness activeConvo={convo(3)} messages={THREAD} />);
    thread.scrollTop = 3817 - 420 - 50;
    act(() => { thread.dispatchEvent(new Event("scroll")); });
    box.client = 380;
    act(() => resize(thread));
    Element.prototype.scrollIntoView = realIntoView;
    expect(thread.scrollTop).toBe(3817 - 420 - 50);
  });
});
