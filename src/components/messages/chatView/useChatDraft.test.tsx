/**
 * Audit 11-10 F472: a typed but unsent chat message was lost on reload. The composer's draft is now kept per chat
 * in this browser (useChatDraft) and restored when that chat opens again; sending or clearing removes it; another
 * chat in the same view shows its own draft, never the previous one.
 *
 * @mutate src/components/messages/chatView/useChatDraft.ts |     else window.localStorage.setItem(key, draft); |     else window.localStorage.removeItem(key);
 * @mutate src/components/messages/chatView/useChatDraft.ts |     if (draft.length === 0) window.localStorage.removeItem(key); |     if (false) window.localStorage.removeItem(key);
 * @mutate src/components/messages/chatView/useChatDraft.ts |   const [draft, setDraft] = useState(() => readChatDraft(key)); |   const [draft, setDraft] = useState("");
 * @mutate src/components/messages/chatView/useChatDraft.ts |       setDraft(readChatDraft(key)); |       setDraft(draft);
 * @mutate src/components/messages/ChatView.tsx |   const [draft, setDraft] = useChatDraft(chatDraftKey(userId, activeConvo.jobId, activeConvo.otherUserId)); |   const [draft, setDraft] = useState("");
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDraftKey, useChatDraft } from "./useChatDraft";

const key = chatDraftKey("me", "job-1", "them");

describe("the chat draft survives a reload (F472)", () => {
  beforeEach(() => window.localStorage.clear());

  it("is keyed per member, job and other person", () => {
    expect(key).toBe("helpr.chatDraft:me:job-1:them");
    expect(chatDraftKey(null, "job-1", null)).toBe("helpr.chatDraft:anon:job-1:team");
  });

  it("typing saves to the browser, a fresh mount (a reload) restores it, clearing removes it", () => {
    const first = renderHook(() => useChatDraft(key));
    expect(first.result.current[0]).toBe("");
    act(() => first.result.current[1]("Running 10 min late"));
    expect(window.localStorage.getItem(key)).toBe("Running 10 min late");
    first.unmount();

    const reloaded = renderHook(() => useChatDraft(key));
    expect(reloaded.result.current[0]).toBe("Running 10 min late");
    act(() => reloaded.result.current[1](""));
    expect(reloaded.result.current[0]).toBe("");
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("another chat in the same view shows its own draft and never inherits the old one", () => {
    const other = chatDraftKey("me", "job-2", "them");
    window.localStorage.setItem(other, "Is it still available?");
    const hook = renderHook(({ k }: { k: string }) => useChatDraft(k), { initialProps: { k: key } });
    act(() => hook.result.current[1]("Draft for job 1"));
    hook.rerender({ k: other });
    expect(hook.result.current[0]).toBe("Is it still available?");
    expect(window.localStorage.getItem(other)).toBe("Is it still available?");
    expect(window.localStorage.getItem(key)).toBe("Draft for job 1");
  });

  it("ChatView's composer draft is the stored one, keyed by the open chat", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/messages/ChatView.tsx"), "utf8");
    expect(src).toContain("useChatDraft(chatDraftKey(userId, activeConvo.jobId, activeConvo.otherUserId))");
    expect(src).not.toContain('const [draft, setDraft] = useState("")');
  });
});
