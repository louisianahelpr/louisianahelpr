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
 * The value is published by IdentityCheckMount (mounted once in App) from
 * useFeatureStatus("identity_check") via useIdentityCheckStatus(). Until it
 * publishes it reads FALSE; an entry link (?verify_id=1) waits for the answer
 * instead of being spent. Components subscribe with useIdentityCheckOnStore().
 *
 * Guard: src/test/identityCheckOffEntryPoints.test.ts.
 */
import { useSyncExternalStore } from "react";

let on = false;
const listeners = new Set<() => void>();

/** The current answer (false until IdentityCheckMount publishes one). */
export function identityCheckOn(): boolean {
  return on;
}

/** IdentityCheckMount publishes useFeature("identity_check") here. */
export function setIdentityCheckOn(next: boolean): void {
  if (next === on) return;
  on = next;
  listeners.forEach((l) => l());
}

let lastAnswer: boolean | null = null;
const answerListeners = new Set<() => void>();

/**
 * IdentityCheckMount publishes the switch's last REAL answer: null until one arrives, and kept through a failed
 * refetch (useFeatureStatus.lastAnswer). Not `on`, which reads a failed read as off.
 */
export function setIdentityCheckLastAnswer(next: boolean | null): void {
  if (next === lastAnswer) return;
  lastAnswer = next;
  answerListeners.forEach((l) => l());
}

/**
 * F360b (lh-money-escrow reviews 11-11): a money figure that depends on the switch (the setup fee from a first payout)
 * must tell "off" from "not known": null is not known, and a failed read is never taken for off.
 */
export function useIdentityCheckLastAnswerStore(): boolean | null {
  return useSyncExternalStore(subscribeIdentityCheckLastAnswer, identityCheckLastAnswer, identityCheckLastAnswer);
}

/** The last real answer now (null: not known), for a caller that loads this module lazily (useSellerSetupFee). */
export function identityCheckLastAnswer(): boolean | null {
  return lastAnswer;
}

/** Listen for a new last answer; returns the unsubscribe. */
export function subscribeIdentityCheckLastAnswer(l: () => void): () => void {
  answerListeners.add(l);
  return () => {
    answerListeners.delete(l);
  };
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
