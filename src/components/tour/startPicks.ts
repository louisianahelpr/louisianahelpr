import { useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/safeStorage";

/**
 * WHAT A MEMBER PICKED ON THE OLD FIRST-RUN PICKER, read back for Home's Get started guide and the
 * Help tour's wording (owner 11-14). The screen itself is gone (owner 2026-11-24, "Remove what brings you here
 * entirely": it stacked on the Terms re-agree dialog and froze Home, C11), so nothing writes these any more; members
 * who picked before keep their wording. Never picked: an empty list, and the guide offers every starting step.
 * Guard: src/test/newMemberHome1114.test.tsx.
 */
export type StartPick = "hire" | "earn" | "sell" | "deal";
const ALL: readonly StartPick[] = ["hire", "earn", "sell", "deal"];
const startPicksKey = (userId: string) => `helpr_first_run_picks_${userId}`;
const EMPTY: StartPick[] = [];

const cache = new Map<string, { raw: string | null; picks: StartPick[] }>();

export function readStartPicks(userId: string | undefined): StartPick[] {
  if (!userId) return EMPTY;
  let raw: string | null;
  try {
    raw = safeStorage.getItem(startPicksKey(userId));
  } catch {
    raw = null; // blocked storage reads as "no picks": the guide offers every step
  }
  const hit = cache.get(userId);
  if (hit && hit.raw === raw) return hit.picks;
  let picks: StartPick[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) picks = ALL.filter((p) => parsed.includes(p));
  } catch {
    picks = EMPTY; // a malformed value reads as "no picks"
  }
  cache.set(userId, { raw, picks });
  return picks;
}

const noSubscription = () => () => {};

/** Nothing writes the picks now, so there is nothing to subscribe to: read once per render. */
export function useStartPicks(userId: string | undefined): StartPick[] {
  return useSyncExternalStore(noSubscription, () => readStartPicks(userId), () => EMPTY);
}
