/**
 * F425 (whole-app audit 2026-11-10, Medium): a job chat's typed text was lost on refresh ("TEST - please ignore",
 * reload, empty box): the draft was plain component state. Now useChatDraft keeps the unsent draft per member and
 * per thread in browser storage, puts it back when that chat opens, and drops it once the box is emptied (send
 * clears the box). Storage failing (private window) never breaks typing.
 * @mutate src/components/messages/chatView/useChatDraft.ts |     else window.localStorage.setItem(key, text); |     else void text;
 * @mutate src/components/messages/chatView/useChatDraft.ts |     if (!text) window.localStorage.removeItem(key); |     if (!text) return;
 * @mutate src/components/messages/chatView/useChatDraft.ts |   if (state.key !== storageKey) setState({ key: storageKey, text: readDraft(storageKey) }); |   void state;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useChatDraft } from "@/components/messages/chatView/useChatDraft";

beforeEach(() => window.localStorage.clear());

describe("F425: the unsent chat draft survives a reload", () => {
  it("typed text is put back on the next mount of the same thread, and is per member and per thread", () => {
    const first = renderHook(() => useChatDraft("u1", "job-1:u2"));
    act(() => first.result.current[1]("TEST - please ignore"));
    first.unmount();
    expect(renderHook(() => useChatDraft("u1", "job-1:u2")).result.current[0]).toBe("TEST - please ignore");
    expect(renderHook(() => useChatDraft("u1", "job-2:u2")).result.current[0]).toBe("");
    expect(renderHook(() => useChatDraft("u9", "job-1:u2")).result.current[0]).toBe("");
  });

  it("emptying the box (send clears it) drops the saved draft", () => {
    const { result, unmount } = renderHook(() => useChatDraft("u1", "job-1:u2"));
    act(() => result.current[1]("hello"));
    act(() => result.current[1](""));
    unmount();
    expect(renderHook(() => useChatDraft("u1", "job-1:u2")).result.current[0]).toBe("");
    expect(window.localStorage.length).toBe(0);
  });

  it("switching threads in the same view loads that thread's own draft", () => {
    window.localStorage.setItem("helpr.chatDraft:u1:job-2:u3", "for the other thread");
    const { result, rerender } = renderHook(({ k }) => useChatDraft("u1", k), { initialProps: { k: "job-1:u2" } });
    act(() => result.current[1]("first thread"));
    rerender({ k: "job-2:u3" });
    expect(result.current[0]).toBe("for the other thread");
    // Typing now lands on the thread on screen, never the one before it.
    act(() => result.current[1]("edited"));
    expect(window.localStorage.getItem("helpr.chatDraft:u1:job-2:u3")).toBe("edited");
    expect(window.localStorage.getItem("helpr.chatDraft:u1:job-1:u2")).toBe("first thread");
  });

  it("ChatView's composer draft comes from the hook", () => {
    const src = readFileSync("src/components/messages/ChatView.tsx", "utf8");
    expect(src).toMatch(/const \[draft, setDraft\] = useChatDraft\(userId, /);
  });
});
