/**
 * Is "payout setup after the hire" on for this member? (owner decision
 * 2026-10-25; hidden switch `payout_after_hire`, migration 20261025162003,
 * created testers.) The SERVER decides (helper_accept_missing,
 * claim_payout_setup_reminders and payout_waits_on_identity read the same
 * switch); this module lets the app's plain readers and small components ask
 * without each opening its own switch query.
 *
 * Published by IdentityCheckMount (mounted once in App, the mount that publishes
 * switches for plain functions) from useFeature("payout_after_hire"). Until it
 * publishes it reads FALSE: today's behaviour (the accept waits on setup, no
 * prompt, no job line). Components subscribe with usePayoutAfterHireOn().
 */
import { useSyncExternalStore } from "react";

let on = false;
const listeners = new Set<() => void>();

/** The current answer, for a plain call (false until IdentityCheckMount publishes one). */
export function payoutAfterHireOn(): boolean {
  return on;
}

/** IdentityCheckMount publishes useFeature("payout_after_hire") here. */
export function setPayoutAfterHireOn(next: boolean): void {
  if (next === on) return;
  on = next;
  listeners.forEach((l) => l());
}

/** The answer for a component that renders from it (false until published). */
export function usePayoutAfterHireOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => on,
  );
}
