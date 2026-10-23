/**
 * Is the ID check (Stripe Identity today) required and offered right now?
 *
 * Owner ruling by pop-up, 2026-10-23: "just remove the verify id entirely, we
 * will move to paypal". The answer is the hidden feature switch
 * `identity_check` (migration 20261023213857), created OFF = no ID check
 * anywhere. The SERVER decides (identity_check_exempt and helper_accept_missing
 * read the same switch); this module only lets plain functions that cannot call
 * a hook (openIdentityCheck, acceptMissingFromProfile, claimSetupStep...) ask
 * the same question.
 *
 * The value is published by IdentityCheckHost (mounted once in App) from
 * useFeatureStatus("identity_check") via useIdentityCheckStatus(). Until it
 * publishes it reads FALSE: the owner's default, and the server refuses nothing
 * for a missing ID while the switch is off. If the switch is turned back on and
 * a member meets a server refusal before the answer arrives, openIdentityCheck()
 * returns false and the caller shows its own error message (it never stops in
 * silence); an entry link (?verify_id=1) waits for the answer instead of being
 * spent. Components subscribe with useIdentityCheckOnStore().
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
