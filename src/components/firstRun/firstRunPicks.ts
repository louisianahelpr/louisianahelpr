import { useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/safeStorage";

/**
 * WHAT A NEW MEMBER PICKED ON "What brings you to Helpr?" (owner 11-14: new members saw Home once and left; the
 * Get started guide on Home is worded from these picks). Kept on this device next to the first run's own seen-state
 * (firstRunGate's `helpr_onboarding_<userId>`); the picks also still reorder Home (useSectionPrefs.putFirst).
 * Skipped or never seen: an empty list, and the guide offers every starting step.
 * Guard: src/test/newMemberHome1114.test.tsx.
 */
export type FirstRunPick = "hire" | "earn" | "sell" | "deal";
const ALL: readonly FirstRunPick[] = ["hire", "earn", "sell", "deal"];
const firstRunPicksKey = (userId: string) => `helpr_first_run_picks_${userId}`;

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; picks: FirstRunPick[] }>();

export function readFirstRunPicks(userId: string | undefined): FirstRunPick[] {
  if (!userId) return EMPTY;
  let raw: string | null;
  try {
    raw = safeStorage.getItem(firstRunPicksKey(userId));
  } catch {
    raw = null; // blocked storage reads as "no picks": the guide offers every step
  }
  const hit = cache.get(userId);
  if (hit && hit.raw === raw) return hit.picks;
  let picks: FirstRunPick[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) picks = ALL.filter((p) => parsed.includes(p));
  } catch {
    picks = EMPTY; // a malformed value reads as "no picks"
  }
  cache.set(userId, { raw, picks });
  return picks;
}
const EMPTY: FirstRunPick[] = [];

export function saveFirstRunPicks(userId: string, picks: FirstRunPick[]) {
  try {
    safeStorage.setItem(firstRunPicksKey(userId), JSON.stringify(ALL.filter((p) => picks.includes(p))));
  } catch {
    /* best-effort: without them the guide offers every starting step */
  }
  listeners.forEach((l) => l());
}

export function useFirstRunPicks(userId: string | undefined): FirstRunPick[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => readFirstRunPicks(userId),
    () => EMPTY,
  );
}
