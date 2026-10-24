/**
 * Is the PayPal path (switch `paypal_payments`) on for this viewer? A store, like
 * identityCheckSwitch.ts, so copy that quotes the jobs fee (Terms, Help Center, first-job Home,
 * Money) can ask without a React Query provider of its own: the Terms render inside the public
 * legal pages and the full-text page, which have none in tests.
 *
 * Published by PayPalSwitchHost (mounted once in App) from useFeatureStatus("paypal_payments").
 * Until it publishes it reads OFF and unsettled: today's copy (5% + $0.70), and a screen that quotes
 * a figure for a PayPal tester waits for `settled`.
 */
import { useSyncExternalStore } from "react";

let state: { on: boolean; settled: boolean } = { on: false, settled: false };
const listeners = new Set<() => void>();

export function setPayPalPaymentsSwitch(next: { on: boolean; settled: boolean }): void {
  if (next.on === state.on && next.settled === state.settled) return;
  state = { on: next.on, settled: next.settled };
  listeners.forEach((l) => l());
}

/** The current answer for a component that renders from it. */
export function usePayPalPaymentsSwitch(): { on: boolean; settled: boolean } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
