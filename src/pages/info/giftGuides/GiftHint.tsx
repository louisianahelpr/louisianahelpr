import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { useSyncExternalStore, type ReactNode } from "react";

/**
 * How-to hints for the gift guides (owner 2026-11-20: "add hints or things so they know how to use everything"):
 * first-time, dismissible, inline (never an overlay, never blocking content). Each hint remembers its dismissal in
 * localStorage under "lh-gg-hint-<id>" (every read and write in try/catch: blocked storage means the hint can show
 * again next visit, nothing worse). Guard: src/test/giftWishList1120.test.tsx.
 */
const PREFIX = "lh-gg-hint-";
const listeners = new Set<() => void>();
/** Dismissed this visit even when storage refused the write. */
const dismissedNow = new Set<string>();

const seen = (id: string): boolean => {
  if (dismissedNow.has(id)) return true;
  try {
    return window.localStorage.getItem(PREFIX + id) === "1";
  } catch {
    // Storage blocked: the hint shows (it is small and dismissible).
    return false;
  }
};

/** Mark a hint done (dismissed, or its job done: the first heart was tapped). */
export function dismissHint(id: string) {
  dismissedNow.add(id);
  try {
    window.localStorage.setItem(PREFIX + id, "1");
  } catch {
    // Storage blocked: it stays dismissed for this visit (dismissedNow).
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** [showing, dismiss] for one hint id. */
export function useHint(id: string): [boolean, () => void] {
  const done = useSyncExternalStore(subscribe, () => seen(id), () => true);
  return [!done, () => dismissHint(id)];
}

/** For tests: forget this visit's dismissals. */
export const resetHintsForTests = () => dismissedNow.clear();

/**
 * One hint: a small note with a close button. `id` is its storage key; it renders nothing once dismissed. `show`
 * lets a caller hold it back until it applies (the first heart's "Saved" note shows only after a tap).
 */
export function Hint({ id, children, show = true, className = "" }: { id: string; children: ReactNode; show?: boolean; className?: string }) {
  const [showing, dismiss] = useHint(id);
  if (!showing || !show) return null;
  return (
    <p role="note" className={`gg-hint ${className}`} data-gift-hint={id}>
      <span className="gg-hint-text">{children}</span>
      <RoundIconButton size="sm" className="gg-hint-x" onClick={dismiss} aria-label="Got it, hide this tip" data-gift-hint-close={id}>
        <span aria-hidden="true">×</span>
      </RoundIconButton>
    </p>
  );
}
