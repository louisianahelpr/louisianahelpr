/**
 * THE ONLINE PILL TAKES ITS ROW FROM THE BADGE READ (Builder 2, 2026-11-06; lead plan 11-05, "Nothing slow for users").
 *
 * DeliveryOnlinePill (beside every signed-in page) read helpr_delivery_online on every page load. The nav badge's one
 * read, my_badge_reads (migration 20261106053703), now carries that row as its 'delivery_online' key, so a page load
 * makes one request for both. The two live in separate lazy chunks (NeedsYouBridge, the pill), so they meet here:
 *
 * - the badge read hands over what it got for the key: the row, null (never went online), or "could not read"
 *   (key null or absent, the read failed, or my_badge_reads is not deployed);
 * - the pill's FIRST read of a page load waits for that, at most ONLINE_HANDOFF_CAP_MS, and makes its own old read
 *   when the badge could not read it or never answered in time (the pill never stays wrong because the badge broke);
 * - ONE handoff per member per page load. Every later pill read (a minute stale, going online or offline) is its own
 *   read again, so an older badge answer never overwrites a newer one. GoOnlineCard ends the handoff when the member
 *   switches, for the same reason.
 *
 * No Supabase import here: both chunks import this file. Guard: src/test/onlinePillTakesBadgeRow.test.tsx.
 */
import type { OnlineStatus } from "./online";

/** How long the pill's first read waits for the badge read before reading on its own. */
const ONLINE_HANDOFF_CAP_MS = 10_000;
/** A handed-over row older than this is not taken (the pill's own staleTime). */
const ANSWER_MAX_AGE_MS = 60_000;

/** `row`: what the badge read got. `false`: the badge could not read it. */
type Answer = { at: number; row: OnlineStatus | null } | { at: number; row: false };

const answers = new Map<string, Answer>();
const done = new Set<string>();
const expected = new Set<string>();

/**
 * NeedsYouMount (the badge read's mount, beside the pill in SignedInChrome) says a badge read will come for this
 * member. Without it the pill never waits: a pill drawn with no badge beside it reads on its own at once.
 */
export function expectOnlineFromBadge(uid: string): void {
  if (uid) expected.add(uid);
}
const waiters = new Map<string, Set<() => void>>();

function wake(uid: string): void {
  const w = waiters.get(uid);
  if (!w) return;
  waiters.delete(uid);
  for (const f of w) f();
}

/** The badge read's answer for the 'delivery_online' key: the row, null (no row), or false (could not read). */
export function handOnlineFromBadge(uid: string, row: OnlineStatus | null | false): void {
  if (!uid) return;
  answers.set(uid, { at: Date.now(), row });
  wake(uid);
}

/** No handoff for this member any more (the member just switched online or offline; their own read is newer). */
export function endOnlineHandoff(uid: string): void {
  done.add(uid);
  answers.delete(uid);
  wake(uid);
}

/**
 * The pill's first read: the badge's row ({ row }), or null when the pill must read on its own (the badge could not
 * read it, did not answer within `capMs`, or this is not the first read of the page load).
 */
export async function takeOnlineFromBadge(uid: string, capMs = ONLINE_HANDOFF_CAP_MS): Promise<{ row: OnlineStatus | null } | null> {
  if (!uid || done.has(uid) || !expected.has(uid)) return null;
  if (!answers.has(uid)) {
    await new Promise<void>((resolve) => {
      const set = waiters.get(uid) ?? new Set<() => void>();
      const t = setTimeout(() => {
        set.delete(finish);
        resolve();
      }, capMs);
      function finish() {
        clearTimeout(t);
        resolve();
      }
      set.add(finish);
      waiters.set(uid, set);
    });
  }
  const a = answers.get(uid);
  done.add(uid);
  answers.delete(uid);
  if (!a || a.row === false || Date.now() - a.at > ANSWER_MAX_AGE_MS) return null;
  return { row: a.row };
}

/** Tests only: a fresh page load. */
export function __resetOnlineHandoff(): void {
  answers.clear();
  done.clear();
  expected.clear();
  for (const uid of [...waiters.keys()]) wake(uid);
}
