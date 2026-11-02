import { useSyncExternalStore } from "react";

/**
 * BADGE = TO-DO (owner, 2026-10-20). The Explore badge, the desktop sidebar's
 * Explore / Jobs / Shops counts and Home's Next up / To do count ONE thing:
 * the jobs and items that need you, one per job (never unseen applicants).
 *
 * Home's list is the source (useNeedsYouTodos). NeedsYouBridge, mounted
 * lazily by App.tsx only while signed in, runs that same hook and publishes
 * its counts here; the navs read them. The navs never import the activity
 * reads themselves: MobileNav is a first-screen root (src/test/bootReach.test.ts)
 * and every nav read is paid on every page (Q53, src/test/hotQueryLoad.test.ts).
 *
 * Per account: the counts carry the id they were computed for, and a reader
 * asking for another id (or none) gets zero, so one account's count can never
 * paint on the next account to sign in. Guard: src/test/badgeIsTodo.test.tsx.
 */
export interface NeedsYouCounts {
  /** Every to-do across the sections (the Explore badge). */
  readonly total: number;
  /** Jobs to-dos (both sides: jobs I posted and jobs I'm working). */
  readonly jobs: number;
  /** Shops to-dos (orders waiting for my shop's answer). */
  readonly shops: number;
  /** A3-81: Declutter to-dos (offers to answer, checkouts due, handovers), both sides. */
  readonly declutter: number;
}

export const NO_TODOS: NeedsYouCounts = Object.freeze({ total: 0, jobs: 0, shops: 0, declutter: 0 });

let owner: string | null = null;
let counts: NeedsYouCounts = NO_TODOS;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function publishNeedsYou(userId: string, next: NeedsYouCounts): void {
  if (owner === userId && counts.total === next.total && counts.jobs === next.jobs && counts.shops === next.shops && counts.declutter === next.declutter) return;
  owner = userId;
  counts = { total: next.total, jobs: next.jobs, shops: next.shops, declutter: next.declutter };
  emit();
}

/** Signed out (the bridge unmounts): nothing is counted for anyone. */
export function clearNeedsYou(): void {
  if (owner === null && counts === NO_TODOS) return;
  owner = null;
  counts = NO_TODOS;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useNeedsYouCounts(userId: string | null | undefined): NeedsYouCounts {
  const snap = useSyncExternalStore(subscribe, () => counts, () => counts);
  return userId && owner === userId ? snap : NO_TODOS;
}
