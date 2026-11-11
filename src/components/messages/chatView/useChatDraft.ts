/**
 * Audit 11-10 F472: a typed but unsent chat message was lost on a reload (the draft lived only in ChatView's
 * `useState`). Someone who loses signal and refreshes now finds what they wrote: the draft is kept per chat in
 * this browser (localStorage, keyed by member + job + other person) and restored when that chat opens again.
 * An empty draft removes its entry, so sending or clearing leaves nothing behind.
 */
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export const CHAT_DRAFT_KEY_PREFIX = "helpr.chatDraft";

export function chatDraftKey(userId: string | null, jobId: string, otherUserId: string | null): string {
  return `${CHAT_DRAFT_KEY_PREFIX}:${userId ?? "anon"}:${jobId}:${otherUserId ?? "team"}`;
}

export function readChatDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    // Private mode or blocked storage: no draft to restore, the composer starts empty as before.
    return "";
  }
}

export function writeChatDraft(key: string, draft: string): void {
  try {
    if (draft.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, draft);
  } catch {
    // Private mode or blocked storage: the draft still lives in state for this visit.
  }
}

/** `useState("")` for the composer, mirrored to this browser under `key`; a new key loads that chat's own draft. */
export function useChatDraft(key: string): [string, Dispatch<SetStateAction<string>>] {
  const [draft, setDraft] = useState(() => readChatDraft(key));
  const forKey = useRef(key);
  useEffect(() => {
    if (forKey.current !== key) {
      // Another chat opened in the same view: show its draft, never carry (or save) the old one under the new key.
      forKey.current = key;
      setDraft(readChatDraft(key));
      return;
    }
    writeChatDraft(key, draft);
  }, [key, draft]);
  return [draft, setDraft];
}
