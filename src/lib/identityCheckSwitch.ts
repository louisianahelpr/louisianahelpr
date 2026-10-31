/**
 * Is the ID check (Stripe Identity) offered right now?
 *
 * The owner's rule of 2026-10-30 replaces the removal of 2026-10-23: the ID check
 * stays, asked once, when hired or at the first payout, and payouts stay on Stripe.
 * The answer is the hidden feature switch `identity_check` (migration
 * 20261023213857), which an admin turns on; it reads off until then. The SERVER
 * decides; this module only lets plain functions that cannot call a hook
 * (openIdentityCheck, needsIdentityCheck...) ask the same question.
 *
 * The value is published by IdentityCheckHost (mounted once in App) from
 * useFeatureStatus("identity_check") via useIdentityCheckStatus(). Until it
 * publishes it reads FALSE; an entry link (?verify_id=1) waits for the answer
 * instead of being spent. Components subscribe with useIdentityCheckOnStore().
 *
 * Guard: src/test/identityCheckOffEntryPoints.test.ts.
 */
import { useSyncExternalStore } from "react";

let on = false;
const listeners = new Set<() => void>();

/** The current answer (false until IdentityCheckHost publishes one). */
export function identityCheckOn(): boolean {
  return on;
}

/** IdentityCheckHost publishes useFeature("identity_check") here. */
export function setIdentityCheckOn(next: boolean): void {
  if (next === on) return;
  on = next;
  listeners.forEach((l) => l());
}

/** The same answer for a component that renders from it. */
export function useIdentityCheckOnStore(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => on,
  );
}
