/**
 * Q2044 (iMessage-style messages), measured on prod 2026-11-04 by Builder 90: with the helper typing in an open
 * thread, the poster's "typing…" row rendered just BELOW the fold, because it is appended under the newest message
 * and nothing scrolled. CLASS CHECK: when the other person starts typing and the reader is parked near the bottom,
 * the thread scrolls to the bottom; a reader scrolled up in history is never pulled down.
 */
// @mutate src/components/messages/chatView/useChatScroll.ts | if (!isOtherTyping \|\| !nearBottomRef.current) return; | if (!isOtherTyping) return;
// @mutate src/components/messages/chatView/useChatScroll.ts | if (el) el.scrollTop = el.scrollHeight;\n    });\n    return () => cancelAnimationFrame(raf);\n  }, [isOtherTyping]); | });\n    return () => cancelAnimationFrame(raf);\n  }, [isOtherTyping]);
// @mutate src/components/messages/ChatView.tsx |     chatContainerRef,\n    isOtherTyping,\n  }); |     chatContainerRef,\n  });
import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanup, act } from "@testing-library/react";
import { useChatScroll } from "./useChatScroll";
import type { Conversation, Message } from "../types";

const convo = { jobId: "job-1", otherUserId: "them", unread: 0, lastAt: "2026-11-04T05:00:00Z" } as unknown as Conversation;
const messages = [{ id: "m1", job_id: "job-1", sender_id: "them", receiver_id: "me", content: "hi", created_at: "2026-11-04T05:00:00Z", read: true, is_system: false }] as unknown as Message[];

function Harness({ typing }: { typing: boolean }) {
  const { setThreadRef } = useChatScroll({
    activeConvo: convo, messages, userId: "me", keyboardInset: 0, onRefreshThread: async () => {},
    chatContainerRef: { current: null }, isOtherTyping: typing,
  });
  return <div ref={setThreadRef} data-testid="thread"><div data-msg-id="m1">hi</div></div>;
}

/** jsdom has no layout: give the scroller a fixed geometry and a writable scrollTop. */
function geometry(el: HTMLElement, start: number) {
  let top = start;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = Math.min(v, 700); } });
  el.dispatchEvent(new Event("scroll"));
}
const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

afterEach(cleanup);

describe("the typing row stays in view (Q2044)", () => {
  it("scrolls a reader parked at the bottom down to the new typing row", async () => {
    const { getByTestId, rerender } = render(<Harness typing={false} />);
    const el = getByTestId("thread");
    geometry(el, 650); // 50px from the bottom: parked
    rerender(<Harness typing />);
    await frame();
    expect(el.scrollTop).toBe(700);
  });

  it("never pulls down a reader scrolled up in history", async () => {
    const { getByTestId, rerender } = render(<Harness typing={false} />);
    const el = getByTestId("thread");
    geometry(el, 100); // 600px up
    rerender(<Harness typing />);
    await frame();
    expect(el.scrollTop).toBe(100);
  });

  it("ChatView hands the presence flag to the scroll hook", () => {
    const src = readFileSync("src/components/messages/ChatView.tsx", "utf8");
    const call = src.slice(src.indexOf("useChatScroll({"), src.indexOf("});", src.indexOf("useChatScroll({")));
    expect(call).toMatch(/\bisOtherTyping\b/);
    expect(call.length).toBeGreaterThan(40);
  });
});
