import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/**
 * F425 (whole-app audit 2026-11-10): the composer's unsent draft, kept per member and per thread in browser storage
 * so a reload, a phone call or a crash does not throw away a long message. Emptying the box (sending clears it)
 * drops the saved copy. Storage can be missing or throw (private window): typing still works, it just is not kept.
 */
const readDraft = (key: string | null): string => {
  if (!key) return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    // Storage blocked: start empty, as before F425.
    return "";
  }
};

const writeDraft = (key: string | null, text: string) => {
  if (!key) return;
  try {
    if (!text) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, text);
  } catch {
    // Storage blocked or full: the draft stays in memory only.
  }
};

export function useChatDraft(userId: string | null, threadKey: string): [string, Dispatch<SetStateAction<string>>] {
  const storageKey = userId ? `helpr.chatDraft:${userId}:${threadKey}` : null;
  const [state, setState] = useState(() => ({ key: storageKey, text: readDraft(storageKey) }));
  // Another thread in the same view: load its own draft (render-time reset, React's derived-state pattern).
  if (state.key !== storageKey) setState({ key: storageKey, text: readDraft(storageKey) });
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setState((prev) => {
      const text = typeof value === "function" ? value(prev.text) : value;
      writeDraft(prev.key, text);
      return { key: prev.key, text };
    });
  }, []);
  return [state.key === storageKey ? state.text : readDraft(storageKey), setDraft];
}
