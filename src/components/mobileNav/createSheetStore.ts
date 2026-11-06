import { useSyncExternalStore } from "react";

/**
 * Whether the phone's Create sheet ("What are we doing?") is open. The sheet still mounts in MobileNav (its lazy
 * chunk and the dock's lifetime), but since the nav redesign (owner 2026-11-06) the button that opens it is the
 * Dashboard top bar's "+", which lives in AppTopBar. One tiny store joins the two without a context provider over
 * the whole app. Guard: src/test/centerCreateNav.test.tsx.
 */
let open = false;
const listeners = new Set<() => void>();

export function setCreateSheetOpen(next: boolean | ((was: boolean) => boolean)) {
  const value = typeof next === "function" ? next(open) : next;
  if (value === open) return;
  open = value;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCreateSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
