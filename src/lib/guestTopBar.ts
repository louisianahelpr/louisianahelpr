import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * F047 (owner UI audit 11-09, High): a guest on Declutter at desktop width had the page's own header ("Declutter",
 * the item's Go back) drawn UNDER the fixed guest top bar (DeclutterGuestTopBar), so Go back hid behind the logo and a
 * click there opened Home. AppShell keeps the bar's room only while a bar is on screen (owner 11-05, /u/), and it only
 * knew the member's bar. The guest bar now says it is on screen here, and AppShell keeps the same room for it.
 * Guard: src/test/appShellBarRoomOnlyWithTheBar.test.tsx.
 */
let mounted = 0;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  for (const fn of listeners) fn();
}

/** True while a guest top bar is drawn. */
export function useGuestTopBarOn(): boolean {
  return useSyncExternalStore(subscribe, () => mounted > 0, () => false);
}

/** Called by the guest top bar while it is drawn (before paint, so the page never shows under it). */
export function useMarkGuestTopBarOn(on: boolean): void {
  useLayoutEffect(() => {
    if (!on) return;
    mounted += 1;
    emit();
    return () => {
      mounted -= 1;
      emit();
    };
  }, [on]);
}
